/**
 * Helpers_TG.gs
 * Допоміжні функції для розрахунків, UUID, Telegram API, оновлення статусів та логування.
 */

/**
 * Генерація UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Надійне збереження стану в PropertiesService та CacheService (захист від скидання кешу Google Apps Script)
 */
function getPersistentState_TG(key) {
  try {
    var props = PropertiesService.getScriptProperties();
    var val = props.getProperty(key);
    if (val !== null && val !== undefined && val !== "") return val;
  } catch(e) {}
  try {
    var cache = CacheService.getScriptCache();
    return cache.get(key);
  } catch(e) {}
  return null;
}

function setPersistentState_TG(key, val, ttlSec) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty(key, String(val));
  } catch(e) {}
  try {
    var cache = CacheService.getScriptCache();
    cache.put(key, String(val), ttlSec || 21600);
  } catch(e) {}
}

function removePersistentState_TG(key) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.deleteProperty(key);
  } catch(e) {}
  try {
    var cache = CacheService.getScriptCache();
    cache.remove(key);
  } catch(e) {}
}

/**
 * Розрахунок відстані між двома координатами за формулою гаверсину (в метрах)
 */
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  var R = 6371e3; // радіус Землі в метрах
  var toRadians = function(deg) { return deg * Math.PI / 180; };
  var dLat = toRadians(lat2 - lat1);
  var dLon = toRadians(lon2 - lon1);
  
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
          
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

/**
 * Парсер дат
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
 * Відправка POST запиту до Telegram API
 */
function sendTelegramRequest(method, payload) {
  var options = {
    'method' : 'post',
    'contentType': 'application/json',
    'payload' : JSON.stringify(payload),
    'muteHttpExceptions': true
  };
  
  try {
    var response = UrlFetchApp.fetch(TELEGRAM_API_URL + "/" + method, options);
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log("Telegram API Error: " + e.toString());
    return null;
  }
}

/**
 * Отримання профілю кур'єра за chatId
 */
function getCourierProfile(chatId) {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get("profile_" + chatId);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch(e) {}
  
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("Couriers");
    if (!sheet) return null;
    
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][4]) === String(chatId)) {
        var profile = {
          courier_id: String(rows[i][0]),
          name: String(rows[i][1]),
          phone: String(rows[i][2])
        };
        try {
          var c = CacheService.getScriptCache();
          c.put("profile_" + chatId, JSON.stringify(profile), 21600);
          c.put("chat_" + chatId, profile.courier_id, 21600);
        } catch(e) {}
        return profile;
      }
    }
  } catch(e) {
    Logger.log("getCourierProfile error: " + e.toString());
  }
  return null;
}

/**
 * Отримання courier_id за chatId
 */
function getCourierIdFromChat(chatId) {
  var profile = getCourierProfile(chatId);
  return profile ? profile.courier_id : null;
}

/**
 * Отримання активного shift_id для кур'єра (з кешу або з таблиці Shifts)
 */
function getActiveShiftId(courierId) {
  if (!courierId) return null;
  
  var cache = CacheService.getScriptCache();
  try {
    var cachedShift = cache.get("shift_" + courierId);
    if (cachedShift) return cachedShift;
  } catch(e) {}
  
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("Shifts");
    if (!sheet) return null;
    
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var numRows = Math.min(lastRow - 1, 100);
      var startR = lastRow - numRows + 1;
      var rows = sheet.getRange(startR, 1, numRows, 10).getValues();
      for (var i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i][1]) === String(courierId) && String(rows[i][8]) === "active") {
          var shiftId = String(rows[i][0]);
          try {
            cache.put("shift_" + courierId, shiftId, 21600);
          } catch(e) {}
          return shiftId;
        }
      }
    }
  } catch(e) {
    Logger.log("getActiveShiftId error: " + e.toString());
  }
  return null;
}

/**
 * Оновлення або створення запису в CourierStatus
 * Колонки: courier_id, name, last_seen, latitude, longitude, accuracy_m, battery_percent, status, map_link, location_request, idle_since
 */
