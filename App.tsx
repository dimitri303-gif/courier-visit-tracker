import React, { useState, useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StorageService } from './src/services/storage';
import { VisitDetector } from './src/services/detector';
import { SyncService } from './src/services/sync';

// Імпорт екранів
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ManualCheckinScreen } from './src/screens/ManualCheckinScreen';
import { DebugScreen } from './src/screens/DebugScreen';

type ActiveScreen = 'login' | 'home' | 'manual_checkin' | 'debug';

export default function App() {
  const [screen, setScreen] = useState<ActiveScreen>('login');
  const [loading, setLoading] = useState(true);
  const [courierName, setCourierName] = useState('');
  const [courierId, setCourierId] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    const bootstrapAsync = async () => {
      try {
        // Ініціалізація детектора візитів
        await VisitDetector.initialize();

        // Спроба відновити сесію
        const savedToken = await StorageService.getToken();
        const savedName = await StorageService.getCourierName();
        const savedId = await StorageService.getCourierId();

        if (savedToken && savedName && savedId) {
          setToken(savedToken);
          setCourierName(savedName);
          setCourierId(savedId);
          setScreen('home');
          
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

  const handleLoginSuccess = (userToken: string, userName: string, userId: string) => {
    setToken(userToken);
    setCourierName(userName);
    setCourierId(userId);
    setScreen('home');
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await StorageService.clearSession();
      setToken('');
      setCourierName('');
      setCourierId('');
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
      {screen === 'debug' && (
        <DebugScreen token={token} onNavigateBack={() => setScreen(token ? 'home' : 'login')} />
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
