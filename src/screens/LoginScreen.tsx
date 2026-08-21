import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { ApiService } from '../services/api';
import { StorageService } from '../services/storage';
import Constants from 'expo-constants';

interface LoginScreenProps {
  onLoginSuccess: (token: string, name: string, courierId: string, role: 'courier' | 'logist', region: string) => void;
  onNavigateToDebug: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, onNavigateToDebug }) => {
  const [courierId, setCourierId] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!courierId.trim() || !pin.trim()) {
      setError('Будь ласка, заповніть всі поля');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const cleanCourierId = courierId.trim().toUpperCase()
        .replace(/[\u0421\u0441]/g, 'C')
        .replace(/[\u041E\u043E]/g, 'O')
        .replace(/[\u0410\u0430]/g, 'A');
      const response = await ApiService.login(cleanCourierId, pin.trim());
      
      if (response.ok) {
        // Зберігаємо сесію
        await StorageService.setToken(response.token);
        await StorageService.setCourierId(response.courier_id);
        await StorageService.setCourierName(response.name);
        await StorageService.setPointsVersion(response.points_version);
        await StorageService.setRole(response.role || 'courier');
        await StorageService.setRegion(response.region || '');
        if (response.config) {
          await StorageService.setConfig(response.config);
        }
        
        onLoginSuccess(
          response.token,
          response.name,
          response.courier_id,
          response.role || 'courier',
          response.region || ''
        );
      } else {
        setError(response.error || 'Помилка входу');
      }
    } catch (err: any) {
      setError('Помилка з\'єднання. Перевірте URL в Debug-налаштуваннях.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.card}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoIcon}>🌱</Text>
          </View>
          
          <Text style={styles.title}>Visit Tracker</Text>
          <Text style={styles.subtitle}>Вхід у систему відстеження кур'єрів</Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>ID Кур'єра</Text>
            <TextInput
              style={styles.input}
              placeholder="Наприклад, C001"
              placeholderTextColor="#94a3b8"
              value={courierId}
              onChangeText={setCourierId}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>PIN-код</Text>
            <TextInput
              style={styles.input}
              placeholder="••••"
              placeholderTextColor="#94a3b8"
              value={pin}
              onChangeText={setPin}
              secureTextEntry
              keyboardType="numeric"
              maxLength={6}
            />
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#6366f1" style={styles.loader} />
          ) : (
            <>
              <TouchableOpacity style={styles.button} onPress={handleLogin}>
                <Text style={styles.buttonText}>Увійти</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.debugLink} onPress={onNavigateToDebug}>
                <Text style={styles.debugLinkText}>⚙️ Налаштування сервера</Text>
              </TouchableOpacity>
              <Text style={styles.versionText}>v{Constants.expoConfig?.version || '1.0.0'}</Text>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  logoContainer: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoIcon: {
    fontSize: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 24,
  },
  errorText: {
    color: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#94a3b8',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#334155',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#f8fafc',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  loader: {
    marginTop: 20,
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  debugLink: {
    marginTop: 20,
    padding: 10,
    alignItems: 'center',
  },
  debugLinkText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  versionText: {
    textAlign: 'center',
    color: '#64748b',
    fontSize: 11,
    marginTop: 10,
  },
});
