/**
 * Code.gs
 * Основний API-сервіс для обробки запитів додатку Courier Visit Tracker MVP.
 * Реалізує маршрутизацію запитів doGet() та doPost(), перевірку авторизації,
 * роботу з LockService для уникнення конфліктів запису, та запис даних.
 */

// Системні налаштування за замовчуванням
var CACHE_TIME_SECS = 300; // 5 хвилин для кешування конфігурацій

/**
 * Хелпер для створення JSON відповідей
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Хелпер для SHA-256 хешування PIN-коду
 */
function hashPin(pin) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin, Utilities.Charset.UTF_8);
  var hashStr = "";
  for (var i = 0; i < rawHash.length; i++) {
    var byteVal = rawHash[i];
    if (byteVal < 0) byteVal += 256;
    var byteStr = byteVal.toString(16);
    if (byteStr.length == 1) byteStr = "0" + byteStr;
    hashStr += byteStr;
  }
  return hashStr;
}

/**
 * GET маршрутизатор
 */
function doGet(e) {
  var action = e.parameter.action;
  
  // Автоматично оновлюємо структуру БД та логістів за потреби
  try {
    checkAndAutoSetup();
  } catch(err) {
    Logger.log("Auto-setup check error: " + err.toString());
  }
  
  // Якщо дія не задана, віддаємо веб-інтерфейс для iOS fallback
  if (!action) {
    try {
      var template = HtmlService.createTemplateFromFile("Web");
      // Передаємо URL веб-додатку в шаблон для відправки запитів до себе
      template.webAppUrl = ScriptApp.getService().getUrl();
      return template.evaluate()
        .setTitle("Courier Visit Tracker MVP")
        .addMetaTag("viewport", "width=device-width, initial-scale=1")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch(err) {
      return ContentService.createTextOutput("Помилка завантаження веб-інтерфейсу: " + err.toString());
    }
  }
  
  if (action === "dashboard") {
    try {
      var template = HtmlService.createTemplateFromFile("Dashboard");
      template.webAppUrl = ScriptApp.getService().getUrl();
      return template.evaluate()
        .setTitle("Courier Tracker Analytics Dashboard")
        .addMetaTag("viewport", "width=device-width, initial-scale=1")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch(err) {
      return ContentService.createTextOutput("Помилка завантаження дашборду: " + err.toString());
    }
  }
  
  // Маршрути для API
  if (action === "ping") {
    return jsonResponse({ ok: true, time: new Date().toISOString() });
  }
  
  var token = e.parameter.token;
  if (!token) {
    return jsonResponse({ ok: false, error: "Missing authentication token" });
  }
  
  // Перевірка авторизації токена
  var courier = getCourierByToken(token);
  if (!courier) {
    return jsonResponse({ ok: false, error: "Unauthorized token" });
  }
  
  var responseObj;
  
  if (action === "config") {
    var config = getSettings();
    responseObj = jsonResponse({
      ok: true,
      config: config,
      points_version: parseInt(config.points_version || 1)
    });
  }
  
  else if (action === "points") {
    var clientVersion = parseInt(e.parameter.version || 0);
    var config = getSettings();
    var serverVersion = parseInt(config.points_version || 1);
    
    if (clientVersion === serverVersion) {
      responseObj = jsonResponse({
        ok: true,
        status: "not_modified",
        points_version: serverVersion,
        config: config
      });
    } else {
      var points = getActiveLocations(courier.region);
      responseObj = jsonResponse({
        ok: true,
        points_version: serverVersion,
        points: points,
        config: config
      });
    }
  }
  
  else {
    responseObj = jsonResponse({ ok: false, error: "Invalid action" });
  }
  
  // Додаємо location_request у відповідь, якщо є активний запит координат для кур'єра
  if (courier && courier.role === "courier" && responseObj) {
    if (hasPendingLocationRequest(courier.courier_id)) {
      try {
        var content = JSON.parse(responseObj.getContent());
        content.location_request = true;
        responseObj = jsonResponse(content);
      } catch (e) {}
    }
  }
  
  return responseObj;
}

/**
 * POST маршрутизатор
 */
function doPost(e) {
  var action = e.parameter.action;
  var payload;
  
  // Автоматично оновлюємо структуру БД та логістів за потреби
  try {
    checkAndAutoSetup();
  } catch(err) {
    Logger.log("Auto-setup check error: " + err.toString());
  }
  
  try {
    // Мобільні пристрої та веб-сторінка будуть відправляти JSON у тілі запиту
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" });
  }
  
  // Якщо action немає в URL параметрах, шукаємо в JSON тілі
  if (!action) {
    action = payload.action;
  }
  
  if (action === "login") {
    return handleLogin(payload);
  }
  
  // Для решти запитів потрібен токен авторизації
  var token = payload.token;
  if (!token) {
    return jsonResponse({ ok: false, error: "Missing authentication token" });
  }
  
  var courier = getCourierByToken(token);
  if (!courier) {
    return jsonResponse({ ok: false, error: "Unauthorized token" });
  }
  
  var responseObj;
  
  // Блокуємо одночасні записи в таблицю через LockService
  var lock = LockService.getScriptLock();
  try {
    // Чекаємо до 10 секунд на звільнення блокування
    lock.waitLock(10000);
    
    if (action === "shift/start") {
      responseObj = handleShiftStart(payload, courier);
    } else if (action === "shift/end") {
      responseObj = handleShiftEnd(payload, courier);
    } else if (action === "events/batch") {
      responseObj = handleEventsBatch(payload, courier);
    } else if (action === "logist/couriers") {
      if (courier.role !== "logist") {
        return jsonResponse({ ok: false, error: "Access denied: not a logist" });
      }
      responseObj = handleGetLogistCouriers(payload, courier);
    } else if (action === "logist/request-location") {
      if (courier.role !== "logist") {
        return jsonResponse({ ok: false, error: "Access denied: not a logist" });
      }
      responseObj = handleRequestLocation(payload);
    } else {
      responseObj = jsonResponse({ ok: false, error: "Invalid POST action" });
    }
    
    // Додаємо оновлені параметри у відповідь для кур'єра (config, points_version, location_request)
    if (courier && courier.role === "courier" && responseObj) {
      try {
        var content = JSON.parse(responseObj.getContent());
        
        // Додаємо прапорець запиту геоданих, якщо він є активним
        if (hasPendingLocationRequest(courier.courier_id)) {
          content.location_request = true;
        }
        
        // Завжди повертаємо актуальні налаштування та версію точок
        var config = getSettings();
        content.config = config;
        content.points_version = parseInt(config.points_version || 1);
        
        responseObj = jsonResponse(content);
      } catch (e) {}
    }
    
  } catch (err) {
    responseObj = jsonResponse({ ok: false, error: "Database lock timeout: " + err.toString() });
  } finally {
    lock.releaseLock();
  }
  
  return responseObj;
}

// ==========================================
// БІЗНЕС-ЛОГІКА ТА ОБРОБКА ЗАПИТІВ
// ==========================================

/**
 * Авторизація кур'єра за ID та PIN-кодом
 */
function handleLogin(data) {
  var courierId = data.courier_id;
  var pin = data.pin;
  
  if (!courierId || !pin) {
    return jsonResponse({ ok: false, error: "courier_id and pin are required" });
  }
  
  var isLogist = String(courierId).toUpperCase().indexOf("LO") === 0;
  var sheetName = isLogist ? "Logists" : "Couriers";
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return jsonResponse({ ok: false, error: "Sheet " + sheetName + " not found" });
  }
  
  var rows = sheet.getDataRange().getValues();
  var pinHash = hashPin(pin);
  
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var sheetCourierId = String(row[0]);
    var sheetPinHash = String(row[3]);
    var active = String(row[5]);
    
    if (sheetCourierId === courierId) {
      if (active !== "true") {
        return jsonResponse({ ok: false, error: (isLogist ? "Logist" : "Courier") + " account is deactivated" });
      }
      
      if (sheetPinHash === pinHash) {
        var token = String(row[4]);
        // Якщо токена немає, генеруємо новий
        if (!token || token.trim() === "") {
          token = Utilities.getUuid();
          sheet.getRange(i + 1, 5).setValue(token);
        }
        
        var config = getSettings();
        return jsonResponse({
          ok: true,
          courier_id: courierId,
          name: String(row[1]),
          token: token,
          role: isLogist ? "logist" : "courier",
          region: String(row[8] || "").trim(),
          points_version: parseInt(config.points_version || 1),
          config: config
        });
      } else {
        return jsonResponse({ ok: false, error: "Invalid PIN code" });
      }
    }
  }
  
  return jsonResponse({ ok: false, error: (isLogist ? "Logist" : "Courier") + " not found" });
}

