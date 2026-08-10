import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { VisitDetector } from './detector';
import { SyncService } from './sync';
import { StorageService } from './storage';

export const BACKGROUND_LOCATION_TASK = 'background-location-task';

// Оголошуємо фонове завдання для отримання геолокації
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Помилка фонової задачі геолокації:', error);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    for (const loc of locations) {
      try {
        await VisitDetector.processLocationUpdate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy || 999
        });
      } catch (err) {
        console.error('Помилка обробки точки у фоні:', err);
      }
    }
  }
});

export const LocationService = {
  /**
   * Перевіряє, чи увімкнені служби геолокації на пристрої
   */
  async isLocationEnabled(): Promise<boolean> {
    return Location.hasServicesEnabledAsync();
  },

  /**
   * Запит дозволів на використання геолокації
   * Потрібно запросити спочатку foreground, а потім background дозвіл
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const { status: fgStatusExisting } = await Location.getForegroundPermissionsAsync();
      const { status: bgStatusExisting } = await Location.getBackgroundPermissionsAsync();
      
      if (fgStatusExisting === 'granted' && bgStatusExisting === 'granted') {
        return true;
      }
    } catch (e) {
      console.warn('Error checking permissions status:', e);
    }

    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      await SyncService.queueLog('permission_denied', 'Foreground location permission denied');
      return false;
    }

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      await SyncService.queueLog('permission_denied', 'Background location permission denied');
      // Для MVP ми дозволяємо роботу, але з попередженням, що у фоні відстеження не буде надійним
      return false;
    }

    await SyncService.queueLog('permission_granted', 'All location permissions granted');
    return true;
  },

  /**
   * Запуск фонового відстеження
   */
  async startBackgroundTracking(): Promise<void> {
    const isEnabled = await this.isLocationEnabled();
    if (!isEnabled) {
      await SyncService.queueLog('gps_warning', 'Location services are disabled on device');
      return;
    }

    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) return;

    const config = await StorageService.getConfig();
    const interval = config ? parseInt(config.location_interval_ms || 15000, 10) : 15000;
    const distanceFilter = config ? parseInt(config.distance_filter_m || 10, 10) : 10;

    try {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: interval,
        distanceInterval: distanceFilter,
        // Обов'язково для Android, щоб система не вбивала процес
        foregroundService: {
          notificationTitle: 'Відстеження робочої зміни',
          notificationBody: 'Додаток фіксує ваші візити на точки доставки.',
          notificationColor: '#6366F1'
        },
        pausesUpdatesAutomatically: false
      });
      
      await SyncService.queueLog('tracking_started', 'Background location tracking successfully started');
    } catch (err: any) {
      await SyncService.queueLog('tracking_error', 'Failed to start background tracking', err.toString());
      console.error('Помилка старту фонової геолокації:', err);
    }
  },

  /**
   * Отримує поточні координати пристрою (для старт/енд зміни або ручного чекіну)
   */
  async getCurrentLocation(): Promise<{ latitude: number; longitude: number; accuracy_m: number } | null> {
    try {
      const isEnabled = await this.isLocationEnabled();
      if (!isEnabled) return null;
      
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return null;

      // Створюємо проміс тайм-ауту на 5 секунд для запобігання зависанню GPS
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Location request timed out')), 5000)
      );

      // Запускаємо паралельно запит геолокації та тайм-аут
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        timeoutPromise
      ]);

      return {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy_m: Math.round(loc.coords.accuracy || 10)
      };
    } catch (e) {
      console.warn('Cannot get current position, trying last known position:', e);
      try {
        const lastLoc = await Location.getLastKnownPositionAsync({});
        if (lastLoc) {
          return {
            latitude: lastLoc.coords.latitude,
            longitude: lastLoc.coords.longitude,
            accuracy_m: Math.round(lastLoc.coords.accuracy || 50)
          };
        }
      } catch (e2) {
        // ignore
      }
      return null;
    }
  },

  /**
   * Зупинка фонового відстеження
   */
  async stopBackgroundTracking(): Promise<void> {
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        await SyncService.queueLog('tracking_stopped', 'Background location tracking stopped');
      }
    } catch (err: any) {
      console.error('Помилка зупинки фонової геолокації:', err);
    }
  }
};
