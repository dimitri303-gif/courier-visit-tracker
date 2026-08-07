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
        pausesLocationUpdatesAutomatically: false
      });
      
      await SyncService.queueLog('tracking_started', 'Background location tracking successfully started');
    } catch (err: any) {
      await SyncService.queueLog('tracking_error', 'Failed to start background tracking', err.toString());
      console.error('Помилка старту фонової геолокації:', err);
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
