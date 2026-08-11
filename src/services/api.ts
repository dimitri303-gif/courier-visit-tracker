import { StorageService } from './storage';

export interface LocationResponse {
  ok: boolean;
  points_version: number;
  points?: any[];
  status?: string;
  error?: string;
}

let responseInterceptor: ((data: any) => void) | null = null;

function processInterceptor(result: any) {
  if (responseInterceptor && result) {
    responseInterceptor(result);
  }
}

export const ApiService = {
  setResponseInterceptor(interceptor: (data: any) => void) {
    responseInterceptor = interceptor;
  },

  /**
   * Загальний хелпер для виконання POST-запитів до Google Apps Script.
   * Надсилає дані як text/plain з JSON-рядком, щоб уникнути CORS-проблем
   * та спростити отримання даних на сервері через e.postData.contents.
   */
  async post(action: string, payload: any): Promise<any> {
    const baseUrl = await StorageService.getApiUrl();
    const url = `${baseUrl}?action=${action}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    processInterceptor(result);
    return result;
  },

  async login(courierId: string, pin: string): Promise<any> {
    return this.post('login', {
      courier_id: courierId,
      pin: pin,
    });
  },

  async getPoints(token: string, version: number): Promise<LocationResponse> {
    const baseUrl = await StorageService.getApiUrl();
    const url = `${baseUrl}?action=points&token=${token}&version=${version}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const result = await response.json();
    processInterceptor(result);
    return result;
  },

  async getConfig(token: string): Promise<any> {
    const baseUrl = await StorageService.getApiUrl();
    const url = `${baseUrl}?action=config&token=${token}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const result = await response.json();
    processInterceptor(result);
    return result;
  },

  async startShift(
    token: string,
    shiftId: string,
    courierId: string,
    deviceId: string,
    platform: string,
    appVersion: string,
    startTime: string,
    coords: { latitude: number; longitude: number; accuracy_m: number } | null,
    battery: number | null
  ): Promise<any> {
    return this.post('shift/start', {
      token,
      shift_id: shiftId,
      courier_id: courierId,
      device_id: deviceId,
      platform,
      app_version: appVersion,
      start_time: startTime,
      location: coords,
      battery,
    });
  },

  async endShift(
    token: string,
    shiftId: string,
    courierId: string,
    endTime: string,
    coords: { latitude: number; longitude: number; accuracy_m: number } | null,
    battery: number | null
  ): Promise<any> {
    return this.post('shift/end', {
      token,
      shift_id: shiftId,
      courier_id: courierId,
      end_time: endTime,
      location: coords,
      battery,
    });
  },

  async syncBatch(
    token: string,
    courierId: string,
    shiftId: string | null,
    events: any[]
  ): Promise<any> {
    return this.post('events/batch', {
      token,
      courier_id: courierId,
      shift_id: shiftId,
      batch: events,
    });
  },

  async getLogistCouriers(token: string): Promise<any> {
    return this.post('logist/couriers', {
      token,
    });
  },

  async requestCourierLocation(token: string, targetCourierId: string): Promise<any> {
    return this.post('logist/request-location', {
      token,
      courier_id: targetCourierId,
    });
  }
};
