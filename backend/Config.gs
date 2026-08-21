/**
 * Config.gs
 * Конфігурація та налаштування.
 */

// Системні налаштування за замовчуванням
var SPREADSHEET_ID = "10xLqu5qIzxpIjFUoKlrzAFV7n4O7h3CADy1qYHxsLpA";
var CACHE_TIME_SECS = 300; // 5 хвилин для кешування конфігурацій

/**
 * Отримує таблицю (підтримує як зв'язані, так і автономні скрипти)
 */
function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return ss;
}

/**
 * Отримує налаштування у вигляді асоціативного об'єкта (key -> value)
 */
function getSettings() {
  var ss = getSpreadsheet();
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
 * Отримання списку активних локацій для завантаження на пристрій
 */
function getActiveLocations(courierRegion) {
  var ss = getSpreadsheet();
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
 * Автоматично перевіряє та оновлює структуру бази даних, якщо вона застаріла,
 * а також додає необхідних логістів за потреби.
 */
function checkAndAutoSetup() {
  var ss = getSpreadsheet();
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