/**
 * Початок зміни кур'єра
 */
function handleShiftStart(data, courier) {
  var courierId = courier.courier_id;
  var shiftId = data.shift_id;
  var startTime = data.start_time || new Date().toISOString();
  var platform = data.platform || "unknown";
  var appVersion = data.app_version || "1.0.0";
  var deviceId = data.device_id || "unknown";
  
  // Оновлюємо статус розташування кур'єра
  try {
    var loc = data.location || {};
    var battery = data.battery !== undefined ? data.battery : null;
    updateCourierStatus(courierId, courier.name, loc.latitude, loc.longitude, loc.accuracy_m, battery, "active");
  } catch(e) {
    Logger.log("Error updating location status: " + e.toString());
  }
  
  if (!shiftId) {
    return jsonResponse({ ok: false, error: "shift_id is required" });
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Shifts");
  var rows = sheet.getDataRange().getValues();
  
  // Перевірка на дуплікат
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === shiftId) {
      return jsonResponse({ ok: true, shift_id: shiftId, note: "Shift already registered (idempotent)" });
    }
  }
  
  // Закриваємо попередні незавершені зміни для цього кур'єра
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === courierId && String(rows[i][8]) === "active") {
      sheet.getRange(i + 1, 4).setValue(parseDate(startTime)); // end_time
      sheet.getRange(i + 1, 9).setValue("auto-closed"); // status
      sheet.getRange(i + 1, 10).setValue("Автоматично закрито при запуску нової зміни.");
    }
  }
  
  // Записуємо нову зміну
  // Колонки: shift_id, courier_id, start_time, end_time, duration_minutes, device_platform, app_version, device_id, status, notes
  sheet.appendRow([
    shiftId,
    courierId,
    parseDate(startTime),
    "", // end_time
    "", // duration_minutes
    platform,
    appVersion,
    deviceId,
    "active",
    ""
  ]);
  
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 3).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  
  return jsonResponse({ ok: true, shift_id: shiftId });
}

