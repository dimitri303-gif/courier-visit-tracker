/**
 * ShiftHandlers.gs
 * Обробка початку та завершення змін.
 */

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
  
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName("Shifts");
  
  // Зчитуємо тільки останні 200 рядків замість всієї таблиці
  var sheetLastRow = sheet.getLastRow();
  var rows = [];
  var rowOffset = 1; // зсув для перерахунку індексу рядка в таблиці
  if (sheetLastRow > 1) {
    var startRow = Math.max(2, sheetLastRow - 200);
    rowOffset = startRow;
    var numRows = sheetLastRow - startRow + 1;
    rows = sheet.getRange(startRow, 1, numRows, 10).getValues();
  }
  
  // Перевірка на дуплікат
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === shiftId) {
      return jsonResponse({ ok: true, shift_id: shiftId, note: "Shift already registered (idempotent)" });
    }
  }
  
  // Закриваємо попередні незавершені зміни для цього кур'єра (атомарне оновлення)
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) === courierId && String(rows[i][8]) === "active") {
      var rowIdx = rowOffset + i;
      sheet.getRange(rowIdx, 4, 1, 7).setValues([[
        parseDate(startTime), "", rows[i][5], rows[i][6], rows[i][7],
        "auto-closed", "Автоматично закрито при запуску нової зміни."
      ]]);
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
  
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName("Shifts");
  
  // Зчитуємо тільки останні 200 рядків замість всієї таблиці
  var sheetLastRow = sheet.getLastRow();
  var rows = [];
  var rowOffset = 1;
  if (sheetLastRow > 1) {
    var startRow = Math.max(2, sheetLastRow - 200);
    rowOffset = startRow;
    var numRows = sheetLastRow - startRow + 1;
    rows = sheet.getRange(startRow, 1, numRows, 10).getValues();
  }
  
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === shiftId) {
      var startTimeStr = rows[i][2];
      var durationMin = "";
      
      if (startTimeStr) {
        var start = new Date(startTimeStr);
        var end = new Date(endTime);
        durationMin = Math.round((end - start) / 60000);
      }
      
      // Атомарне оновлення рядка однією операцією
      var rowIdx = rowOffset + i;
      sheet.getRange(rowIdx, 4, 1, 7).setValues([[
        parseDate(endTime), durationMin, rows[i][5], rows[i][6], rows[i][7],
        "ended", rows[i][9] || ""
      ]]);
      sheet.getRange(rowIdx, 4).setNumberFormat("dd.MM.yyyy HH:mm:ss");
      
      return jsonResponse({ ok: true, shift_id: shiftId });
    }
  }
  
  return jsonResponse({ ok: false, error: "Shift not found for ending" });
}
