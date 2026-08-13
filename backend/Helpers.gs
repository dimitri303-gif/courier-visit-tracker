/**
 * Helpers.gs
 * Допоміжні функції.
 */

/**
 * Хелпер для створення JSON відповідей
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
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
 * Очищає системні логи, які старіші за 7 днів.
 * Цю функцію рекомендується запускати щоденно за тригером (Time-driven trigger).
 */
function cleanupOldLogs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logsSheet = ss.getSheetByName("EventLog");
  if (!logsSheet) return;
  
  var lastRow = logsSheet.getLastRow();
  if (lastRow <= 1) return;
  
  var values = logsSheet.getRange(2, 8, lastRow - 1, 1).getValues(); // 8-ма колонка - це created_at
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7); // 7 днів тому
  
  var rowsToDelete = 0;
  for (var i = 0; i < values.length; i++) {
    var createdAt = new Date(values[i][0]);
    if (createdAt < cutoffDate) {
      rowsToDelete++;
    } else {
      break; // Оскільки логи записуються хронологічно, всі наступні будуть новішими
    }
  }
  
  if (rowsToDelete > 0) {
    logsSheet.deleteRows(2, rowsToDelete);
    console.log("Видалено " + rowsToDelete + " застарілих рядків логів.");
  }
}