/**
 * Завершення зміни
 */
function handleShiftEnd(data, courier) {
  var courierId = courier.courier_id;
  var shiftId = data.shift_id;
  var endTime = data.end_time || new Date().toISOString();
  
  // Оновлюємо статус розташування кур'єра
  try {
    var loc = data.location || {};
    var battery = data.battery !== undefined ? data.battery : null;
    updateCourierStatus(courierId, courier.name, loc.latitude, loc.longitude, loc.accuracy_m, battery, "ended");
  } catch(e) {
    Logger.log("Error updating location status: " + e.toString());
  }
  
  if (!shiftId) {
    return jsonResponse({ ok: false, error: "shift_id is required" });
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Shifts");
  var rows = sheet.getDataRange().getValues();
  
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === shiftId) {
      var startTimeStr = rows[i][2];
      var durationMin = "";
      
      if (startTimeStr) {
        var start = new Date(startTimeStr);
        var end = new Date(endTime);
        durationMin = Math.round((end - start) / 60000);
      }
      
      sheet.getRange(i + 1, 4).setValue(parseDate(endTime)).setNumberFormat("dd.MM.yyyy HH:mm:ss"); // end_time
      sheet.getRange(i + 1, 5).setValue(durationMin); // duration_minutes
      sheet.getRange(i + 1, 9).setValue("ended"); // status
      
      return jsonResponse({ ok: true, shift_id: shiftId });
    }
  }
  
  return jsonResponse({ ok: false, error: "Shift not found for ending" });
}

