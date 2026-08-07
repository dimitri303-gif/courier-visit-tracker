import { StorageService, SyncEvent } from './storage';
import { ApiService } from './api';

let isSyncing = false;
let retryTimer: NodeJS.Timeout | null = null;
let currentBackoffSeconds = 5; // Початкова затримка повтору - 5 сек

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
    const queue = await StorageService.getOfflineQueue();
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
    const queue = await StorageService.getOfflineQueue();
    
    // Для запобігання надмірному зростанню логів обмежимо їх розмір
    if (queue.filter(e => e.event_type === 'log').length > 500) {
      // Видаляємо найстаріший лог
      const firstLogIndex = queue.findIndex(e => e.event_type === 'log');
      if (firstLogIndex !== -1) queue.splice(firstLogIndex, 1);
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
    if (isSyncing) return;
    
    const token = await StorageService.getToken();
    const courierId = await StorageService.getCourierId();
    if (!token || !courierId) return;

    const queue = await StorageService.getOfflineQueue();
    if (queue.length === 0) return;

    isSyncing = true;
    const activeShift = await StorageService.getActiveShift();
    const shiftId = activeShift ? activeShift.shift_id : null;
    
    // Копіюємо батч для синхронізації
    const batch = [...queue];

    try {
      const result = await ApiService.syncBatch(token, courierId, shiftId, batch);
      
      if (result.ok) {
        // Успішно синхронізовано - видаляємо надіслані записи з черги
        const currentQueue = await StorageService.getOfflineQueue();
        const updatedQueue = currentQueue.filter(
          (qItem) => !batch.some((bItem) => bItem.event_uuid === qItem.event_uuid)
        );
        
        await StorageService.setOfflineQueue(updatedQueue);
        isSyncing = false;
        currentBackoffSeconds = 5; // Скидаємо бекофф при успіху
        
        // Якщо в черзі з'явилися нові елементи під час синхронізації — запустимо ще раз
        if (updatedQueue.length > 0) {
          this.triggerSync();
        }
      } else {
        throw new Error(result.error || 'Server rejected batch');
      }
    } catch (error) {
      console.warn('Помилка синхронізації, плануємо повтор:', error);
      isSyncing = false;
      this.scheduleRetry();
    }
  },

  /**
   * Планування повтору з експоненціальною затримкою
   */
  scheduleRetry(): void {
    if (retryTimer) return;

    retryTimer = setTimeout(() => {
      retryTimer = null;
      // Збільшуємо затримку (макс. 5 хвилин)
      currentBackoffSeconds = Math.min(currentBackoffSeconds * 2, 300);
      this.triggerSync();
    }, currentBackoffSeconds * 1000);
  }
};
