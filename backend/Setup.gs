/**
 * Setup.gs
 * Скрипт початкового налаштування бази даних у Google Sheets.
 * Запустіть функцію setupDatabase() в інтерфейсі Google Apps Script
 * для створення структури таблиць та заповнення тестовими даними.
 */

function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log("Помилка: Не вдалося отримати активну таблицю. Будь ласка, запустіть скрипт безпосередньо з Google Sheets (Розширення -> Apps Script).");
    return;
  }
  
  Logger.log("Початок налаштування бази даних у Google Sheets...");
  
  // 1. Створення аркушів та заголовків
  setupSheet(ss, "Couriers", [
    "courier_id", "name", "phone", "pin_hash", "token", "active", "platform", "notes", "region"
  ]);
  
  setupSheet(ss, "Locations", [
    "location_id", "name", "address", "latitude", "longitude", "radius_m", "indoor", "active", "updated_at", "notes", "region"
  ]);
  
  setupSheet(ss, "Shifts", [
    "shift_id", "courier_id", "start_time", "end_time", "duration_minutes", "device_platform", "app_version", "device_id", "status", "notes"
  ]);
  
  setupSheet(ss, "Visits", [
    "visit_id", "event_uuid", "courier_id", "shift_id", "location_id", "enter_time", "exit_time", "duration_seconds", 
    "enter_lat", "enter_lng", "exit_lat", "exit_lng", "accuracy_m", "matched_distance_m", "source", "offline_synced", "created_at", "raw_payload"
  ]);
  
  setupSheet(ss, "EventLog", [
    "log_id", "event_uuid", "courier_id", "shift_id", "event_type", "timestamp", "payload_json", "created_at"
  ]);
  
  setupSheet(ss, "Settings", [
    "key", "value"
  ]);
  
  setupSheet(ss, "CourierStatus", [
    "courier_id", "name", "last_seen", "latitude", "longitude", "accuracy_m", "battery_percent", "status", "map_link"
  ]);
  
  // 2. Заповнення налаштувань за замовчуванням (якщо порожньо)
  setupDefaultSettings(ss);
  
  // 3. Додавання тестових кур'єрів (якщо порожньо)
  setupSampleCouriers(ss);
  
  // 4. Додавання тестових локацій (якщо порожньо)
  setupSampleLocations(ss);
  
  Logger.log("Налаштування бази даних успішно завершено!");
}

/**
 * Створює аркуш, якщо він не існує, та встановлює заголовки колонок.
 */
function setupSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    Logger.log("Створено аркуш: " + name);
  } else {
    Logger.log("Аркуш " + name + " вже існує.");
  }
  
  // Якщо аркуш порожній або містить менше колонок, ніж треба, записуємо заголовки
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    Logger.log("Записано заголовки для аркуша " + name);
  }
}

/**
 * Записує дефолтні конфігураційні параметри у Settings
 */
function setupDefaultSettings(ss) {
  var sheet = ss.getSheetByName("Settings");
  if (!sheet) return;
  
  // Якщо таблиця містить тільки заголовок
  if (sheet.getLastRow() <= 1) {
    var defaults = [
      ["default_radius_m", "30"],
      ["dwell_seconds", "60"],
      ["location_interval_ms", "15000"],
      ["distance_filter_m", "10"],
      ["accuracy_ignore_m", "150"],
      ["manual_checkin_enabled", "true"],
      ["points_version", "1"],
      ["max_stay_minutes", "240"]
    ];
    
    sheet.getRange(2, 1, defaults.length, 2).setValues(defaults);
    Logger.log("Налаштування за замовчуванням збережено.");
  }
}

/**
 * Додає тестових кур'єрів у Couriers
 */
function setupSampleCouriers(ss) {
  var sheet = ss.getSheetByName("Couriers");
  if (!sheet) return;
  
  if (sheet.getLastRow() <= 1) {
    // Хеші для PIN-кодів:
    // PIN "1234" -> SHA-256: 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
    // PIN "5678" -> SHA-256: 3fdba35f04df8c45698a5e577d343c68370b93ca445aba39775ede22cf05d5e2
    var couriers = [
      ["C001", "Іван Коваленко", "+380501112233", "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4", "token-ivan-123", "true", "android", "Тестовий кур'єр (Android)", "Івано-Франківськ"],
      ["C002", "Марія Петренко", "+380674445566", "3fdba35f04df8c45698a5e577d343c68370b93ca445aba39775ede22cf05d5e2", "token-maria-456", "true", "ios", "Тестовий кур'єр (iOS)", "Київ"]
    ];
    
    sheet.getRange(2, 1, couriers.length, 9).setValues(couriers);
    Logger.log("Додано тестових кур'єрів (Іван: C001/1234, Марія: C002/5678).");
  }
}

/**
 * Додає тестові локації для геолокаційного аналізу (координати в центрі Києва)
 */
function setupSampleLocations(ss) {
  var sheet = ss.getSheetByName("Locations");
  if (!sheet) return;
  
  if (sheet.getLastRow() <= 1) {
    var nowStr = new Date().toISOString();
    var locations = [
      ["L001", "Київський ЦУМ", "вул. Хрещатик, 38", 50.4468, 30.5218, 30, "true", "true", nowStr, "ЦУМ (Торговий центр)", "Київ"],
      ["L002", "ТЦ Глобус", "Майдан Незалежності, 1", 50.4508, 30.5256, 30, "true", "true", nowStr, "Глобус (ТЦ, підземні зони)", "Київ"],
      ["L003", "Золоті Ворота", "вул. Володимирська, 40А", 50.4488, 30.5133, 30, "false", "true", nowStr, "Історична пам'ятка, відкритий простір", "Київ"],
      ["L004", "Бессарабська площа", "Бессарабська площа, 2", 50.4428, 30.5210, 35, "false", "true", nowStr, "Бессарабський ринок", "Київ"],
      ["L005", "Контрактова площа (Поділ)", "Контрактова площа, 4", 50.4632, 30.5186, 40, "false", "true", nowStr, "Подільський район, відкрита площа", "Київ"],
      ["L006", "Ратуша (Івано-Франківськ)", "площа Ринок, 1", 48.9229, 24.7101, 30, "false", "true", nowStr, "Центральна площа міста", "Івано-Франківськ"],
      ["L007", "ТЦ Велес (Івано-Франківськ)", "вул. Вовчинецька, 225А", 48.9392, 24.7397, 40, "true", "true", nowStr, "Великий ТЦ", "Івано-Франківськ"]
    ];
    
    sheet.getRange(2, 1, locations.length, 11).setValues(locations);
    Logger.log("Додано 7 тестових локацій (Київ та Івано-Франківськ).");
  }
}