/**
 * Обробка черги подій пакетом (візити, ручні чекіни, логи)
 */
function handleEventsBatch(data, courier) {
  var courierId = courier.courier_id;
  var name = courier.name;
  var batch = data.batch;
  var shiftId = data.shift_id;
  
  if (!batch || !Array.isArray(batch)) {
    return jsonResponse({ ok: false, error: "batch array is required" });
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var visitsSheet = ss.getSheetByName("Visits");
  var logsSheet = ss.getSheetByName("EventLog");
  
  var visitRows = visitsSheet.getDataRange().getValues();
  var logRows = logsSheet.getDataRange().getValues();
  
  // Створюємо хелпери швидкого пошуку дублікатів по UUID
  var existingVisitUuids = {};
  for (var i = 1; i < visitRows.length; i++) {
    existingVisitUuids[String(visitRows[i][1])] = true; // event_uuid
  }
  
  var existingLogUuids = {};
  for (var i = 1; i < logRows.length; i++) {
    existingLogUuids[String(logRows[i][1])] = true; // event_uuid
  }
  
  var accepted = 0;
  var duplicates = 0;
  var failed = [];
  var nowStr = new Date().toISOString();
  
  for (var k = 0; k < batch.length; k++) {
    var event = batch[k];
    var uuid = event.event_uuid;
    var type = event.event_type;
    var timestamp = event.timestamp;
    var payload = event.payload || {};
    
    if (!uuid) {
      failed.push({ index: k, error: "Missing event_uuid" });
      continue;
    }
    
    if (type === "visit" || type === "manual_checkin") {
      if (existingVisitUuids[uuid]) {
        duplicates++;
        accepted++;
        continue;
      }
      
      // Записуємо візит
      // Колонки: visit_id, event_uuid, courier_id, shift_id, location_id, enter_time, exit_time, duration_seconds, 
      // enter_lat, enter_lng, exit_lat, exit_lng, accuracy_m, matched_distance_m, source, offline_synced, created_at, raw_payload
      visitsSheet.appendRow([
        Utilities.getUuid(),
        uuid,
        courierId,
        shiftId || "",
        payload.location_id || "",
        parseDate(payload.enter_time || timestamp),
        parseDate(payload.exit_time || timestamp),
        payload.duration_seconds || 0,
        payload.enter_lat || "",
        payload.enter_lng || "",
        payload.exit_lat || "",
        payload.exit_lng || "",
        payload.accuracy_m || "",
        payload.matched_distance_m || "",
        payload.source || (type === "manual_checkin" ? "manual" : "auto"),
        payload.offline_synced !== undefined ? payload.offline_synced : true,
        parseDate(nowStr),
        JSON.stringify(payload)
      ]);
      
      var lastVisitRow = visitsSheet.getLastRow();
      visitsSheet.getRange(lastVisitRow, 6, 1, 2).setNumberFormat("dd.MM.yyyy HH:mm:ss"); // enter_time & exit_time
      visitsSheet.getRange(lastVisitRow, 17).setNumberFormat("dd.MM.yyyy HH:mm:ss"); // created_at
      
      existingVisitUuids[uuid] = true;
      accepted++;
      
      // Оновлюємо розташування кур'єра за візитом
      try {
        if (payload.enter_lat && payload.enter_lng) {
          updateCourierStatus(courierId, name, payload.enter_lat, payload.enter_lng, payload.accuracy_m, null, null);
        }
      } catch(e) {}
      
    } else if (type === "log") {
      if (existingLogUuids[uuid]) {
        duplicates++;
        accepted++;
        continue;
      }
      
      // Записуємо лог
      // Колонки: log_id, event_uuid, courier_id, shift_id, event_type, timestamp, payload_json, created_at
      logsSheet.appendRow([
        Utilities.getUuid(),
        uuid,
        courierId,
        shiftId || "",
        payload.event_type || "diagnostic",
        parseDate(timestamp),
        JSON.stringify(payload),
        parseDate(nowStr)
      ]);
      
      var lastLogRow = logsSheet.getLastRow();
      logsSheet.getRange(lastLogRow, 6).setNumberFormat("dd.MM.yyyy HH:mm:ss"); // timestamp
      logsSheet.getRange(lastLogRow, 8).setNumberFormat("dd.MM.yyyy HH:mm:ss"); // created_at
      
      existingLogUuids[uuid] = true;
      accepted++;

      // Оновлюємо розташування кур'єра, якщо це heartbeat-сигнал
      try {
        if (payload.event_type === "heartbeat" && payload.details) {
          var detailsObj = JSON.parse(payload.details);
          if (detailsObj && detailsObj.latitude && detailsObj.longitude) {
            var battery = detailsObj.battery !== undefined ? detailsObj.battery : null;
            updateCourierStatus(courierId, name, detailsObj.latitude, detailsObj.longitude, detailsObj.accuracy_m, battery, null);
          }
        }
      } catch(e) {}
    } else {
      failed.push({ index: k, error: "Unsupported event_type: " + type });
    }
  }
  
  return jsonResponse({
    ok: true,
    accepted: accepted,
    duplicates: duplicates,
    failed: failed
  });
}

// ==========================================
// ДОПОМІЖНІ ФУНКЦІЇ ДОСТУПУ ДО ДАНИХ
// ==========================================

/**
 * Отримує налаштування у вигляді асоціативного об'єкта (key -> value)
 */
function getSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Settings");
  var rows = sheet.getDataRange().getValues();
  var settings = {};
  
  for (var i = 1; i < rows.length; i++) {
    var k = String(rows[i][0]).trim();
    var v = String(rows[i][1]).trim();
    if (k !== "") {
      settings[k] = v;
    }
  }
  return settings;
}

