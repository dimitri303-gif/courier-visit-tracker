import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Location {
  location_id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  indoor: boolean;
}

export interface Shift {
  shift_id: string;
  courier_id: string;
  start_time: string;
  status: 'active' | 'ended' | 'auto-closed';
}

export interface SyncEvent {
  event_uuid: string;
  event_type: 'visit' | 'manual_checkin' | 'log';
  timestamp: string;
  payload: any;
}

const KEYS = {
  API_URL: '@api_url',
  TOKEN: '@session_token',
  COURIER_ID: '@courier_id',
  COURIER_NAME: '@courier_name',
  ACTIVE_SHIFT: '@active_shift',
  LOCATIONS: '@locations_cache',
  POINTS_VERSION: '@points_version',
  CONFIG: '@config',
  OFFLINE_QUEUE: '@offline_queue',
  LAST_HEARTBEAT: '@last_heartbeat',
  USER_ROLE: '@user_role',
  USER_REGION: '@user_region',
};

// Дефолтна адреса бекенду (може бути змінена в екрані Debug)
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbwobsbpl3llmUB_GwHsZAFc15qlyt75DbzmADrcwqgOKdHWs1Xp9KiXKEls2Qw1DBchuQ/exec';

export const StorageService = {
  async getApiUrl(): Promise<string> {
    const url = await AsyncStorage.getItem(KEYS.API_URL);
    return url || DEFAULT_API_URL;
  },

  async setApiUrl(url: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.API_URL, url);
  },

  async getToken(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.TOKEN);
  },

  async setToken(token: string | null): Promise<void> {
    if (token) {
      await AsyncStorage.setItem(KEYS.TOKEN, token);
    } else {
      await AsyncStorage.removeItem(KEYS.TOKEN);
    }
  },

  async getCourierId(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.COURIER_ID);
  },

  async setCourierId(id: string | null): Promise<void> {
    if (id) {
      await AsyncStorage.setItem(KEYS.COURIER_ID, id);
    } else {
      await AsyncStorage.removeItem(KEYS.COURIER_ID);
    }
  },

  async getCourierName(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.COURIER_NAME);
  },

  async setCourierName(name: string | null): Promise<void> {
    if (name) {
      await AsyncStorage.setItem(KEYS.COURIER_NAME, name);
    } else {
      await AsyncStorage.removeItem(KEYS.COURIER_NAME);
    }
  },

  async getActiveShift(): Promise<Shift | null> {
    const data = await AsyncStorage.getItem(KEYS.ACTIVE_SHIFT);
    return data ? JSON.parse(data) : null;
  },

  async setActiveShift(shift: Shift | null): Promise<void> {
    if (shift) {
      await AsyncStorage.setItem(KEYS.ACTIVE_SHIFT, JSON.stringify(shift));
    } else {
      await AsyncStorage.removeItem(KEYS.ACTIVE_SHIFT);
    }
  },

  async getLocations(): Promise<Location[]> {
    const data = await AsyncStorage.getItem(KEYS.LOCATIONS);
    return data ? JSON.parse(data) : [];
  },

  async setLocations(locations: Location[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.LOCATIONS, JSON.stringify(locations));
  },

  async getPointsVersion(): Promise<number> {
    const v = await AsyncStorage.getItem(KEYS.POINTS_VERSION);
    return v ? parseInt(v, 10) : 0;
  },

  async setPointsVersion(version: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.POINTS_VERSION, String(version));
  },

  async getConfig(): Promise<any> {
    const data = await AsyncStorage.getItem(KEYS.CONFIG);
    return data ? JSON.parse(data) : null;
  },

  async setConfig(config: any): Promise<void> {
    await AsyncStorage.setItem(KEYS.CONFIG, JSON.stringify(config));
  },

  async getOfflineQueue(): Promise<SyncEvent[]> {
    const data = await AsyncStorage.getItem(KEYS.OFFLINE_QUEUE);
    return data ? JSON.parse(data) : [];
  },

  async setOfflineQueue(queue: SyncEvent[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
  },

  async getLastHeartbeatTime(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.LAST_HEARTBEAT);
  },

  async setLastHeartbeatTime(time: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_HEARTBEAT, time);
  },

  async clearSession(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.TOKEN);
    await AsyncStorage.removeItem(KEYS.COURIER_ID);
    await AsyncStorage.removeItem(KEYS.COURIER_NAME);
    await AsyncStorage.removeItem(KEYS.ACTIVE_SHIFT);
    await AsyncStorage.removeItem(KEYS.USER_ROLE);
    await AsyncStorage.removeItem(KEYS.USER_REGION);
  },

  async getRole(): Promise<'courier' | 'logist' | null> {
    return AsyncStorage.getItem(KEYS.USER_ROLE) as Promise<'courier' | 'logist' | null>;
  },

  async setRole(role: 'courier' | 'logist' | null): Promise<void> {
    if (role) {
      await AsyncStorage.setItem(KEYS.USER_ROLE, role);
    } else {
      await AsyncStorage.removeItem(KEYS.USER_ROLE);
    }
  },

  async getRegion(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.USER_REGION);
  },

  async setRegion(region: string | null): Promise<void> {
    if (region) {
      await AsyncStorage.setItem(KEYS.USER_REGION, region);
    } else {
      await AsyncStorage.removeItem(KEYS.USER_REGION);
    }
  }
};
