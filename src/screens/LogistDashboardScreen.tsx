import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Linking,
  Platform,
  ScrollView,
} from 'react-native';
import { ApiService } from '../services/api';
import { StorageService, Location as StorageLocation } from '../services/storage';
import { calculateDistance } from '../services/detector';

interface LogistDashboardScreenProps {
  logistName: string;
  logistId: string;
  token: string;
  logistRegion: string;
  onLogout: () => void;
  onNavigateToDebug: () => void;
}

interface CourierStatus {
  courier_id: string;
  name: string;
  phone: string;
  status: 'active' | 'ended';
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  battery_percent: number | null;
  last_seen: string;
  location_request: boolean;
  visited_locations: string[]; // IDs
}

export const LogistDashboardScreen: React.FC<LogistDashboardScreenProps> = ({
  logistName,
  logistId,
  token,
  logistRegion,
  onLogout,
  onNavigateToDebug,
}) => {
  const [couriers, setCouriers] = useState<CourierStatus[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCourierId, setActiveCourierId] = useState<string | null>(null);
  const [showRouteId, setShowRouteId] = useState<string | null>(null);
  const [localRequesting, setLocalRequesting] = useState<{ [key: string]: boolean }>({});
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Отримання списку кур'єрів та точок
  const fetchData = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      // 1. Завантажуємо точки
      const cachedLocs = await StorageService.getLocations();
      setLocations(cachedLocs);

      // 2. Завантажуємо кур'єрів з сервера
      const response = await ApiService.getLogistCouriers(token);
      if (response.ok && response.couriers) {
        setCouriers(response.couriers);
      } else {
        Alert.alert('Помилка', response.error || 'Не вдалося завантажити дані кур\'єрів');
      }
    } catch (e: any) {
      console.error(e);
      Alert.alert('Помилка з\'єднання', 'Не вдалося зв\'язатися з сервером.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Періодичне автооновлення раз на 30 секунд для свіжих координат
    const interval = setInterval(() => {
      fetchData(true);
    }, 30000);

    return () => {
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Перезапуск 45-секундного таймера бездіяльності
  const resetAutocloseTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setActiveCourierId(null);
      setShowRouteId(null);
      Alert.alert(
        'Сесію очікування завершено',
        "Панель кур'єра автоматично згорнута через 45 секунд бездіяльності."
      );
    }, 45000);
  };

  const handleSelectCourier = (courierId: string) => {
    if (activeCourierId === courierId) {
      // Закриваємо при повторному натисканні
      setActiveCourierId(null);
      setShowRouteId(null);
      if (timerRef.current) clearTimeout(timerRef.current);
    } else {
      setActiveCourierId(courierId);
      setShowRouteId(null); // Згортаємо маршрут при зміні кур'єра
      resetAutocloseTimer();
    }
  };

  const handleOpenMap = (courier: CourierStatus) => {
    resetAutocloseTimer();
    if (!courier.latitude || !courier.longitude) {
      Alert.alert('Немає координат', 'Кур\'єр ще не передавав свої координати або зміну не розпочато.');
      return;
    }
    const lat = String(courier.latitude).replace(',', '.');
    const lng = String(courier.longitude).replace(',', '.');
    const url = Platform.select({
      ios: `maps://app?daddr=${lat},${lng}`,
      android: `google.navigation:q=${lat},${lng}&mode=d`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    });

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          Linking.openURL(url);
        } else {
          Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
        }
      })
      .catch((err) => console.error('Error opening map: ', err));
  };

  const handleToggleRoute = (courierId: string) => {
    resetAutocloseTimer();
    if (showRouteId === courierId) {
      setShowRouteId(null);
    } else {
      setShowRouteId(courierId);
    }
  };

  const handleForceRequestLocation = async (courierId: string) => {
    resetAutocloseTimer();
    setLocalRequesting(prev => ({ ...prev, [courierId]: true }));
    try {
      const response = await ApiService.requestCourierLocation(token, courierId);
      if (response.ok) {
        Alert.alert(
          'Запит надіслано',
          'Сигнал надіслано на сервер. Телефон кур\'єра автоматично оновлевить свої координати під час наступного обміну даними (упродовж кількох секунд).'
        );
        await fetchData(true);
      } else {
        Alert.alert('Помилка', response.error || 'Не вдалося надіслати запит');
      }
    } catch (e: any) {
      console.error(e);
      Alert.alert('Помилка з\'єднання', 'Не вдалося зв\'язатися з сервером.');
    } finally {
      setLocalRequesting(prev => ({ ...prev, [courierId]: false }));
    }
  };

  // Розрахунок часу тому
  const formatLastSeen = (isoStr: string) => {
    if (!isoStr) return 'ніколи';
    try {
      const diffMs = Date.now() - new Date(isoStr).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'щойно';
      if (diffMins < 60) return `${diffMins} хв. тому`;
      const diffHours = Math.floor(diffMins / 60);
      return `${diffHours} год. тому`;
    } catch (e) {
      return 'невідомо';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Хедер */}
      <View style={styles.header}>
        <View>
          <Text style={styles.logistName}>{logistName}</Text>
          <Text style={styles.roleText}>Логіст • {logistRegion || 'Завантаження...'}</Text>
        </View>
        <TouchableOpacity style={styles.debugBtn} onPress={onNavigateToDebug}>
          <Text style={styles.debugBtnText}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Отримання геоданих кур'єрів...</Text>
        </View>
      ) : (
        <FlatList
          data={couriers}
          keyExtractor={(item) => item.courier_id}
          refreshing={refreshing}
          onRefresh={() => fetchData(false)}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => {
            const isActive = activeCourierId === item.courier_id;
            const isRouteVisible = showRouteId === item.courier_id;
            const isOnline = item.status === 'active';
            
            return (
              <View style={[styles.card, isActive && styles.cardActive]}>
                {/* Рядок загального статусу кур'єра */}
                <TouchableOpacity
                  style={styles.courierRow}
                  onPress={() => handleSelectCourier(item.courier_id)}
                >
                  <View style={styles.courierInfo}>
                    <Text style={styles.courierName}>{item.name}</Text>
                    <Text style={styles.courierPhone}>{item.phone}</Text>
                  </View>
                  <View style={styles.statusBadgeContainer}>
                    <View
                      style={[
                        styles.statusDot,
                        isOnline ? styles.dotOnline : styles.dotOffline,
                      ]}
                    />
                    <Text style={[styles.statusText, isOnline ? styles.textOnline : styles.textOffline]}>
                      {isOnline ? 'На зміні' : 'Закрита'}
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Розгорнута панель інформації */}
                {isActive && (
                  <View style={styles.detailsContainer}>
                    <View style={styles.divider} />
                    
                    {/* Параметри */}
                    <View style={styles.paramsGrid}>
                      <View style={styles.paramBox}>
                        <Text style={styles.paramLabel}>Зв'язок</Text>
                        <Text style={styles.paramValue}>{formatLastSeen(item.last_seen)}</Text>
                      </View>
                      <View style={styles.paramBox}>
                        <Text style={styles.paramLabel}>Батарея</Text>
                        <Text style={styles.paramValue}>
                          {item.battery_percent !== null ? `${item.battery_percent}%` : '—'}
                        </Text>
                      </View>
                      <View style={styles.paramBox}>
                        <Text style={styles.paramLabel}>GPS Точність</Text>
                        <Text style={styles.paramValue}>
                          {item.accuracy_m !== null ? `±${item.accuracy_m}м` : '—'}
                        </Text>
                      </View>
                    </View>

                    {/* Дії логіста */}
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={[styles.actionBtn, (!item.latitude || !item.longitude) && styles.actionBtnDisabled]}
                        disabled={!item.latitude || !item.longitude}
                        onPress={() => handleOpenMap(item)}
                      >
                        <Text style={styles.actionBtnText}>📍 Де кур'єр?</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionBtnSecondary]}
                        onPress={() => handleToggleRoute(item.courier_id)}
                      >
                        <Text style={styles.actionBtnSecondaryText}>
                          {isRouteVisible ? '🙈 Сховати маршрут' : '🗺️ Маршрут'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Кнопка ручного запиту координат */}
                    <TouchableOpacity
                      style={[
                        styles.requestBtn,
                        item.location_request && styles.requestBtnPending,
                        (item.location_request || item.status !== 'active' || localRequesting[item.courier_id]) && styles.requestBtnDisabled
                      ]}
                      disabled={item.location_request || item.status !== 'active' || localRequesting[item.courier_id]}
                      onPress={() => handleForceRequestLocation(item.courier_id)}
                    >
                      <Text style={styles.requestBtnText}>
                        {localRequesting[item.courier_id]
                          ? '📡 Запит надсилається...'
                          : item.location_request
                          ? '🛰️ Очікування нових координат...'
                          : item.status !== 'active'
                          ? '⏳ Кур\'єр не на зміні'
                          : '📡 Запросити оновлення координат'}
                      </Text>
                    </TouchableOpacity>

                    {/* Маршрут кур'єра та відстані до точок */}
                    {isRouteVisible && (
                      <View style={styles.routeContainer}>
                        <View style={styles.divider} />
                        <Text style={styles.routeTitle}>Маршрут точок клієнтів:</Text>
                        
                        {locations.length === 0 ? (
                          <Text style={styles.noPointsText}>База точок пуста або завантажується...</Text>
                        ) : (
                          <View style={styles.pointsList}>
                            {locations.map((loc) => {
                              const isVisited = item.visited_locations.includes(loc.location_id);
                              
                              // Рахуємо відстань від останньої точки кур'єра до локації
                              let distText = '—';
                              if (item.latitude && item.longitude) {
                                const dist = calculateDistance(
                                  item.latitude,
                                  item.longitude,
                                  loc.latitude,
                                  loc.longitude
                                );
                                distText = dist > 1000
                                  ? `${(dist / 1000).toFixed(1)} км`
                                  : `${Math.round(dist)} м`;
                              }

                              return (
                                <View key={loc.location_id} style={styles.pointItem}>
                                  <View style={styles.pointDetails}>
                                    <View style={styles.pointHeaderRow}>
                                      <Text style={styles.pointName}>{loc.name}</Text>
                                      {isVisited ? (
                                        <Text style={styles.visitedBadge}>✅ Відвідано</Text>
                                      ) : (
                                        <Text style={styles.pendingBadge}>⏳ В дорозі</Text>
                                      )}
                                    </View>
                                    <Text style={styles.pointAddress}>{loc.address}</Text>
                                    {!isVisited && (
                                      <Text style={styles.pointDistance}>
                                        Відстань від кур'єра: <Text style={{ fontWeight: 'bold', color: '#818cf8' }}>{distText}</Text>
                                      </Text>
                                    )}
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>У вашому регіоні немає активних кур'єрів</Text>
            </View>
          }
        />
      )}

      {/* Кнопка виходу */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutBtnText}>Вийти з кабінету логіста</Text>
        </TouchableOpacity>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: Platform.OS === 'android' ? 44 : 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  logistName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  roleText: {
    fontSize: 13,
    color: '#6366f1',
    fontWeight: '600',
    marginTop: 2,
  },
  debugBtn: {
    padding: 10,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  debugBtnText: {
    fontSize: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 14,
  },
  listContainer: {
    padding: 16,
    gap: 14,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  cardActive: {
    borderColor: '#6366f1',
    borderWidth: 1.5,
  },
  courierRow: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  courierInfo: {
    flex: 1,
  },
  courierName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  courierPhone: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  statusBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  dotOnline: {
    backgroundColor: '#10b981',
  },
  dotOffline: {
    backgroundColor: '#64748b',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  textOnline: {
    color: '#10b981',
  },
  textOffline: {
    color: '#94a3b8',
  },
  detailsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginVertical: 12,
  },
  paramsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  paramBox: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
  },
  paramLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  paramValue: {
    fontSize: 13,
    color: '#cbd5e1',
    fontWeight: '600',
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  actionBtn: {
    flex: 1.2,
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnDisabled: {
    backgroundColor: '#334155',
    opacity: 0.4,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: '#334155',
  },
  actionBtnSecondaryText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  routeContainer: {
    marginTop: 8,
  },
  routeTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#818cf8',
    marginBottom: 8,
  },
  pointsList: {
    gap: 10,
  },
  pointItem: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  pointDetails: {
    flex: 1,
  },
  pointHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pointName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f8fafc',
    flex: 1,
    marginRight: 8,
  },
  visitedBadge: {
    fontSize: 11,
    color: '#10b981',
    fontWeight: '600',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  pendingBadge: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '600',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  pointAddress: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  pointDistance: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 6,
  },
  noPointsText: {
    color: '#64748b',
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: '#0f172a',
  },
  logoutBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#f1f5f9',
    fontSize: 15,
    fontWeight: '600',
  },
  requestBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  requestBtnPending: {
    backgroundColor: '#b45309',
  },
  requestBtnDisabled: {
    opacity: 0.5,
  },
  requestBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
