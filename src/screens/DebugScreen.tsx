import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  SafeAreaView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { StorageService } from '../services/storage';
import { SyncService } from '../services/sync';
import { ApiService } from '../services/api';

interface DebugScreenProps {
  onNavigateBack: () => void;
  token: string;
}

export const DebugScreen: React.FC<DebugScreenProps> = ({ onNavigateBack, token }) => {
  const [apiUrl, setApiUrl] = useState('');
  const [courierId, setCourierId] = useState('');
  const [pointsVersion, setPointsVersion] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadDebugData = async () => {
      const url = await StorageService.getApiUrl();
      const cid = await StorageService.getCourierId();
      const ver = await StorageService.getPointsVersion();
      const queue = await StorageService.getOfflineQueue();
      const cfg = await StorageService.getConfig();

      setApiUrl(url);
      setCourierId(cid || 'невідомо');
      setPointsVersion(ver);
      setQueueCount(queue.length);
      setConfig(cfg);
    };

    loadDebugData();
  }, []);

  const handleSaveApiUrl = async () => {
    if (!apiUrl.trim().startsWith('http')) {
      Alert.alert('Помилка', 'Введіть коректну URL адресу (починаючи з http/https)');
      return;
    }

    try {
      await StorageService.setApiUrl(apiUrl.trim());
      await SyncService.queueLog('config_changed', `API URL changed to: ${apiUrl.trim()}`);
      Alert.alert('Збережено', 'Адресу сервера успішно оновлено.');
    } catch (e: any) {
      Alert.alert('Помилка', 'Не вдалося зберегти: ' + e.message);
    }
  };

  const handleDownloadPoints = async () => {
    setLoading(true);
    try {
      const ver = await StorageService.getPointsVersion();
      const response = await ApiService.getPoints(token, 0); // форсуємо завантаження версії 0
      
      if (response.ok && response.points) {
        await StorageService.setLocations(response.points);
        await StorageService.setPointsVersion(response.points_version);
        setPointsVersion(response.points_version);
        
        await SyncService.queueLog(
          'debug_points_download',
          `Manually downloaded ${response.points.length} points. Version: ${response.points_version}`
        );
        Alert.alert('Оновлено', `Завантажено ${response.points.length} точок. Нова версія: ${response.points_version}`);
      } else if (response.status === 'not_modified') {
        Alert.alert('Синхронно', 'Локальний список точок вже актуальний.');
      } else {
        Alert.alert('Помилка', 'Не вдалося завантажити точки: ' + response.error);
      }
    } catch (e: any) {
      Alert.alert('Помилка з\'єднання', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetApp = async () => {
    Alert.alert(
      'Скинути додаток?',
      'Це видалить сесію, локальний кеш точок та чергу подій.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Скинути все',
          style: 'destructive',
          onPress: async () => {
            await StorageService.clearSession();
            await StorageService.setOfflineQueue([]);
            await StorageService.setLocations([]);
            await StorageService.setPointsVersion(0);
            
            Alert.alert('Успіх', 'Дані очищено. Перезапустіть додаток.');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Хедер */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onNavigateBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Налагодження</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* URL Сервера */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Адреса сервера Google Apps Script</Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="https://script.google.com/macros/s/..."
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={[styles.btn, styles.btnSpacing]} onPress={handleSaveApiUrl}>
            <Text style={styles.btnText}>Зберегти адресу</Text>
          </TouchableOpacity>
        </View>

        {/* Системні логи/статистика */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Системна інформація</Text>
          
          <View style={styles.row}>
            <Text style={styles.label}>ID Кур'єра:</Text>
            <Text style={styles.value}>{courierId}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Версія точок:</Text>
            <Text style={styles.value}>{pointsVersion}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Подій у черзі:</Text>
            <Text style={styles.value}>{queueCount}</Text>
          </View>

          {config && (
            <View style={styles.configBox}>
              <Text style={styles.configTitle}>Налаштування з сервера:</Text>
              <Text style={styles.configText}>default_radius_m: {config.default_radius_m || 30}</Text>
              <Text style={styles.configText}>dwell_seconds: {config.dwell_seconds || 60}</Text>
              <Text style={styles.configText}>location_interval_ms: {config.location_interval_ms || 15000}</Text>
              <Text style={styles.configText}>accuracy_ignore_m: {config.accuracy_ignore_m || 150}</Text>
            </View>
          )}

          {loading ? (
            <ActivityIndicator size="small" color="#6366f1" style={styles.btnSpacing} />
          ) : (
            <TouchableOpacity style={[styles.btn, styles.btnSecondary, styles.btnSpacing]} onPress={handleDownloadPoints}>
              <Text style={styles.btnSecondaryText}>Завантажити список точок</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Скидання */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Небезпечна зона</Text>
          <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={handleResetApp}>
            <Text style={styles.btnText}>Очистити пам'ять та сесії</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  scrollContainer: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#334155',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: '#f8fafc',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  label: {
    fontSize: 14,
    color: '#94a3b8',
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f8fafc',
  },
  configBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 8,
  },
  configTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#818cf8',
    marginBottom: 6,
  },
  configText: {
    fontSize: 12,
    color: '#cbd5e1',
    marginBottom: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  btn: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  btnSpacing: {
    marginTop: 12,
  },
  btnSecondary: {
    backgroundColor: '#334155',
  },
  btnDanger: {
    backgroundColor: '#ef4444',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  btnSecondaryText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
});
