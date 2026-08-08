import { Location, StorageService } from './storage';
import { SyncService } from './sync';
import * as Battery from 'expo-battery';

export interface LocationState {
  location_id: string;
  state: 'outside' | 'candidate' | 'inside_confirmed' | 'exited';
  first_enter_time: string | null; // ISO string
  confirmed_enter_time: string | null; // ISO string
  consecutive_outside: number;
}

// Обчислення відстані за формулою гаверсину в метрах
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // радіус Землі в метрах
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Локальний стан детектора в пам'яті
let detectorStates: { [key: string]: LocationState } = {};

export const VisitDetector = {
  /**
   * Завантаження збережених станів з пам'яті пристрою
   */
  async initialize(): Promise<void> {
    try {
      const saved = await StorageService.getConfig();
      // Ми можемо зберігати стани автомата в AsyncStorage під окремим ключем
      // Але для спрощення використовуємо внутрішнє збереження
      detectorStates = {};
    } catch (e) {
      console.error('Помилка ініціалізації VisitDetector:', e);
    }
  },

  /**
   * Головний метод обробки нових координат GPS
   */
  async processLocationUpdate(coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
  }): Promise<void> {
    const config = await StorageService.getConfig();
    const defaultRadius = config ? parseFloat(config.default_radius_m || 30) : 30;
    const dwellSeconds = config ? parseFloat(config.dwell_seconds || 60) : 60;
    const accuracyIgnore = config ? parseFloat(config.accuracy_ignore_m || 150) : 150;
    
    // Ігноруємо геодані з поганою точністю
    if (coords.accuracy > accuracyIgnore) {
      await SyncService.queueLog('diagnostic', `GPS Accuracy ignored: ${coords.accuracy}m (Limit: ${accuracyIgnore}m)`);
      return;
    }

    const locations = await StorageService.getLocations();
    const activeShift = await StorageService.getActiveShift();
    if (!activeShift) return; // Відстеження тільки під час зміни

    // Логіка періодичного фонового сигналу розташування (heartbeat)
    try {
      const lastHeartbeatStr = await StorageService.getLastHeartbeatTime();
      const lastHeartbeat = lastHeartbeatStr ? parseInt(lastHeartbeatStr, 10) : 0;
      const nowMs = Date.now();
      
      // Раз на 10 хвилин (600,000 мілісекунд)
      if (nowMs - lastHeartbeat >= 10 * 60 * 1000) {
        await StorageService.setLastHeartbeatTime(String(nowMs));
        
        let battery: number | null = null;
        try {
          const level = await Battery.getBatteryLevelAsync();
          battery = Math.round(level * 100);
        } catch (err) {
          console.warn('Не вдалося отримати заряд батареї для heartbeat:', err);
        }
        
        await SyncService.queueLog('heartbeat', 'Periodic location heartbeat', JSON.stringify({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy_m: Math.round(coords.accuracy || 10),
          battery: battery
        }));
        
        // Запускаємо фонову синхронізацію
        SyncService.triggerSync().catch(err => console.warn('Heartbeat sync warning:', err));
      }
    } catch (e) {
      console.error('Помилка логування heartbeat:', e);
    }

    const now = new Date();
    const nowStr = now.toISOString();

    for (const loc of locations) {
      const distance = calculateDistance(
        coords.latitude,
        coords.longitude,
        loc.latitude,
        loc.longitude
      );

      // Визначаємо ефективний радіус для точки
      const effectiveRadius = loc.radius_m || defaultRadius;
      const inside = distance <= effectiveRadius;

      // Отримуємо або створюємо стан для конкретної точки
      let locState = detectorStates[loc.location_id];
      if (!locState) {
        locState = {
          location_id: loc.location_id,
          state: 'outside',
          first_enter_time: null,
          confirmed_enter_time: null,
          consecutive_outside: 0,
        };
        detectorStates[loc.location_id] = locState;
      }

      // Кінцевий автомат (State Machine)
      switch (locState.state) {
        case 'outside':
          if (inside) {
            locState.state = 'candidate';
            locState.first_enter_time = nowStr;
            locState.consecutive_outside = 0;
            
            await SyncService.queueLog('diagnostic', `Location candidate: ${loc.name} (${loc.location_id}), distance: ${Math.round(distance)}m`);
          }
          break;

        case 'candidate':
          if (inside) {
            locState.consecutive_outside = 0;
            const enterTime = new Date(locState.first_enter_time!);
            const secondsDiff = (now.getTime() - enterTime.getTime()) / 1000;

            if (secondsDiff >= dwellSeconds) {
              locState.state = 'inside_confirmed';
              locState.confirmed_enter_time = nowStr;
              
              await SyncService.queueLog('visit_detected', `Visit confirmed: ${loc.name} (${loc.location_id}) after ${Math.round(secondsDiff)}s`);
            }
          } else {
            // Вихід із зони кандидата (можливо просто проїхав повз)
            locState.state = 'outside';
            locState.first_enter_time = null;
          }
          break;

        case 'inside_confirmed':
          if (!inside) {
            // Дозволяємо невеликий GPS джиттер: вихід фіксуємо лише після 2 послідовних вимірів ззовні
            locState.consecutive_outside++;
            if (locState.consecutive_outside >= 2) {
              // Фіналізуємо візит
              locState.state = 'outside';
              const enterTime = new Date(locState.first_enter_time!);
              const durationSecs = Math.round((now.getTime() - enterTime.getTime()) / 1000);
              
              if (durationSecs >= dwellSeconds) {
                // Додаємо візит в офлайн-чергу
                await SyncService.queueVisit({
                  location_id: loc.location_id,
                  enter_time: locState.first_enter_time!,
                  exit_time: nowStr,
                  duration_seconds: durationSecs,
                  enter_lat: loc.latitude, // Для простоти використовуємо координати точки або останні GPS
                  enter_lng: loc.longitude,
                  exit_lat: coords.latitude,
                  exit_lng: coords.longitude,
                  accuracy_m: Math.round(coords.accuracy),
                  matched_distance_m: Math.round(distance),
                  source: 'auto',
                  offline_synced: false
                });
              }
              
              locState.first_enter_time = null;
              locState.confirmed_enter_time = null;
              locState.consecutive_outside = 0;
            }
          } else {
            locState.consecutive_outside = 0; // Скидаємо лічильник помилкових виходів
          }
          break;
      }
    }
  },

  /**
   * Фіналізує всі активні візити кур'єра, наприклад, при завершенні зміни
   */
  async finalizeAllActiveVisits(endTimeStr: string): Promise<void> {
    const activeShift = await StorageService.getActiveShift();
    if (!activeShift) return;
    
    const locations = await StorageService.getLocations();
    const config = await StorageService.getConfig();
    const dwellSeconds = config ? parseFloat(config.dwell_seconds || 60) : 60;

    for (const loc of locations) {
      const locState = detectorStates[loc.location_id];
      if (locState && locState.state === 'inside_confirmed') {
        const enterTime = new Date(locState.first_enter_time!);
        const endTime = new Date(endTimeStr);
        const durationSecs = Math.round((endTime.getTime() - enterTime.getTime()) / 1000);

        if (durationSecs >= dwellSeconds) {
          await SyncService.queueVisit({
            location_id: loc.location_id,
            enter_time: locState.first_enter_time!,
            exit_time: endTimeStr,
            duration_seconds: durationSecs,
            enter_lat: loc.latitude,
            enter_lng: loc.longitude,
            exit_lat: loc.latitude,
            exit_lng: loc.longitude,
            accuracy_m: 0,
            matched_distance_m: 0,
            source: 'auto',
            offline_synced: false
          });
        }
      }
    }
    
    // Скидаємо стан детектора
    detectorStates = {};
  }
};