/**
 * Перевірка та пошук кур'єра за його унікальним токеном
 */
function getCourierByToken(token) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Шукаємо в Couriers
  var sheet = ss.getSheetByName("Couriers");
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][4]) === token) { // token column
      return {
        courier_id: String(rows[i][0]),
        name: String(rows[i][1]),
        active: String(rows[i][5]) === "true",
        region: String(rows[i][8] || "").trim(),
        role: "courier"
      };
    }
  }
  
  // 2. Якщо не знайдено, шукаємо в Logists
  var logistsSheet = ss.getSheetByName("Logists");
  if (logistsSheet) {
    var logistsRows = logistsSheet.getDataRange().getValues();
    for (var i = 1; i < logistsRows.length; i++) {
      if (String(logistsRows[i][4]) === token) { // token column
        return {
          courier_id: String(logistsRows[i][0]),
          name: String(logistsRows[i][1]),
          active: String(logistsRows[i][5]) === "true",
          region: String(logistsRows[i][8] || "").trim(),
          role: "logist"
        };
      }
    }
  }
  
  return null;
}

/**
 * Отримує список кур'єрів для логіста з його регіону та їхній поточний статус
 */
function handleGetLogistCouriers(data, logist) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Отримуємо список усіх активних кур'єрів з регіону логіста
  var couriersSheet = ss.getSheetByName("Couriers");
  if (!couriersSheet) {
    return jsonResponse({ ok: false, error: "Couriers sheet not found" });
  }
  var couriersRows = couriersSheet.getDataRange().getValues();
  
  var regionCouriers = {};
  for (var i = 1; i < couriersRows.length; i++) {
    var cId = String(couriersRows[i][0]);
    var cName = String(couriersRows[i][1]);
    var cPhone = String(couriersRows[i][2]);
    var cActive = String(couriersRows[i][5]);
    var cRegion = String(couriersRows[i][8] || "").trim();
    
    if (cRegion === logist.region && cActive === "true") {
      regionCouriers[cId] = {
        courier_id: cId,
        name: cName,
        phone: cPhone
      };
    }
  }
  
  // 2. Отримуємо статус розташування кур'єрів з CourierStatus
  var statusSheet = ss.getSheetByName("CourierStatus");
  if (!statusSheet) {
    return jsonResponse({ ok: false, error: "CourierStatus sheet not found" });
  }
  var statusRows = statusSheet.getDataRange().getValues();
  
  var statusesMap = {};
  for (var i = 1; i < statusRows.length; i++) {
    var cId = String(statusRows[i][0]);
    if (regionCouriers[cId]) {
      var lastSeen = statusRows[i][2];
      var lastSeenStr = "";
      if (lastSeen instanceof Date) {
        lastSeenStr = lastSeen.toISOString();
      } else if (lastSeen) {
        lastSeenStr = new Date(lastSeen).toISOString();
      }
      
      statusesMap[cId] = {
        last_seen: lastSeenStr,
        latitude: statusRows[i][3] ? parseFloat(statusRows[i][3]) : null,
        longitude: statusRows[i][4] ? parseFloat(statusRows[i][4]) : null,
        accuracy_m: statusRows[i][5] ? parseFloat(statusRows[i][5]) : null,
        battery_percent: statusRows[i][6] ? parseFloat(statusRows[i][6]) : null,
        status: String(statusRows[i][7]),
        location_request: String(statusRows[i][9] || "").toLowerCase() === "true"
      };
    }
  }
  
  // 3. Отримуємо список відвіданих точок сьогодні
  var visitsSheet = ss.getSheetByName("Visits");
  var visitedMap = {};
  if (visitsSheet) {
    var visitsRows = visitsSheet.getDataRange().getValues();
    var todayPrefix = Utilities.formatDate(new Date(), "GMT+3", "yyyy-MM-dd");
    
    for (var i = 1; i < visitsRows.length; i++) {
      var cId = String(visitsRows[i][2]);
      var locId = String(visitsRows[i][4]);
      var enterTime = String(visitsRows[i][5]);
      
      if (regionCouriers[cId] && enterTime.indexOf(todayPrefix) === 0) {
        if (!visitedMap[cId]) {
          visitedMap[cId] = [];
        }
        if (visitedMap[cId].indexOf(locId) === -1) {
          visitedMap[cId].push(locId);
        }
      }
    }
  }
  
  // 4. Об'єднуємо дані
  var result = [];
  for (var cId in regionCouriers) {
    var s = statusesMap[cId] || {
      last_seen: "",
      latitude: null,
      longitude: null,
      accuracy_m: null,
      battery_percent: null,
      status: "ended",
      location_request: false
    };
    
    result.push({
      courier_id: cId,
      name: regionCouriers[cId].name,
      phone: regionCouriers[cId].phone,
      status: s.status,
      latitude: s.latitude,
      longitude: s.longitude,
      accuracy_m: s.accuracy_m,
      battery_percent: s.battery_percent,
      last_seen: s.last_seen,
      location_request: s.location_request,
      visited_locations: visitedMap[cId] || []
    });
  }
  
  return jsonResponse({ ok: true, couriers: result });
}

