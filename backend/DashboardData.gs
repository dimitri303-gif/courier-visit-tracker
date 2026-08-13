/**
 * DashboardData.gs
 * Отримання даних для дашборду.
 */

/**
 * Серверна функція для отримання всіх даних для дашборду.
 * Викликається з клієнтського JS через google.script.run
 */
function getDashboardData() {
  try {
    SpreadsheetApp.flush();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error("Не вдалося отримати доступ до активної таблиці.");
    }
    
    var couriersSheet = ss.getSheetByName("Couriers");
    var locationsSheet = ss.getSheetByName("Locations");
    var shiftsSheet = ss.getSheetByName("Shifts");
    var visitsSheet = ss.getSheetByName("Visits");
    var stopsSheet = ss.getSheetByName("Stops");
    var statusSheet = ss.getSheetByName("CourierStatus");
    var logsSheet = ss.getSheetByName("EventLog");
    
    var couriers = couriersSheet ? getSheetDataAsJson(couriersSheet) : [];
    var locations = locationsSheet ? getSheetDataAsJson(locationsSheet) : [];
    var shifts = shiftsSheet ? getSheetDataAsJson(shiftsSheet) : [];
    var visits = visitsSheet ? getSheetDataAsJson(visitsSheet) : [];
    var stops = stopsSheet ? getSheetDataAsJson(stopsSheet) : [];
    var courierStatus = statusSheet ? getSheetDataAsJson(statusSheet) : [];
    
    var eventLogs = [];
    if (logsSheet) {
      var lastLogRow = logsSheet.getLastRow();
      if (lastLogRow > 1) {
        var startLogRow = Math.max(2, lastLogRow - 5000);
        var numLogRows = lastLogRow - startLogRow + 1;
        var rawLogs = logsSheet.getRange(startLogRow, 1, numLogRows, 8).getValues();
        for (var i = 0; i < rawLogs.length; i++) {
          var row = rawLogs[i];
          eventLogs.push({
            log_id: String(row[0] || ''),
            event_uuid: String(row[1] || ''),
            courier_id: String(row[2] || ''),
            shift_id: String(row[3] || ''),
            event_type: String(row[4] || ''),
            timestamp: row[5] instanceof Date ? row[5].toISOString() : String(row[5] || ''),
            payload_json: String(row[6] || ''),
            created_at: row[7] instanceof Date ? row[7].toISOString() : String(row[7] || '')
          });
        }
      }
    }
    
    var settings = getSettings();
    
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
        stops: stops,
        courierStatus: courierStatus,
        eventLogs: eventLogs,
        settings: settings
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
  var normalizedHeaders = [];
  var sheetName = sheet.getName();
  
  for (var j = 0; j < headers.length; j++) {
    var headerStr = String(headers[j]).trim();
    // Захист від збоїв: примусово призначаємо правильні ідентифікатори першим колонкам
    if (j === 0) {
      if (sheetName === "Couriers" || sheetName === "CourierStatus") {
        headerStr = "courier_id";
      } else if (sheetName === "Locations") {
        headerStr = "location_id";
      } else if (sheetName === "Shifts") {
        headerStr = "shift_id";
      } else if (sheetName === "Visits") {
        headerStr = "visit_id";
      } else if (sheetName === "Stops") {
        headerStr = "stop_id";
      }
    }
    // Системне перейменування для сумісності з простоями
    if (sheetName === "CourierStatus" && j === 10) {
      headerStr = "idle_since";
    }
    normalizedHeaders.push(headerStr);
  }
  
  var jsonArray = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    var hasData = false;
    for (var j = 0; j < normalizedHeaders.length; j++) {
      var val = row[j];
      // Конвертуємо об'єкти дат в ISO рядки, щоб вони передавалися клієнту
      if (val instanceof Date) {
        if (val && !isNaN(val.getTime())) {
          val = val.toISOString();
        } else {
          val = "";
        }
      }
      obj[normalizedHeaders[j]] = val;
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
