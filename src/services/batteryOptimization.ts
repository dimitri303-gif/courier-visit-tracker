import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

export const BatteryOptimizationService = {
  /**
   * Відкриває сторінку з налаштуваннями оптимізації батареї
   * (Дозволяє користувачу обрати "Необмежено" для додатку)
   */
  async openBatteryOptimizationSettings(): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
      } catch (e) {
        console.warn('Cannot open battery optimization settings', e);
      }
    }
  },

  /**
   * Відкриває загальну сторінку налаштувань додатку (App Info)
   */
  async openAppInfoSettings(): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        // Need Expo constants to get the bundle identifier
        const Constants = require('expo-constants').default;
        const pkg = Constants.expoConfig?.android?.package || 'com.couriermvp.tracker';
        
        await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
          data: `package:${pkg}`,
        });
      } catch (e) {
        console.warn('Cannot open app info settings', e);
      }
    }
  }
};