/**
 * Отримання списку активних локацій для завантаження на пристрій
 */
function getActiveLocations(courierRegion) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Locations");
  var rows = sheet.getDataRange().getValues();
  var locations = [];
  
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var active = String(row[7]);
    var locRegion = String(row[10] || "").trim(); // 11th column (index 10)
    
    if (active === "true") {
      // Якщо в точці та в профілі кур'єра вказані регіони, і вони не збігаються — ігноруємо
      if (courierRegion && locRegion && locRegion.toLowerCase() !== courierRegion.toLowerCase()) {
        continue;
      }
      locations.push({
        location_id: String(row[0]),
        name: String(row[1]),
        address: String(row[2]),
        latitude: parseFloat(row[3]),
        longitude: parseFloat(row[4]),
        radius_m: parseFloat(row[5]) || 30,
        indoor: String(row[6]) === "true"
      });
    }
  }
  return locations;
}

/**
 * Парсить ISO рядок дати та повертає об'єкт Date для відображення в локальному часі Google Sheets.
 * Google Sheets автоматично конвертує об'єкти Date у локальний час таблиці.
 */
function parseDate(isoString) {
  if (!isoString) return "";
  var date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return isoString;
  }
  return date;
}

/**
 * Обчислює SHA-256 хеш для PIN-коду. Використовуйте як формулу в Google Sheets для створення паролів.
 * Наприклад: =HASH_PIN(1234)
 * @param {string} pin PIN-код кур'єра.
 * @return {string} SHA-256 хеш.
 * @customfunction
 */
