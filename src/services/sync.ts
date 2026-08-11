import { StorageService, SyncEvent } from './storage';
import { ApiService } from './api';

let syncInProgress = false;
let retryTimer: NodeJS.Timeout | null = null;
let currentBackoffSeconds = 5; // Початкова затримка повтору - 5 сек
let cachedSyncConfig: any = null;

// Простий генератор UUID для локальних подій
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const SyncService = {
  /**
   * Запис події візиту в чергу
   */
  async queueVisit(payload: any): Promise<void> {
    const config = await StorageService.getConfig();
    const queueLimit = config ? parseInt(config.sync_queue_max_size || '5000', 10) : 5000;
    const queue = await StorageService.getOfflineQueue();
    
    // Ліміт черги: видаляємо найстаріший лог-запис якщо черга переповнена
    if (queue.length >= queueLimit) {
      const firstLogIndex = queue.findIndex(e => e.event_type === 'log');
      if (firstLogIndex !== -1) {
        queue.splice(firstLogIndex, 1);
      }
    }

    const event: SyncEvent = {
      event_uuid: generateUUID(),
      event_type: 'visit',
      timestamp: new Date().toISOString(),
      payload: payload,
    };
    queue.push(event);
    await StorageService.setOfflineQueue(queue);
    
    // Спробуємо синхронізувати одразу при появі події
    this.triggerSync();
  },

  /**
   * Запис логу/діагностики в чергу
   */
  async queueLog(logType: string, message: string, details: any = null): Promise<void> {
    const config = await StorageService.getConfig();
    const queueLimit = config ? parseInt(config.sync_queue_max_size || '5000', 10) : 5000;
    const queue = await StorageService.getOfflineQueue();
    
    // Ліміт черги: видаляємо найстаріший лог-запис якщо черга переповнена
    if (queue.length >= queueLimit) {
      const firstLogIndex = queue.findIndex(e => e.event_type === 'log');
      if (firstLogIndex !== -1) {
        queue.splice(firstLogIndex, 1);
      }
    }
    
    const event: SyncEvent = {
      event_uuid: generateUUID(),
      event_type: 'log',
      timestamp: new Date().toISOString(),
      payload: {
        event_type: logType,
        message,
        details,
      },
    };
    queue.push(event);
    await StorageService.setOfflineQueue(queue);
    
    this.triggerSync();
  },

  /**
   * Головний метод синхронізації черги з сервером
   */
  async triggerSync(): Promise<void> {
    if (syncInProgress) return;
    syncInProgress = true;
    
    try {
      cachedSyncConfig = await StorageService.getConfig();
      const token = await StorageService.getToken();
      const courierId = await StorageService.getCourierId();
      if (!token || !courierId) return;

      const queue = await StorageService.getOfflineQueue();
      if (queue.length === 0) return;

      const activeShift = await StorageService.getActiveShift();
      const shiftId = activeShift ? activeShift.shift_id : null;
      
      // Копіюємо батч для синхронізації
      const batch = [...queue];

      const result = await ApiService.syncBatch(token, courierId, shiftId, batch);
      
      if (result.ok) {
        // Успішно синхронізовано - видаляємо надіслані записи з черги
        const currentQueue = await StorageService.getOfflineQueue();
        const updatedQueue = currentQueue.filter(
          (qItem) => !batch.some((bItem) => bItem.event_uuid === qItem.event_uuid)
        );
        
        await StorageService.setOfflineQueue(updatedQueue);
        const initialBackoff = cachedSyncConfig ? parseInt(cachedSyncConfig.sync_backoff_initial_s || '5', 10) : 5;
        currentBackoffSeconds = initialBackoff; // Скидаємо бекофф при успіху
        
        // Якщо в черзі з'явилися нові елементи під час синхронізації — запустимо ще раз
        if (updatedQueue.length > 0) {
          // Ми викликаємо це після try/finally через setTimeout щоб уникнути рекурсії або просто нехай виконається пізніше
          setTimeout(() => this.triggerSync(), 0);
        }
      } else {
        throw new Error(result.error || 'Server rejected batch');
      }
    } catch (error) {
      console.warn('Помилка синхронізації, плануємо повтор:', error);
      this.scheduleRetry();
    } finally {
      syncInProgress = false;
    }
  },

  /**
   * Планування повтору з експоненціальною затримкою
   */
  scheduleRetry(): void {
    if (retryTimer) return;

    retryTimer = setTimeout(() => {
      retryTimer = null;
      const maxBackoff = cachedSyncConfig ? parseInt(cachedSyncConfig.sync_backoff_max_s || '300', 10) : 300;
      // Збільшуємо затримку (макс. згідно конфігу)
      currentBackoffSeconds = Math.min(currentBackoffSeconds * 2, maxBackoff);
      this.triggerSync();
    }, currentBackoffSeconds * 1000);
  }
};
