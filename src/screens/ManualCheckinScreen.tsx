import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import { StorageService, Location as StorageLocation } from '../services/storage';
import { SyncService } from '../services/sync';
import { calculateDistance } from '../services/detector';

interface ManualCheckinScreenProps {
  onNavigateBack: () => void;
}

interface NearbyLocation extends StorageLocation {
  distance?: number; // в метрах
}

export const ManualCheckinScreen: React.FC<ManualCheckinScreenProps> = ({ onNavigateBack }) => {
  const [locations, setLocations] = useState<NearbyLocation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
  const [currentCoords, setCurrentCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [loadingGps, setLoadingGps] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchLocationAndPoints = async () => {
      // 1. Спочатку завантажуємо та відображаємо точки з локального сховища миттєво
      let cachedPoints: NearbyLocation[] = [];
      try {
        cachedPoints = await StorageService.getLocations();
        setLocations(cachedPoints);
      } catch (e) {
        console.error('Помилка завантаження точок з кешу:', e);
      }

      // 2. Паралельно запитуємо геолокацію
      let coords: Location.LocationObjectCoords | null = null;
      let accuracy: number | null = null;

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // Створюємо проміс тайм-ауту на 6 секунд
          const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('GPS timeout')), 6000)
          );

          // Створюємо запит координат
          const gpsPromise = Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });

          // Запускаємо гонку
          const loc = await Promise.race([gpsPromise, timeoutPromise]);

          if (loc) {
            coords = loc.coords;
            accuracy = Math.round(loc.coords.accuracy || 0);
            setCurrentCoords(coords);
            setGpsAccuracy(accuracy);

            // Якщо координати отримано, перераховуємо відстані та сортуємо точки
            if (cachedPoints.length > 0) {
              const nearbyPoints = cachedPoints.map((locItem) => ({
                ...locItem,
                distance: calculateDistance(
                  coords!.latitude,
                  coords!.longitude,
                  locItem.latitude,
                  locItem.longitude
                ),
              }));

              nearbyPoints.sort((a, b) => (a.distance || 0) - (b.distance || 0));
              setLocations(nearbyPoints);
            }
          }
        }
      } catch (err) {
        console.warn('Не вдалося отримати GPS координати для ручного чекіну:', err);
      } finally {
        setLoadingGps(false);
      }
    };

    fetchLocationAndPoints();
  }, []);

  const handleCheckin = async () => {
    if (!selectedLocId) return;

    setSubmitting(true);
    const selected = locations.find((l) => l.location_id === selectedLocId);
    if (!selected) {
      setSubmitting(false);
      return;
    }

    const timestamp = new Date().toISOString();

    try {
      const payload = {
        location_id: selected.location_id,
        enter_time: timestamp,
        exit_time: timestamp,
        duration_seconds: 0,
        enter_lat: currentCoords ? currentCoords.latitude : null,
        enter_lng: currentCoords ? currentCoords.longitude : null,
        exit_lat: currentCoords ? currentCoords.latitude : null,
        exit_lng: currentCoords ? currentCoords.longitude : null,
        accuracy_m: gpsAccuracy,
        matched_distance_m: selected.distance ? Math.round(selected.distance) : null,
        source: currentCoords ? 'manual' : 'manual_no_gps',
        offline_synced: false,
      };

      // Зберігаємо подію в офлайн-чергу
      await SyncService.queueVisit(payload);
      
      // Записуємо лог діагностики
      await SyncService.queueLog(
        'manual_checkin_success',
        `Courier checked in manually at location ${selected.name} (${selected.location_id})`
      );

      Alert.alert(
        'Візит успішно записаний',
        'Подія ручної відмітки додана в чергу та буде синхронізована.',
        [{ text: 'ОК', onPress: onNavigateBack }]
      );
    } catch (e: any) {
      Alert.alert('Помилка', 'Не вдалося зберегти відмітку: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Фільтрація списку локацій за запитом пошуку
  const filteredLocations = locations.filter((loc) =>
    loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    loc.location_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    loc.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Хедер */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onNavigateBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ручний Чек-ін</Text>
      </View>

      {/* Пошук */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Пошук точки за назвою або ID..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
        />
      </View>

      {/* Стан GPS */}
      <View style={styles.gpsCard}>
        {loadingGps ? (
          <View style={styles.gpsRow}>
            <ActivityIndicator size="small" color="#6366f1" />
            <Text style={styles.gpsText}>Визначення поточної геолокації...</Text>
          </View>
        ) : currentCoords ? (
          <Text style={styles.gpsTextSuccess}>
            GPS: Координати знайдені (точність ±{gpsAccuracy}м)
          </Text>
        ) : (
          <Text style={styles.gpsTextWarning}>
            GPS: Сигнал відсутній або слабкий. Дозволяється відмітка без координат.
          </Text>
        )}
      </View>

      {/* Список точок */}
      <FlatList
        data={filteredLocations}
        keyExtractor={(item) => item.location_id}
        contentContainerStyle={styles.listContainer}
        renderItem={({ item }) => {
          const isSelected = selectedLocId === item.location_id;
          const distText =
            item.distance !== undefined
              ? item.distance > 1000
                ? `${(item.distance / 1000).toFixed(1)} км`
                : `${Math.round(item.distance)} м`
              : 'Невідомо';

          return (
            <TouchableOpacity
              style={[styles.item, isSelected && styles.itemSelected]}
              onPress={() => setSelectedLocId(item.location_id)}
            >
              <View style={styles.itemDetails}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemAddress}>
                  {item.location_id} • {item.address}
                </Text>
              </View>
              <View style={styles.distanceBadge}>
                <Text style={styles.distanceText}>{distText}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Локацій не знайдено</Text>
          </View>
        }
      />

      {/* Кнопка підтвердження */}
      <View style={styles.footer}>
        {submitting ? (
          <ActivityIndicator size="large" color="#6366f1" />
        ) : (
          <TouchableOpacity
            style={[styles.btn, !selectedLocId && styles.btnDisabled]}
            disabled={!selectedLocId}
            onPress={handleCheckin}
          >
            <Text style={styles.btnText}>Підтвердити прибуття</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: Platform.OS === 'android' ? 44 : 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    marginRight: 4,
  },
  backBtnText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginLeft: 16,
  },
  searchContainer: {
    padding: 16,
  },
  searchInput: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: '#f8fafc',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  gpsCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gpsText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  gpsTextSuccess: {
    fontSize: 13,
    color: '#10b981',
    fontWeight: '500',
  },
  gpsTextWarning: {
    fontSize: 13,
    color: '#f59e0b',
    fontWeight: '500',
  },
  listContainer: {
    padding: 16,
    gap: 12,
  },
  item: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  itemSelected: {
    borderColor: '#6366f1',
    borderWidth: 2,
    backgroundColor: 'rgba(99,102,241,0.05)',
  },
  itemDetails: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  itemAddress: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  distanceBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#818cf8',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: '#0f172a',
  },
  btn: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  btnDisabled: {
    backgroundColor: '#334155',
    opacity: 0.5,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
