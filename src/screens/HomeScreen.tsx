import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  SafeAreaView,
} from 'react-native';
import { StorageService, Shift } from '../services/storage';
import { LocationService } from '../services/location';
import { ApiService } from '../services/api';
import { SyncService, generateUUID } from '../services/sync';
import { VisitDetector } from '../services/detector';
import * as Battery from 'expo-battery';

interface HomeScreenProps {
  courierName: string;
  courierId: string;
  token: string;
  onNavigateToManualCheckin: () => void;
  onNavigateToDebug: () => void;
  onLogout: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  courierName,
  courierId,
  token,
  onNavigateToManualCheckin,
  onNavigateToDebug,
  onLogout,
}) => {
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [shiftTime, setShiftTime] = useState('00:00:00');
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('Перевірка GPS...');
  const [sendingLocation, setSendingLocation] = useState(false);

  // Ефект для завантаження зміни та кількості елементів у черзі
  useEffect(() => {
    const initData = async () => {
      const shift = await StorageService.getActiveShift();
      setActiveShift(shift);
      
      const queue = await StorageService.getOfflineQueue();
      setQueueCount(queue.length);

      const hasGps = await LocationService.isLocationEnabled();
      setGpsStatus(hasGps ? 'Увімкнено (Висока точність)' : 'GPS вимкнено на пристрої!');

      // Автоматичне оновлення списку точок (якщо локальний кеш порожній або застарілий)
      try {
        const cachedLocations = await StorageService.getLocations();
        const localVersion = cachedLocations.length > 0 ? await StorageService.getPointsVersion() : 0;
        
        const response = await ApiService.getPoints(token, localVersion);
        if (response.ok && response.points) {
          await StorageService.setLocations(response.points);
          await StorageService.setPointsVersion(response.points_version);
          console.log(`Auto-downloaded ${response.points.length} locations. Version: ${response.points_version}`);
        }
      } catch (err) {
        console.warn('Не вдалося автоматично оновити точки:', err);
      }
    };

    initData();
    const interval = setInterval(async () => {
      const queue = await StorageService.getOfflineQueue();
      setQueueCount(queue.length);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Ефект таймера для активної зміни
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (activeShift && activeShift.start_time) {
      const updateTimer = () => {
        const start = new Date(activeShift.start_time).getTime();
        const diff = Date.now() - start;
        
        const hours = Math.floor(diff / 3600000).toString().padStart(2, '0');
        const minutes = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
        const seconds = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        
        setShiftTime(`${hours}:${minutes}:${seconds}`);
      };

      updateTimer();
      timer = setInterval(updateTimer, 1000);
    } else {
      setShiftTime('00:00:00');
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [activeShift]);

  // Запуск зміни
  const handleStartShift = async () => {
    // Спочатку перевіримо та запитаємо дозволи
    const hasPermissions = await LocationService.requestPermissions();
    if (!hasPermissions) {
      Alert.alert(
        'Доступ обмежено',
        'Для запуску зміни потрібні дозволи на використання геолокації (зокрема у фоновому режимі).'
      );
    }

    const shiftId = generateUUID();
    const startTime = new Date().toISOString();
    
    try {
      // Отримуємо поточні координати для старту зміни
      const coords = await LocationService.getCurrentLocation();

      // Створюємо лог
      await SyncService.queueLog('shift_start_request', `Courier requested shift start: ${shiftId}`);
      
      const newShift: Shift = {
        shift_id: shiftId,
        courier_id: courierId,
        start_time: startTime,
        status: 'active',
      };

      // Зберігаємо локально
      await StorageService.setActiveShift(newShift);
      setActiveShift(newShift);

      // Запускаємо фонове відстеження
      await LocationService.startBackgroundTracking();

      // Отримуємо поточний рівень заряду батареї
      let battery: number | null = null;
      try {
        const level = await Battery.getBatteryLevelAsync();
        battery = Math.round(level * 100);
      } catch (err) {
        console.warn('Не вдалося отримати заряд батареї для старту зміни:', err);
      }

      // Відправляємо подію на сервер
      ApiService.startShift(token, shiftId, courierId, 'expo_android', 'android', '1.0.0', startTime, coords, battery)
        .catch(async (e) => {
          // Якщо немає інтернету, записуємо збій у логи (подія відправиться пізніше)
          await SyncService.queueLog('shift_start_offline', `Start shift offline saved: ${shiftId}`, e.toString());
        });

      Alert.alert('Зміну розпочато', 'Фонове відстеження активоване.');
    } catch (e: any) {
      Alert.alert('Помилка', 'Не вдалося розпочати зміну: ' + e.message);
    }
  };

  // Завершення зміни
  const handleEndShift = async () => {
    if (!activeShift) return;

    Alert.alert(
      'Завершити зміну?',
      'Фонове відстеження буде вимкнено.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Так, завершити',
          style: 'destructive',
          onPress: async () => {
            const endTime = new Date().toISOString();
            const shiftId = activeShift.shift_id;

            try {
              // Отримуємо поточні координати для завершення зміни
              const coords = await LocationService.getCurrentLocation();

              // 1. Зупиняємо відстеження
              await LocationService.stopBackgroundTracking();

              // 2. Фіналізуємо незавершені візити в детектері
              await VisitDetector.finalizeAllActiveVisits(endTime);

              // 3. Записуємо логи
              await SyncService.queueLog('shift_end_request', `Courier requested shift end: ${shiftId}`);

              // 4. Очищуємо зміну локально
              await StorageService.setActiveShift(null);
              setActiveShift(null);

              // Отримуємо поточний рівень заряду батареї
              let battery: number | null = null;
              try {
                const level = await Battery.getBatteryLevelAsync();
                battery = Math.round(level * 100);
              } catch (err) {
                console.warn('Не вдалося отримати заряд батареї для завершення зміни:', err);
              }

              // 5. Відправляємо на сервер
              ApiService.endShift(token, shiftId, courierId, endTime, coords, battery)
                .catch(async (e) => {
                  await SyncService.queueLog('shift_end_offline', `End shift offline saved: ${shiftId}`, e.toString());
                });

              // Спробуємо примусово синхронізувати
              setIsSyncing(true);
              await SyncService.triggerSync();
              setIsSyncing(false);

              Alert.alert('Зміну завершено', 'Всі візити зафіксовані та відправлені.');
            } catch (e: any) {
              Alert.alert('Помилка завершення zmiany', e.message);
            }
          },
        },
      ]
    );
  };

  const handleSyncForce = async () => {
    setIsSyncing(true);
    await SyncService.triggerSync();
    setIsSyncing(false);
    const queue = await StorageService.getOfflineQueue();
    setQueueCount(queue.length);
    Alert.alert('Синхронізація', 'Процес синхронізації завершено.');
  };

  const handleForceHeartbeat = async () => {
    setSendingLocation(true);
    try {
      const { VisitDetector } = require('../services/detector');
      await VisitDetector.forceLocationHeartbeat();
      const queue = await StorageService.getOfflineQueue();
      setQueueCount(queue.length);
      Alert.alert('Успішно', 'Ваші поточні координати записано для відправки.');
    } catch (e: any) {
      Alert.alert('Помилка', 'Не вдалося оновити координати: ' + e.message);
    } finally {
      setSendingLocation(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Хедер */}
        <View style={styles.header}>
          <Text style={styles.name}>{courierName}</Text>
          <Text style={styles.idText}>ID: {courierId}</Text>
        </View>

        {/* Статус зміни */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Поточний статус роботи</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusIndicator, activeShift ? styles.statusActive : styles.statusInactive]} />
            <Text style={styles.statusText}>{activeShift ? 'На зміні' : 'Зміна закрита'}</Text>
          </View>
          <Text style={styles.timerText}>{shiftTime}</Text>

          {activeShift ? (
            <>
              <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={handleEndShift}>
                <Text style={styles.btnText}>Завершити зміну</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btn, styles.btnSuccess, { marginTop: 12 }, sendingLocation && styles.btnDisabled]} 
                onPress={handleForceHeartbeat}
                disabled={sendingLocation}
              >
                <Text style={styles.btnText}>
                  {sendingLocation ? 'Надсилання...' : '🛰️ Надіслати розташування'}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.btn} onPress={handleStartShift}>
              <Text style={styles.btnText}>Почати зміну</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Кнопки меню */}
        <View style={styles.menuContainer}>
          <TouchableOpacity
            style={[styles.menuBtn, !activeShift && styles.menuBtnDisabled]}
            onPress={onNavigateToManualCheckin}
            disabled={!activeShift}
          >
            <Text style={styles.menuBtnIcon}>📍</Text>
            <Text style={styles.menuBtnText}>Ручний Чек-ін</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuBtn} onPress={onNavigateToDebug}>
            <Text style={styles.menuBtnIcon}>⚙️</Text>
            <Text style={styles.menuBtnText}>Налагодження</Text>
          </TouchableOpacity>
        </View>

        {/* Стан синхронізації */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Стан підключення та черги</Text>
          <Text style={styles.infoText}>Служби GPS: {gpsStatus}</Text>
          <Text style={styles.infoText}>Подій у черзі на відправку: {queueCount}</Text>
          
          <TouchableOpacity 
            style={[styles.btn, styles.btnSecondary, isSyncing && styles.btnDisabled]} 
            onPress={handleSyncForce}
            disabled={isSyncing}
          >
            <Text style={styles.btnSecondaryText}>
              {isSyncing ? 'Синхронізація...' : 'Синхронізувати примусово'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutBtnText}>Вийти з акаунту</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContainer: {
    padding: 20,
    gap: 16,
  },
  header: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  idText: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusActive: {
    backgroundColor: '#10b981',
  },
  statusInactive: {
    backgroundColor: '#ef4444',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f8fafc',
  },
  timerText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#f8fafc',
    textAlign: 'center',
    marginVertical: 16,
    fontVariant: ['tabular-nums'],
  },
  btn: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  btnDanger: {
    backgroundColor: '#ef4444',
  },
  btnSuccess: {
    backgroundColor: '#10b981',
  },
  btnSecondary: {
    backgroundColor: '#334155',
    marginTop: 12,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  btnSecondaryText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '500',
  },
  menuContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  menuBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  menuBtnDisabled: {
    opacity: 0.4,
  },
  menuBtnIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  menuBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f8fafc',
  },
  infoText: {
    fontSize: 14,
    color: '#cbd5e1',
    marginBottom: 6,
  },
  logoutBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  logoutBtnText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
});