function HASH_PIN(pin) {
  if (pin === undefined || pin === null || pin === "") return "";
  return hashPin(String(pin));
}

/**
 * Оновлює або додає статус кур'єра (останнє місце знаходження, статус зміни, заряд батареї)
 */
function updateCourierStatus(courierId, name, lat, lng, accuracy, battery, status) {
  if (!courierId) return;
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("CourierStatus");
  if (!sheet) return;
  
  var rows = sheet.getDataRange().getValues();
  var now = new Date();
  
  // Шукаємо існуючий рядок кур'єра
  var courierRowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === courierId) {
      courierRowIndex = i + 1;
      break;
    }
  }
  
  // Дані для запису:
  // 1: courier_id, 2: name, 3: last_seen, 4: latitude, 5: longitude, 6: accuracy_m, 7: battery_percent, 8: status, 9: map_link
  var lastSeen = now;
  
  if (courierRowIndex !== -1) {
    // Оновлюємо існуючий рядок
    if (lat) sheet.getRange(courierRowIndex, 4).setValue(lat);
    if (lng) sheet.getRange(courierRowIndex, 5).setValue(lng);
    if (accuracy) sheet.getRange(courierRowIndex, 6).setValue(accuracy);
    if (battery !== undefined && battery !== null) sheet.getRange(courierRowIndex, 7).setValue(battery);
    if (status) sheet.getRange(courierRowIndex, 8).setValue(status);
    
    // Якщо отримано свіжі координати, знімаємо прапорець запиту
    if (lat && lng) {
      sheet.getRange(courierRowIndex, 10).setValue("false");
    }
    
    sheet.getRange(courierRowIndex, 3).setValue(lastSeen).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  } else {
    // Додаємо новий рядок
    var rowNum = sheet.getLastRow() + 1;
    var mapLinkFormula = '=HYPERLINK("https://www.google.com/maps/search/?api=1&query=" & SUBSTITUTE(D' + rowNum + '; ","; ".") & "," & SUBSTITUTE(E' + rowNum + '; ","; "."); "Показати на карті")';
    
    sheet.appendRow([
      courierId,
      name || "",
      lastSeen,
      lat || "",
      lng || "",
      accuracy || "",
      battery !== undefined && battery !== null ? battery : "",
      status || "",
      mapLinkFormula,
      "false" // location_request
    ]);
    sheet.getRange(rowNum, 3).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  }
}

/**
 * Серверна функція для отримання всіх даних для дашборду.
 * Викликається з клієнтського JS через google.script.run
 */
function getDashboardData() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error("Не вдалося отримати доступ до активної таблиці.");
    }
    
    var couriersSheet = ss.getSheetByName("Couriers");
    var locationsSheet = ss.getSheetByName("Locations");
    var shiftsSheet = ss.getSheetByName("Shifts");
    var visitsSheet = ss.getSheetByName("Visits");
    var statusSheet = ss.getSheetByName("CourierStatus");
    
    var couriers = couriersSheet ? getSheetDataAsJson(couriersSheet) : [];
    var locations = locationsSheet ? getSheetDataAsJson(locationsSheet) : [];
    var shifts = shiftsSheet ? getSheetDataAsJson(shiftsSheet) : [];
    var visits = visitsSheet ? getSheetDataAsJson(visitsSheet) : [];
    var courierStatus = statusSheet ? getSheetDataAsJson(statusSheet) : [];
    
    // Оновлюємо тривалість змін у реальному часі, якщо зміна активна
    var now = new Date();
    for (var i = 0; i < shifts.length; i++) {
      if (shifts[i].status === "active" && shifts[i].start_time) {
        var start = new Date(shifts[i].start_time);
        if (!isNaN(start.getTime())) {
          shifts[i].duration_minutes = Math.round((now - start) / 60000);
        }
      }
    }
    
    return {
      success: true,
      data: {
        couriers: couriers,
        locations: locations,
        shifts: shifts,
        visits: visits,
        courierStatus: courierStatus
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err.toString()
    };
  }
}

