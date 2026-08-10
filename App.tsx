import React, { useState, useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator, LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StorageService } from './src/services/storage';
import { VisitDetector } from './src/services/detector';
import { SyncService } from './src/services/sync';

// Ігноруємо специфічні попередження Expo Go для фонових служб геолокації
LogBox.ignoreLogs([
  "Couldn't start the foreground service",
  "Foreground service permissions were not found in the manifest"
]);

// Імпорт екранів
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ManualCheckinScreen } from './src/screens/ManualCheckinScreen';
import { DebugScreen } from './src/screens/DebugScreen';
import { LogistDashboardScreen } from './src/screens/LogistDashboardScreen';

type ActiveScreen = 'login' | 'home' | 'manual_checkin' | 'debug' | 'logist_dashboard';

export default function App() {
  const [screen, setScreen] = useState<ActiveScreen>('login');
  const [loading, setLoading] = useState(true);
  const [courierName, setCourierName] = useState('');
  const [courierId, setCourierId] = useState('');
  const [token, setToken] = useState('');
  const [role, setRole] = useState<'courier' | 'logist'>('courier');
  const [userRegion, setUserRegion] = useState('');

  useEffect(() => {
    const bootstrapAsync = async () => {
      try {
        // Ініціалізація детектора візитів
        await VisitDetector.initialize();

        // Спроба відновити сесію
        const savedToken = await StorageService.getToken();
        const savedName = await StorageService.getCourierName();
        const savedId = await StorageService.getCourierId();
        const savedRole = await StorageService.getRole();
        const savedRegion = await StorageService.getRegion();

        if (savedToken && savedName && savedId) {
          setToken(savedToken);
          setCourierName(savedName);
          setCourierId(savedId);
          setRole(savedRole || 'courier');
          setUserRegion(savedRegion || '');
          setScreen(savedRole === 'logist' ? 'logist_dashboard' : 'home');
          
          // Запускаємо автоматичну фонову синхронізацію при старті
          SyncService.triggerSync();
        } else {
          setScreen('login');
        }
      } catch (e) {
        console.error('Помилка відновлення сесії:', e);
      } finally {
        setLoading(false);
      }
    };

    bootstrapAsync();
  }, []);

  const handleLoginSuccess = (
    userToken: string,
    userName: string,
    userId: string,
    userRole: 'courier' | 'logist',
    region: string
  ) => {
    setToken(userToken);
    setCourierName(userName);
    setCourierId(userId);
    setRole(userRole);
    setUserRegion(region);
    setScreen(userRole === 'logist' ? 'logist_dashboard' : 'home');
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await StorageService.clearSession();
      setToken('');
      setCourierName('');
      setCourierId('');
      setRole('courier');
      setUserRegion('');
      setScreen('login');
    } catch (e) {
      console.error('Помилка виходу з системи:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {screen === 'login' && (
        <LoginScreen 
          onLoginSuccess={handleLoginSuccess} 
          onNavigateToDebug={() => setScreen('debug')}
        />
      )}
      {screen === 'home' && (
        <HomeScreen
          courierName={courierName}
          courierId={courierId}
          token={token}
          onNavigateToManualCheckin={() => setScreen('manual_checkin')}
          onNavigateToDebug={() => setScreen('debug')}
          onLogout={handleLogout}
        />
      )}
      {screen === 'manual_checkin' && (
        <ManualCheckinScreen onNavigateBack={() => setScreen('home')} />
      )}
      {screen === 'logist_dashboard' && (
        <LogistDashboardScreen
          logistName={courierName}
          logistId={courierId}
          token={token}
          logistRegion={userRegion}
          onLogout={handleLogout}
          onNavigateToDebug={() => setScreen('debug')}
        />
      )}
      {screen === 'debug' && (
        <DebugScreen token={token} onNavigateBack={() => setScreen(token ? (role === 'logist' ? 'logist_dashboard' : 'home') : 'login')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
