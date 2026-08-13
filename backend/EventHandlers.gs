/**
 * EventHandlers.gs
 * Обробка черги подій пакетом (візити, ручні чекіни, логи).
 */

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
  var stopsSheet = ss.getSheetByName("Stops");
  
  if (!shiftId) {
    var shiftsSheet = ss.getSheetByName("Shifts");
    if (shiftsSheet) {
      var sLastRow = shiftsSheet.getLastRow();
      if (sLastRow > 1) {
        var sNum = Math.min(sLastRow - 1, 50);
        var sRows = shiftsSheet.getRange(sLastRow - sNum + 1, 1, sNum, 9).getValues();
        for (var si = sRows.length - 1; si >= 0; si--) {
          if (String(sRows[si][1]) === courierId) {
            shiftId = String(sRows[si][0]);
            break;
          }
        }
      }
    }
  }
  
  var visitRows = [];
  var lastVisitRow = visitsSheet.getLastRow();
  if (lastVisitRow > 1) {
    var startVisitRow = Math.max(2, lastVisitRow - 1000);
    var numVisitRows = lastVisitRow - startVisitRow + 1;
    visitRows = visitsSheet.getRange(startVisitRow, 1, numVisitRows, 18).getValues();
  }

  var logRows = [];
  var lastLogRow = logsSheet.getLastRow();
  if (lastLogRow > 1) {
    var startLogRow = Math.max(2, lastLogRow - 2000);
    var numLogRows = lastLogRow - startLogRow + 1;
    logRows = logsSheet.getRange(startLogRow, 1, numLogRows, 8).getValues();
  }
  
  // Створюємо хелпери швидкого пошуку дублікатів по UUID
  var existingVisitUuids = {};
  for (var i = 0; i < visitRows.length; i++) {
    existingVisitUuids[String(visitRows[i][1])] = true; // event_uuid
  }
  
  var existingLogUuids = {};
  for (var i = 0; i < logRows.length; i++) {
    existingLogUuids[String(logRows[i][1])] = true; // event_uuid
  }
  
  var accepted = 0;
  var duplicates = 0;
  var failed = [];
  var nowStr = new Date().toISOString();
  
  // Збираємо нові рядки для батч-запису замість окремих appendRow()
  var newVisitRows = [];
  var newLogRows = [];
  var newStopRows = [];
  var lastHeartbeatPayload = null; // Зберігаємо останній heartbeat для оновлення статусу
  var lastVisitPayload = null;     // Зберігаємо останній візит для оновлення статусу
  var lastIdleStart = null;
  var lastIdleStop = false;
  
  for (var k = 0; k < batch.length; k++) {
    try {
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
        
        // Збираємо рядок візиту в масив замість appendRow()
        // Колонки: visit_id, event_uuid, courier_id, shift_id, location_id, enter_time, exit_time, duration_seconds, 
        // enter_lat, enter_lng, exit_lat, exit_lng, accuracy_m, matched_distance_m, source, offline_synced, created_at, raw_payload
        newVisitRows.push([
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
        
        existingVisitUuids[uuid] = true;
        accepted++;
        
        // Запам'ятовуємо останній візит для оновлення статусу (виконаємо один раз після циклу)
        if (payload.enter_lat && payload.enter_lng) {
          lastVisitPayload = payload;
        }
        
      } else if (type === "log") {
        if (existingLogUuids[uuid]) {
          duplicates++;
          accepted++;
          continue;
        }
        
        var isIdleEvent = payload.event_type === "idle_start" || payload.event_type === "idle_stop";
        
        if (!isIdleEvent) {
          // Збираємо рядок логу в масив замість appendRow()
          // Колонки: log_id, event_uuid, courier_id, shift_id, event_type, timestamp, payload_json, created_at
          newLogRows.push([
            Utilities.getUuid(),
            uuid,
            courierId,
            shiftId || "",
            payload.event_type || "diagnostic",
            parseDate(timestamp),
            JSON.stringify(payload),
            parseDate(nowStr)
          ]);
        }
        
        if (payload.event_type === "idle_stop") {
          try {
            var idleDetails = JSON.parse(payload.details || "{}");
            var durationMinutes = Math.round((new Date(idleDetails.end_time) - new Date(idleDetails.start_time)) / 60000);
            var latDot = String(idleDetails.anchor_lat).replace(',', '.');
            var lngDot = String(idleDetails.anchor_lng).replace(',', '.');
            var mapLink = (idleDetails.anchor_lat && idleDetails.anchor_lng)
              ? '=HYPERLINK("https://www.google.com/maps?q=' + latDot + ',' + lngDot + '"; "Карта")'
              : "";
            newStopRows.push([
              idleDetails.stop_uuid || Utilities.getUuid(),
              courierId, shiftId || "",
              parseDate(idleDetails.start_time),
              parseDate(idleDetails.end_time),
              durationMinutes,
              idleDetails.anchor_lat,
              idleDetails.anchor_lng,
              idleDetails.max_drift_m || 0,
              parseDate(nowStr),
              mapLink
            ]);
            lastIdleStop = true;
            lastIdleStart = null;
          } catch(idleErr) {
            Logger.log("Error parsing idle_stop details: " + idleErr.toString() + " | raw: " + payload.details);
          }
        }
        
        if (payload.event_type === "idle_start") {
          try {
            var idleStartDetails = JSON.parse(payload.details || "{}");
            lastIdleStart = idleStartDetails.start_time;
          } catch(idleErr2) {
            Logger.log("Error parsing idle_start details: " + idleErr2.toString());
          }
          lastIdleStop = false;
        }
        
        existingLogUuids[uuid] = true;
        accepted++;

        // Запам'ятовуємо останній heartbeat для оновлення статусу
        if (payload.event_type === "heartbeat" && payload.details) {
          lastHeartbeatPayload = payload;
        }
      } else {
        failed.push({ index: k, error: "Unsupported event_type: " + type });
      }
    } catch (e) {
      failed.push({ index: k, error: String(e) });
    }
  }
  
  // Батч-запис візитів (один виклик setValues замість N appendRow)
  if (newVisitRows.length > 0) {
    var visitStartRow = visitsSheet.getLastRow() + 1;
    visitsSheet.getRange(visitStartRow, 1, newVisitRows.length, 18).setValues(newVisitRows);
    // Встановлюємо формат дати та часу (HH:mm:ss) для колонок enter_time, exit_time та created_at
    visitsSheet.getRange(visitStartRow, 6, newVisitRows.length, 2).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    visitsSheet.getRange(visitStartRow, 17, newVisitRows.length, 1).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  }
  
  // Батч-запис логів (один виклик setValues замість N appendRow)
  if (newLogRows.length > 0) {
    var logStartRow = logsSheet.getLastRow() + 1;
    logsSheet.getRange(logStartRow, 1, newLogRows.length, 8).setValues(newLogRows);
    // Встановлюємо формат дати та часу (HH:mm:ss) для колонок timestamp та created_at
    logsSheet.getRange(logStartRow, 6, newLogRows.length, 1).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    logsSheet.getRange(logStartRow, 8, newLogRows.length, 1).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  }
  
  // Батч-запис зупинок
  if (newStopRows.length > 0) {
    if (!stopsSheet) stopsSheet = ss.insertSheet("Stops");
    var stopStartRow = stopsSheet.getLastRow() + 1;
    if (stopStartRow === 1) { // Якщо аркуш порожній (тільки створили)
      stopsSheet.appendRow(["stop_id", "courier_id", "shift_id", "start_time", "end_time", "duration_minutes", "anchor_lat", "anchor_lng", "max_drift_m", "created_at", "map_link"]);
      stopStartRow = 2;
    }
    stopsSheet.getRange(stopStartRow, 1, newStopRows.length, 11).setValues(newStopRows);
    stopsSheet.getRange(stopStartRow, 4, newStopRows.length, 2).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    stopsSheet.getRange(stopStartRow, 10, newStopRows.length, 1).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  }
  
  // Оновлюємо статус кур'єра один раз після запису всього батчу
  try {
    var idleSinceUpdate = undefined;
    if (lastIdleStart) idleSinceUpdate = lastIdleStart;
    else if (lastIdleStop) idleSinceUpdate = ""; // Знімаємо статус зупинки

    if (lastHeartbeatPayload && lastHeartbeatPayload.details) {
      var detailsObj = JSON.parse(lastHeartbeatPayload.details);
      if (detailsObj && detailsObj.latitude && detailsObj.longitude) {
        var battery = detailsObj.battery !== undefined ? detailsObj.battery : null;
        updateCourierStatus(courierId, name, detailsObj.latitude, detailsObj.longitude, detailsObj.accuracy_m, battery, null, idleSinceUpdate);
      }
    } else if (lastVisitPayload) {
      updateCourierStatus(courierId, name, lastVisitPayload.enter_lat, lastVisitPayload.enter_lng, lastVisitPayload.accuracy_m, null, null, idleSinceUpdate);
    } else if (idleSinceUpdate !== undefined) {
      updateCourierStatus(courierId, name, null, null, null, null, null, idleSinceUpdate);
    }
  } catch(e) {
    Logger.log("Error updating courier status after batch: " + e.toString());
  }
  
  return jsonResponse({
    ok: true,
    accepted: accepted,
    duplicates: duplicates,
    failed: failed
  });
}
