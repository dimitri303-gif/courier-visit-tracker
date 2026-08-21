/**
 * CourierStatusHandlers.gs
 * Оновлення статусів кур'єрів та запити їх локації.
 */

/**
 * Оновлює або додає статус кур'єра (останнє місце знаходження, статус зміни, заряд батареї)
 */
function updateCourierStatus(courierId, name, lat, lng, accuracy, battery, status, idleSince) {
  if (!courierId) return;
  
  var ss = getSpreadsheet();
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
    if (status) {
      sheet.getRange(courierRowIndex, 8).setValue(status);
      if (status === "ended") {
        idleSince = ""; // Force clear idle timestamp on shift end
      }
    }
    
    // Якщо отримано свіжі координати, знімаємо прапорець запиту
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
      "false", // location_request
      status === "ended" ? "" : (idleSince ? parseDate(idleSince) : "")
    ]);
    sheet.getRange(rowNum, 3).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    sheet.getRange(rowNum, 11).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  }
}

/**
 * Перевіряє наявність активного запиту координат від логіста для конкретного кур'єра.
 */
function hasPendingLocationRequest(courierId) {
  var ss = getSpreadsheet();
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
