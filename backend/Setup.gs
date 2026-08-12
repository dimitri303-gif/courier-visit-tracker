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
    "location_id", "name", "address", "latitude", "longitude", "radius_m", "indoor", "active", "updated_at", "notes", "region", "map_link"
  ]);
  
  setupSheet(ss, "Logists", [
    "logist_id", "name", "phone", "pin_hash", "token", "active", "platform", "notes", "region"
  ]);
  
  setupSheet(ss, "Shifts", [
    "shift_id", "courier_id", "start_time", "end_time", "duration_minutes", "device_platform", "app_version", "device_id", "status", "notes"
  ]);
  
  setupSheet(ss, "Visits", [
    "visit_id", "event_uuid", "courier_id", "shift_id", "location_id", "enter_time", "exit_time", "duration_seconds", 
    "enter_lat", "enter_lng", "exit_lat", "exit_lng", "accuracy_m", "matched_distance_m", "source", "offline_synced", "created_at", "raw_payload"
  ]);
  
  setupSheet(ss, "Stops", [
    "stop_id", "courier_id", "shift_id", "start_time", "end_time", "duration_minutes", 
    "anchor_lat", "anchor_lng", "max_drift_m", "created_at", "map_link"
  ]);
  
  setupSheet(ss, "EventLog", [
    "log_id", "event_uuid", "courier_id", "shift_id", "event_type", "timestamp", "payload_json", "created_at"
  ]);
  
  setupSheet(ss, "Settings", [
    "key", "value"
  ]);
  
  setupSheet(ss, "CourierStatus", [
    "courier_id", "name", "last_seen", "latitude", "longitude", "accuracy_m", "battery_percent", "status", "map_link", "location_request"
  ]);
  
  // 2. Заповнення налаштувань за замовчуванням (якщо порожньо)
  setupDefaultSettings(ss);
  
  // 3. Додавання тестових кур'єрів (якщо порожньо)
  setupSampleCouriers(ss);
  
  // 3.5. Додавання тестових логістів (якщо порожньо)
  setupSampleLogists(ss);
  
  // 4. Додавання тестових локацій (якщо порожньо)
  setupSampleLocations(ss);
  
  // 5. Створення аркуша мануалу
  createManualSheet();
  
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
  
  var defaults = [
    ["default_radius_m", "30"],
    ["dwell_seconds", "60"],
    ["location_interval_ms", "15000"],
    ["distance_filter_m", "10"],
    ["accuracy_ignore_m", "150"],
    ["manual_checkin_enabled", "true"],
    ["points_version", "1"],
    ["max_stay_minutes", "240"],
    ["heartbeat_interval_minutes", "10"],
    // Нові параметри синхронізації
    ["sync_backoff_initial_s", "5"],
    ["sync_backoff_max_s", "300"],
    ["sync_queue_max_size", "5000"],
    // Мережеві параметри
    ["http_timeout_ms", "30000"],
    // GPS параметри
    ["gps_single_timeout_ms", "5000"],
    ["gps_accuracy", "4"],
    // Детектор виходу з точки
    ["exit_window_size", "5"],
    ["exit_threshold", "3"],
    // Зупинки (Idle)
    ["idle_threshold_minutes", "10"],
    ["idle_radius_m", "20"],
    // Ручний чекін
    ["manual_checkin_max_distance_m", "200"],
    // Інтервали UI
    ["points_sync_interval_ms", "30000"],
    // Текст нотифікацій
    ["notification_title", "Відстеження робочої зміни"],
    ["notification_body", "Додаток фіксує ваші візити на точки доставки."]
  ];
  
  var data = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][0]).trim();
    if (k !== "") {
      existingKeys[k] = true;
    }
  }
  
  for (var j = 0; j < defaults.length; j++) {
    var defKey = defaults[j][0];
    var defVal = defaults[j][1];
    if (!existingKeys[defKey]) {
      sheet.appendRow([defKey, defVal]);
      Logger.log("Додано відсутнє налаштування: " + defKey + " = " + defVal);
    }
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

/**
 * Створює та заповнює аркуш "Мануал" з детальним описом структури бази даних.
 */
function createManualSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log("Помилка: Не вдалося отримати активну таблицю.");
    return;
  }
  
  var sheetName = "Мануал";
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    try {
      ss.deleteSheet(sheet);
    } catch(e) {
      // Ігноруємо якщо єдина вкладка
    }
  }
  sheet = ss.insertSheet(sheetName);
  
  // Заголовки
  var headers = ["Аркуш (Sheet)", "Колонка (Column)", "Тип даних", "Опис (Description)", "Приклад / Рекомендація"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  var data = [
    // --- COURIERS ---
    ["Couriers (Кур'єри)", "courier_id", "Текст", "Унікальний ідентифікатор кур'єра. Використовується для авторизації та зв'язку з усіма подіями.", "C001"],
    ["Couriers (Кур'єри)", "name", "Текст", "Прізвище, Ім'я кур'єра. Відображається в інтерфейсі адміністратора та звітах.", "Іван Коваленко"],
    ["Couriers (Кур'єри)", "phone", "Текст", "Номер телефону кур'єра для оперативної комунікації.", "+380501112233"],
    ["Couriers (Кур'єри)", "pin_hash", "Текст", "Зашифрований SHA-256 хеш PIN-коду. Використовується додатком для перевірки пароля при вході.", "03ac674216f3e15c7... (формула =HASH_PIN(1234))"],
    ["Couriers (Кур'єри)", "token", "Текст", "Унікальний UUID токен сесії. Генерується автоматично при першому успішному вході кур'єра.", "a1b2c3d4-e5f6-..."],
    ["Couriers (Кур'єри)", "active", "Логічне", "Статус облікового запису. Якщо вказати FALSE, кур'єр не зможе увійти в додаток чи почати зміну.", "TRUE / FALSE"],
    ["Couriers (Кур'єри)", "platform", "Текст", "Платформа пристрою кур'єра. Записується автоматично при авторизації.", "android / ios"],
    ["Couriers (Кур'єри)", "notes", "Текст", "Примітки адміністратора (наприклад, коментарі щодо графіка чи умов роботи).", "Працює на власному авто"],
    ["Couriers (Кур'єри)", "region", "Текст", "Регіональна прив'язка кур'єра. Використовується для фільтрації точок (додаток завантажить лише точки з цим регіоном).", "Вінниця / Київ"],
    
    // --- LOCATIONS ---
    ["Locations (Точки)", "location_id", "Текст", "Унікальний код торгової точки або географічного пункту доставки.", "L001"],
    ["Locations (Точки)", "name", "Текст", "Коротка зрозуміла назва локації (клієнт, магазин, склад). Відображається кур'єру.", "Магазин 600-річчя"],
    ["Locations (Точки)", "address", "Текст", "Фізична адреса об'єкта. Відображається у списку ручного чек-іну та звітах.", "вул. 600-річчя, 17"],
    ["Locations (Точки)", "latitude", "Число", "Географічна широта центру об'єкта. Отримується з Google Maps.", "49.227430"],
    ["Locations (Точки)", "longitude", "Число", "Географічна довгота центру об'єкта. Отримується з Google Maps.", "28.427128"],
    ["Locations (Точки)", "radius_m", "Число", "Радіус віртуальної зони (геофенсу) в метрах. Рекомендовано від 30 до 40 метрів.", "30 (рекомендовано)"],
    ["Locations (Точки)", "indoor", "Логічне", "Ознака того, чи точка всередині будівлі. Допомагає згладжувати стрибки GPS.", "TRUE / FALSE"],
    ["Locations (Точки)", "active", "Логічне", "Чи активна точка. Додаток завантажує на пристрої кур'єрів тільки точки зі статусом TRUE.", "TRUE / FALSE"],
    ["Locations (Точки)", "updated_at", "Дата / Час", "Час останнього оновлення параметрів локації адміністратором.", "08.08.2026 14:10:00"],
    ["Locations (Точки)", "notes", "Текст", "Примітки щодо локації (наприклад, 'вхід з торця будівлі'). Кур'єрам не показується.", "Код дверей 45"],
    ["Locations (Точки)", "region", "Текст", "Назва регіону/міста точки. Має збігатися з регіоном кур'єра для завантаження на пристрій.", "Вінниця"],
    
    // --- SHIFTS ---
    ["Shifts (Зміни)", "shift_id", "Текст", "Унікальний UUID код робочої зміни. Створюється на телефоні при натисканні 'Почати зміну'.", "x1y2z3..."],
    ["Shifts (Зміни)", "courier_id", "Текст", "ID кур'єра, який відкрив або закрив цю зміну.", "C003"],
    ["Shifts (Зміни)", "start_time", "Дата / Час", "Час відкриття робочої зміни (початок відстеження координат у фоні).", "08.08.2026 09:00:00"],
    ["Shifts (Зміни)", "end_time", "Дата / Час", "Час закриття робочої зміни. Записується при натисканні 'Завершити зміну'.", "08.08.2026 18:00:00"],
    ["Shifts (Зміни)", "duration_minutes", "Число", "Тривалість зміни у хвилинах. Розраховується автоматично при закритті зміни.", "540"],
    ["Shifts (Зміни)", "device_platform", "Текст", "Платформа телефону, з якого працював кур'єр.", "android / ios"],
    ["Shifts (Зміни)", "app_version", "Текст", "Версія мобільного додатку.", "1.0.2"],
    ["Shifts (Зміни)", "device_id", "Текст", "Ідентифікатор пристрою (для діагностики фонової служби).", "expo_android"],
    ["Shifts (Зміни)", "status", "Текст", "Поточний статус зміни: active (відкрита), ended (закрита), auto-closed (автозакрита системою вночі).", "ended"],
    ["Shifts (Зміни)", "notes", "Текст", "Будь-які коментарі адміністратора щодо зміни.", "Забув закрити зміну"],
    
    // --- VISITS ---
    ["Visits (Візити)", "visit_id", "Текст", "Унікальний UUID запису візиту на торгову точку.", "v1w2x3..."],
    ["Visits (Візити)", "event_uuid", "Текст", "Унікальний ID події з телефону. Сервер використовує його для дедуплікації при повторній синхронізації.", "e1f2g3..."],
    ["Visits (Візити)", "courier_id", "Текст", "Код кур'єра, який здійснив візит.", "C003"],
    ["Visits (Візити)", "shift_id", "Текст", "ID робочої зміни, в рамках якої здійснено візит.", "x1y2z3..."],
    ["Visits (Візити)", "location_id", "Текст", "Код відвіданої торгової точки.", "L003"],
    ["Visits (Візити)", "enter_time", "Дата / Час", "Час входу кур'єра в радіус локації (після перебування там понад 60 секунд).", "08.08.2026 10:15:30"],
    ["Visits (Візити)", "exit_time", "Дата / Час", "Час виходу з радіусу локації.", "08.08.2026 10:25:12"],
    ["Visits (Візити)", "duration_seconds", "Число", "Час перебування кур'єра на точці у секундах.", "582"],
    ["Visits (Візити)", "enter_lat / enter_lng", "Число", "Координати кур'єра в момент реєстрації входу на точку.", "49.22236, 28.43827"],
    ["Visits (Візити)", "exit_lat / exit_lng", "Число", "Координати кур'єра в момент реєстрації виходу з точки.", "49.22240, 28.43830"],
    ["Visits (Візити)", "accuracy_m", "Число", "Точність GPS-сигналу в момент входу на локацію.", "15"],
    ["Visits (Візити)", "matched_distance_m", "Число", "Розрахована відстань у метрах від кур'єра до центру точки в момент фіксації входу.", "8.5"],
    ["Visits (Візити)", "source", "Текст", "Спосіб фіксації: auto (автоматично по GPS), manual (ручний чек-ін у радіусі), manual_no_gps (ручний без GPS).", "auto / manual"],
    ["Visits (Візити)", "offline_synced", "Логічне", "Вказує, чи був візит переданий з офлайн-черги після відновлення мобільного інтернету.", "TRUE / FALSE"],
    ["Visits (Візити)", "created_at", "Дата / Час", "Дата та час запису події на сервері Google Таблиць.", "08.08.2026 10:26:00"],
    ["Visits (Візити)", "raw_payload", "Текст", "Повний сирий пакет даних у форматі JSON (для аудиту та технічного аналізу).", "{\"event_uuid\":\"...\"}"],
    
    // --- EVENT LOG ---
    ["EventLog (Логи)", "log_id", "Текст", "Унікальний ідентифікатор запису системного журналу.", "l1m2n3..."],
    ["EventLog (Логи)", "event_uuid", "Текст", "Унікальний ID події на пристрої для дедуплікації.", "e4f5g6..."],
    ["EventLog (Логи)", "courier_id", "Текст", "Код кур'єра, на пристрої якого відбулася подія.", "C003"],
    ["EventLog (Логи)", "shift_id", "Текст", "Код робочої зміни, під час якої відбувся запис.", "x1y2z3..."],
    ["EventLog (Логи)", "event_type", "Текст", "Тип події: tracking_started (старт фону), gps_warning (вимкнено GPS), permission_denied (немає прав), тощо.", "gps_warning"],
    ["EventLog (Логи)", "timestamp", "Дата / Час", "Час події на пристрої кур'єра.", "08.08.2026 11:30:15"],
    ["EventLog (Логи)", "payload_json", "Текст", "Додатковий технічний опис події або text помилки у форматі JSON.", "{\"details\":\"Location timeout\"}"],
    ["EventLog (Логи)", "created_at", "Дата / Час", "Час запису логу на сервері.", "08.08.2026 11:31:00"],
    
    // --- SETTINGS ---
    ["Settings (Налаштування)", "key", "Текст", "Унікальний ключ конфігураційного параметра системи. Зміни застосовуються 'на льоту' без перевипуску додатку.", "points_version / location_interval_ms"],
    ["Settings (Налаштування)", "value", "Текст / Число", "Значення конфігураційного параметра.", "15000 / true / 60"],
    ["Settings (Налаштування)", "points_version", "Число", "Версія каталогу точок. При збільшенні цього значення (+1) мобільні додатки кур'єрів автоматично завантажують оновлені точки з аркуша Locations.", "1 (збільшувати +1 при зміні точок)"],
    ["Settings (Налаштування)", "location_interval_ms", "Число", "Частота фонового опитування GPS у мілісекундах. 15000 = 15 секунд. Автоматично перезапускает GPS-службу 'на льоту'.", "15000"],
    ["Settings (Налаштування)", "distance_filter_m", "Метри", "Мінімальне зміщення кур'єра в метрах для активації нового обчислення GPS. Заощаджує заряд батареї при зупинці.", "10"],
    ["Settings (Налаштування)", "gps_accuracy", "Число", "Рівень точності GPS: 3 (Balanced/~100м), 4 (High/~5-10м), 5 (BestForNavigation). Обмежено 3-5 для стабільності.", "4"],
    ["Settings (Налаштування)", "accuracy_ignore_m", "Метри", "Похибка GPS в метрах, вище якої координати ігноруються як неточні (при стрибках сигналу в будівлях).", "150"],
    ["Settings (Налаштування)", "default_radius_m", "Метри", "Радіус геозони за замовчуванням для точок, де в аркуші Locations не задано власний radius_m.", "30"],
    ["Settings (Налаштування)", "dwell_seconds", "Секунди", "Мінімальний час безперервного перебування в геозоні для зарахування та підтвердження візиту.", "60"],
    ["Settings (Налаштування)", "max_stay_minutes", "Хвилини", "Максимальний час перебування на точці. При перевищенні візит примусово закривається з логом max_stay_exceeded.", "240"],
    ["Settings (Налаштування)", "heartbeat_interval_minutes", "Хвилини", "Частота відправки фонового журналу стану та точних координат кур'єра на сервер для дашборду.", "10"],
    ["Settings (Налаштування)", "exit_window_size", "Число", "Розмір ковзного вікна (кількість останніх GPS вимірів) для детекції виходу з геозони.", "5"],
    ["Settings (Налаштування)", "exit_threshold", "Число", "Кількість вимірів 'ззовні' з ковзного вікна (наприклад, 3 з 5), необхідна для фіксації виходу. Захист від джиттеру.", "3"],
    ["Settings (Налаштування)", "manual_checkin_enabled", "Логічне", "Дозвіл на ручний чекін (true / false). При false екран чекіну блокується з повідомленням адміністратора.", "true / false"],
    ["Settings (Налаштування)", "manual_checkin_max_distance_m", "Метри", "Максимальна відстань від кур'єра до точки для відображення у списку ручного чекіну поруч.", "200"],
    ["Settings (Налаштування)", "gps_single_timeout_ms", "Мс", "Таймаут для точкових запитів GPS (ручний чекін, старт/енд зміни).", "5000"],
    ["Settings (Налаштування)", "sync_queue_max_size", "Число", "Максимальна кількість записів в офлайн-черзі. При переповненні видаляються найстаріші логи, зберігаючи візити.", "5000"],
    ["Settings (Налаштування)", "sync_backoff_initial_s", "Секунди", "Початкова затримка повторної відправки даних при відновленні мережі.", "5"],
    ["Settings (Налаштування)", "sync_backoff_max_s", "Секунди", "Максимальна затримка повтору синхронізації при збої інтернет-з'єднання.", "300"],
    ["Settings (Налаштування)", "http_timeout_ms", "Мс", "Таймаут мережевих HTTP-запитів до сервера (AbortController).", "30000"],
    ["Settings (Налаштування)", "points_sync_interval_ms", "Мс", "Інтервал автооновлення точок та конфігурації на екрані мобільного додатку.", "30000"],
    ["Settings (Налаштування)", "notification_title", "Текст", "Заголовок постійного сповіщення фонової GPS-служби на Android.", "Відстеження робочої зміни"],
    ["Settings (Налаштування)", "notification_body", "Текст", "Текст постійного сповіщення фонової GPS-служби на Android.", "Додаток фіксує ваші візити на точки доставки."],
    
    // --- COURIER STATUS ---
    ["CourierStatus (Статус)", "courier_id", "Текст", "Код кур'єра.", "C003"],
    ["CourierStatus (Статус)", "name", "Текст", "Ім'я кур'єра.", "Я"],
    ["CourierStatus (Статус)", "last_seen", "Дата / Час", "Час останнього сеансу зв'язку додатку з сервером (передача координат).", "08.08.2026 13:57:11"],
    ["CourierStatus (Статус)", "latitude / longitude", "Число", "Останні геокоординати кур'єра.", "49.221259, 28.438311"],
    ["CourierStatus (Статус)", "accuracy_m", "Число", "Точність останнього виміру GPS у метрах.", "20"],
    ["CourierStatus (Статус)", "battery_percent", "Число", "Поточний відсоток заряду батареї (зарезервовано під майбутнє оновлення).", "null (пусто)"],
    ["CourierStatus (Статус)", "status", "Текст", "Поточний робочий статус кур'єра: active (на зміні), ended (зміну завершено).", "ended"],
    ["CourierStatus (Статус)", "map_link", "Формула", "Динамічне посилання на Google Maps для швидкого перегляду поточного положення кур'єра.", "=HYPERLINK(...)"]
  ];
  
  // Записуємо дані
  sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
  
  // Форматування
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold")
                                         .setBackground("#6366F1")
                                         .setFontColor("#FFFFFF")
                                         .setHorizontalAlignment("center")
                                         .setVerticalAlignment("middle");
  
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  
  // Робимо сітку та вирівнювання
  var fullRange = sheet.getRange(1, 1, data.length + 1, headers.length);
  fullRange.setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
  fullRange.setFontFamily("Arial");
  
  // Встановлюємо ширину колонок
  sheet.setColumnWidth(1, 170); // Аркуш
  sheet.setColumnWidth(2, 150); // Колонка
  sheet.setColumnWidth(3, 100); // Тип даних
  sheet.setColumnWidth(4, 480); // Опис
  sheet.setColumnWidth(5, 250); // Приклад
  
  // Увімкнути перенос тексту для опису
  sheet.getRange(2, 4, data.length, 1).setWrap(true);
  
  // Додамо красиву групу підсвітки для різних аркушів
  var currentSheet = "";
  var colors = ["#f8fafc", "#f1f5f9"];
  var colorIdx = 0;
  var startRow = 2;
  
  for (var r = 0; r < data.length; r++) {
    if (data[r][0] !== currentSheet) {
      if (r > 0) {
        var numRows = (r + 2) - startRow;
        sheet.getRange(startRow, 1, numRows, headers.length).setBackground(colors[colorIdx % 2]);
        colorIdx++;
        startRow = r + 2;
      }
      currentSheet = data[r][0];
    }
  }
  // для останньої групи
  var numRowsLast = (data.length + 2) - startRow;
  sheet.getRange(startRow, 1, numRowsLast, headers.length).setBackground(colors[colorIdx % 2]);
  
  Logger.log("Аркуш 'Мануал' успішно створено та оформлено!");
}

