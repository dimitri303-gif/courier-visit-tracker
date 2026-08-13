/**
 * Config_TG.gs
 * Налаштування для Telegram-бота
 */

// TODO: Замініть на реальний ID вашої таблиці (з URL) та токен бота від BotFather
var SPREADSHEET_ID = "10xLqu5qIzxpIjFUoKlrzAFV7n4O7h3CADy1qYHxsLpA";
var TELEGRAM_BOT_TOKEN = "8721866439:AAEPHKohH4zv6jugBe1Q5Z5DxTQLrnnZ5m0";
var TELEGRAM_API_URL = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;

/**
 * Отримує таблицю
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Отримує налаштування у вигляді асоціативного об'єкта (key -> value)
 */
function getSettings() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName("Settings");
  if (!sheet) return {};
  
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
 * Отримання списку активних локацій
 */
function getActiveLocations() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName("Locations");
  if (!sheet) return [];
  
  var rows = sheet.getDataRange().getValues();
  var locations = [];
  
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var active = String(row[7]);
    
    if (active === "true") {
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
