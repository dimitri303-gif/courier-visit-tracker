/**
 * LogistHandlers.gs
 * Обробка запитів від логістів.
 */

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
    SpreadsheetApp.flush();
    return { success: true, message: "Запит надіслано успішно." };
  } else {
    return { success: false, error: "Кур'єра не знайдено." };
  }
}