/**
 * Додає тестового логіста у Logists
 */
function setupSampleLogists(ss) {
  var sheet = ss.getSheetByName("Logists");
  if (!sheet) return;
  
  if (sheet.getLastRow() <= 1) {
    // PIN "1234" -> SHA-256: 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
    var logists = [
      ["LO001", "Ігор Логіст", "+380679998877", "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4", "", "true", "", "Тестовий логіст ІФ", "Івано-Франківськ"]
    ];
    
    sheet.getRange(2, 1, logists.length, 9).setValues(logists);
    Logger.log("Додано тестового логіста (Ігор: LO001/1234).");
  }
}

/**
 * Додає логіста Настю Компанієць для Івано-Франківська
 */
function addNastiaLogist() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Logists");
  if (!sheet) {
    Browser.msgBox("Помилка: Аркуш 'Logists' не знайдено!");
    return;
  }
  
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === "LO002" || String(data[i][2]).replace(/[^0-9]/g, "").indexOf("0689471441") !== -1) {
      Browser.msgBox("Логіст Настя вже є у базі під ID: " + data[i][0]);
      return;
    }
  }
  
  // Додаємо новий рядок
  // PIN за замовчуванням: 1234 -> hash: 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
  sheet.appendRow([
    "LO002",
    "Компанієць Настя Логіст",
    "0689471441",
    "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
    "",
    "true",
    "",
    "Логіст ІФ",
    "Івано-Франківськ"
  ]);
  
  Browser.msgBox("Логіста Настю успішно додано!\n\nДані для входу у додаток:\nID: LO002\nPIN: 1234\nРегіон: Івано-Франківськ");
}