function updateCourierStatus_TG(courierId, name, lat, lng, accuracy, battery, status, idleSince) {
  if (!courierId) return;
  
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("CourierStatus");
    if (!sheet) return;
    
    var rows = sheet.getDataRange().getValues();
    var now = new Date();
    
    var courierRowIndex = -1;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(courierId)) {
        courierRowIndex = i + 1;
        break;
      }
    }
    
    if (courierRowIndex !== -1) {
      if (name) sheet.getRange(courierRowIndex, 2).setValue(name);
      if (lat !== undefined && lat !== null && lat !== "") sheet.getRange(courierRowIndex, 4).setValue(lat);
      if (lng !== undefined && lng !== null && lng !== "") sheet.getRange(courierRowIndex, 5).setValue(lng);
      if (accuracy !== undefined && accuracy !== null && accuracy !== "") sheet.getRange(courierRowIndex, 6).setValue(accuracy);
      if (battery !== undefined && battery !== null && battery !== "") sheet.getRange(courierRowIndex, 7).setValue(battery);
      if (status) {
        sheet.getRange(courierRowIndex, 8).setValue(status);
        if (status === "ended") {
          sheet.getRange(courierRowIndex, 11).setValue("");
        }
      }
      
      // Знімаємо запит локації при отриманні координат
      if (lat && lng) {
        sheet.getRange(courierRowIndex, 10).setValue("false");
      }
      
      if (idleSince !== undefined) {
        if (idleSince) {
          sheet.getRange(courierRowIndex, 11).setValue(parseDate(idleSince)).setNumberFormat("dd.MM.yyyy HH:mm:ss");
        } else {
          sheet.getRange(courierRowIndex, 11).setValue("");
        }
      }
      
      sheet.getRange(courierRowIndex, 3).setValue(now).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    } else {
      var rowNum = sheet.getLastRow() + 1;
      var mapLinkFormula = '=HYPERLINK("https://www.google.com/maps/search/?api=1&query=" & SUBSTITUTE(D' + rowNum + '; ","; ".") & "," & SUBSTITUTE(E' + rowNum + '; ","; "."); "Показати на карті")';
      
      sheet.appendRow([
        courierId,
        name || "",
        now,
        lat || "",
        lng || "",
        accuracy || "",
        battery !== undefined && battery !== null ? battery : "",
        status || "active",
        mapLinkFormula,
        "false",
        status === "ended" ? "" : (idleSince ? parseDate(idleSince) : "")
      ]);
      sheet.getRange(rowNum, 3).setNumberFormat("dd.MM.yyyy HH:mm:ss");
      sheet.getRange(rowNum, 11).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    }
  } catch(e) {
    Logger.log("updateCourierStatus_TG error: " + e.toString());
  }
}

/**
 * Запис події в EventLog
 * Колонки: log_id, event_uuid, courier_id, shift_id, event_type, timestamp, payload_json, created_at
 */
function logEvent_TG(courierId, shiftId, eventType, message, details) {
  if (!courierId) return;
  
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("EventLog");
    if (!sheet) return;
    
    var logId = generateUUID();
    var eventUuid = generateUUID();
    var now = new Date();
    
    var payload = {
      event_type: eventType,
      message: message || "",
      details: details || null
    };
    
    // Якщо деталі містять координати / батарею на верхньому рівні
    if (details && typeof details === "object") {
      if (details.latitude !== undefined) payload.latitude = details.latitude;
      if (details.longitude !== undefined) payload.longitude = details.longitude;
      if (details.accuracy_m !== undefined) payload.accuracy_m = details.accuracy_m;
      if (details.battery !== undefined) payload.battery = details.battery;
    }
    
    sheet.appendRow([
      logId,
      eventUuid,
      courierId,
      shiftId || "",
      eventType,
      now,
      JSON.stringify(payload),
      now
    ]);
    
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 6).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    sheet.getRange(lastRow, 8).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  } catch(e) {
    Logger.log("logEvent_TG error: " + e.toString());
  }
}