/**
 * Допоміжна функція для зчитування даних аркуша як масиву об'єктів (JSON).
 */
function getSheetDataAsJson(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  var headers = data[0];
  var jsonArray = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    var hasData = false;
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      // Конвертуємо об'єкти дат в ISO рядки, щоб вони передавалися клієнту
      if (val instanceof Date) {
        if (val && !isNaN(val.getTime())) {
          val = val.toISOString();
        } else {
          val = "";
        }
      }
      obj[headers[j]] = val;
      if (val !== undefined && val !== null && val !== "") {
        hasData = true;
      }
    }
    if (hasData) {
      jsonArray.push(obj);
    }
  }
  return jsonArray;
}

/**
 * Перевіряє наявність активного запиту координат від логіста для конкретного кур'єра.
 */
function hasPendingLocationRequest(courierId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("CourierStatus");
  if (!sheet) return false;
  
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === courierId) {
      return String(rows[i][9] || "").toLowerCase() === "true"; // Column J (Index 9)
    }
  }
  return false;
}

/**
 * Обробляє запит логіста на позачергове зчитування координат кур'єра.
 */
function handleRequestLocation(data) {
  var targetCourierId = data.courier_id;
  if (!targetCourierId) {
    return jsonResponse({ ok: false, error: "courier_id is required" });
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("CourierStatus");
  if (!sheet) {
    return jsonResponse({ ok: false, error: "CourierStatus sheet not found" });
  }
  
  var rows = sheet.getDataRange().getValues();
  var courierRowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === targetCourierId) {
      courierRowIndex = i + 1;
      break;
    }
  }
  
  if (courierRowIndex !== -1) {
    sheet.getRange(courierRowIndex, 10).setValue("true"); // Set location_request to true in Column J (10th column)
    return jsonResponse({ ok: true, message: "Location request set for courier " + targetCourierId });
  } else {
    return jsonResponse({ ok: false, error: "Courier status row not found" });
  }
}

/**
 * Автоматично перевіряє та оновлює структуру бази даних, якщо вона застаріла,
 * а також додає необхідних логістів за потреби.
 */
function checkAndAutoSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;
  
  // 1. Оновлення та перевірка налаштувань (додає відсутні ключі)
  try {
    setupDefaultSettings(ss);
  } catch(e) {
    Logger.log("Error running setupDefaultSettings: " + e.toString());
  }
  
  // 2. Перевірка CourierStatus на наявність 10-ї колонки (location_request)
  var statusSheet = ss.getSheetByName("CourierStatus");
  if (statusSheet && statusSheet.getLastColumn() < 10) {
    setupDatabase();
  }
  
  // 2. Перевірка наявності логіста Насті
  var logistsSheet = ss.getSheetByName("Logists");
  if (logistsSheet) {
    var hasNastia = false;
    var data = logistsSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === "LO002") {
        hasNastia = true;
        break;
      }
    }
    if (!hasNastia) {
      addNastiaLogistSilent(logistsSheet);
    }
  }
}

/**
 * Додає логіста Настю без виводу діалогових вікон (для фонової API-сумісності)
 */
function addNastiaLogistSilent(sheet) {
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
  Logger.log("Логіста Настю автоматично додано через фонову перевірку.");
}

/**
 * Спеціальна функція для виклику з веб-дашборду (через google.script.run)
 * для встановлення прапорця запиту геолокації.
 */
function requestCourierLocationFromDashboard(courierId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("CourierStatus");
  if (!sheet) return { success: false, error: "CourierStatus sheet not found" };
  
  var rows = sheet.getDataRange().getValues();
  var courierRowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === courierId) {
      courierRowIndex = i + 1;
      break;
    }
  }
  
  if (courierRowIndex !== -1) {
    sheet.getRange(courierRowIndex, 10).setValue("true"); // Set location_request to true in Column J (10th column)
    return { success: true, message: "Запит надіслано успішно." };
  } else {
    return { success: false, error: "Кур'єра не знайдено." };
  }
}
