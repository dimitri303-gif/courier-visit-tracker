/**
 * Auth.gs
 * Функції авторизації та хешування.
 */

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

function normalizeCourierId(id) {
  if (!id) return "";
  return String(id)
    .trim()
    .toUpperCase()
    .replace(/[\u0421\u0441]/g, "C")
    .replace(/[\u041E\u043E]/g, "O")
    .replace(/[\u0410\u0430]/g, "A")
    .replace(/[\u0412\u0432]/g, "B")
    .replace(/[\u0415\u0435]/g, "E")
    .replace(/[\u041A\u043A]/g, "K")
    .replace(/[\u041C\u043C]/g, "M")
    .replace(/[\u041D\u043D]/g, "H")
    .replace(/[\u0420\u0440]/g, "P")
    .replace(/[\u0422\u0442]/g, "T")
    .replace(/[\u0425\u0445]/g, "X");
}

/**
 * Авторизація кур'єра за ID та PIN-кодом
 */
function handleLogin(data) {
  var courierId = normalizeCourierId(data.courier_id);
  var pin = String(data.pin || "").trim();
  
  if (!courierId || !pin) {
    return jsonResponse({ ok: false, error: "courier_id and pin are required" });
  }
  
  var isLogist = courierId.indexOf("LO") === 0;
  var sheetName = isLogist ? "Logists" : "Couriers";
  
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return jsonResponse({ ok: false, error: "Sheet " + sheetName + " not found" });
  }
  
  var rows = sheet.getDataRange().getValues();
  var pinHash = hashPin(pin);
  
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var sheetCourierId = normalizeCourierId(row[0]);
    var sheetPinHash = String(row[3]).trim();
    var active = String(row[5]).trim();
    
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
 * Перевірка та пошук кур'єра за його унікальним токеном
 */
function getCourierByToken(token) {
  var ss = getSpreadsheet();
  
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
