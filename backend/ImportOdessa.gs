/**
 * ImportOdessa.gs
 * Скрипт для імпорту клієнтів (локацій) та персоналу (кур'єрів, логістів) з Одеси.
 * 
 * Джерело даних: https://docs.google.com/spreadsheets/d/1EuWteV8vzhLXbAHLWCjKCXBPwsrrDUWlK0AKly9aTVY/edit#gid=629668047
 */

/**
 * Імпортує адреси клієнтів з Одеси, автоматично геокодує їх через Google Maps
 * та додає до бази точок Courier Visit Tracker.
 */
function importAndGeocodeOdessaLocations() {
  var activeSS = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = activeSS.getSheetByName("Locations");
  if (!targetSheet) {
    Logger.log("Помилка: не знайдено аркуш Locations в поточній базі.");
    return;
  }
  
  // Встановлюємо заголовок для посилань на карти в стовпчик L (12)
  targetSheet.getRange(1, 12).setValue("map_link");
  
  // 1. Відкриваємо джерело з адресами
  var sourceUrl = "https://docs.google.com/spreadsheets/d/1EuWteV8vzhLXbAHLWCjKCXBPwsrrDUWlK0AKly9aTVY/edit#gid=629668047";
  var sourceSS;
  try {
    sourceSS = SpreadsheetApp.openByUrl(sourceUrl);
  } catch (e) {
    Logger.log("Помилка доступу до таблиці джерела. Перевірте права доступу. Помилка: " + e.toString());
    return;
  }
  
  var sourceSheet = sourceSS.getSheetByName("Клієнти (адреси)");
  if (!sourceSheet) {
    // Якщо не знайдено за ім'ям, беремо другий аркуш
    sourceSheet = sourceSS.getSheets()[1];
  }
  var sourceData = sourceSheet.getDataRange().getValues();
  
  // 2. Визначаємо поточний максимальний ID локації в базі
  var targetData = targetSheet.getDataRange().getValues();
  var maxIdNum = 0;
  for (var i = 1; i < targetData.length; i++) {
    var idStr = String(targetData[i][0]);
    if (idStr.match(/^L\d+$/i)) {
      var num = parseInt(idStr.substring(1), 10);
      if (num > maxIdNum) {
        maxIdNum = num;
      }
    }
  }
  
  var nextIdNum = maxIdNum + 1;
  var nowStr = new Date().toISOString();
  var countSuccess = 0;
  var countFailed = 0;
  
  // Центр Одеси на випадок збою геокодера (Дерибасівська/Грецька)
  var defaultLat = 46.4825;
  var defaultLng = 30.7426;
  
  Logger.log("Починаємо імпорт локацій Одеси. Наступний вільний ID: L" + padZeroOdessa(nextIdNum, 3));
  
  // Пропускаємо заголовок (рядок 0)
  for (var r = 1; r < sourceData.length; r++) {
    var rawName = String(sourceData[r][0] || "").trim();
    var rawAddress = String(sourceData[r][1] || "").trim();
    var rawRayon = String(sourceData[r][2] || "").trim();
    
    if (!rawName && !rawAddress) {
      continue;
    }
    
    // Якщо ім'я порожнє, але адреса є, використовуємо адресу або заглушку
    var cleanName = rawName ? rawName : "Точка " + rawAddress;
    
    // Видаляємо коментарі в дужках із імені для гарного вигляду
    cleanName = cleanName.replace(/\s*\([^)]+\)/g, "").trim();
    
    // 4. Очищуємо адресу для точнішого геокодування
    var geocodeAddress = rawAddress;
    
    // Окремий випадок для Цифрового містечка
    if (geocodeAddress.toLowerCase().indexOf("цифрове містечко") !== -1) {
      geocodeAddress = "Старосінна площа, 1а";
    }
    
    // Видаляємо інформацію в дужках типу (атб) з адреси геокодування
    geocodeAddress = geocodeAddress.replace(/\s*\([^)]+\)/g, "").trim();
    
    // Якщо немає міста Одеса, додаємо
    if (!geocodeAddress.match(/Одес/i)) {
      geocodeAddress = "Одеса, " + geocodeAddress;
    }
    
    // Якщо адреса подвійна (через слейш / або " або "), беремо першу частину
    if (geocodeAddress.indexOf("/") !== -1) {
      geocodeAddress = geocodeAddress.split("/")[0].trim();
    }
    
    // Видаляємо офіси, кабінети, квартири
    geocodeAddress = geocodeAddress
      .replace(/(?:офіс|оф\.|кв\.|п\.|підвальне|кімната|буд\.).*$/i, "")
      .trim();
      
    var lat = defaultLat;
    var lng = defaultLng;
    var geocodeStatus = "Placeholder (Збій геокодера)";
    
    try {
      var response = Maps.newGeocoder()
        .setLanguage("uk")
        .geocode(geocodeAddress);
        
      if (response.status === "OK" && response.results.length > 0) {
        var location = response.results[0].geometry.location;
        lat = location.lat;
        lng = location.lng;
        geocodeStatus = "OK";
        countSuccess++;
      } else {
        Logger.log("Не вдалося геокодувати: " + geocodeAddress + " (Статус: " + response.status + ")");
        geocodeStatus = "Не знайдено адресу: " + geocodeAddress;
        countFailed++;
      }
    } catch (e) {
      Logger.log("Помилка під час геокодування: " + geocodeAddress + ". Опис: " + e.toString());
      geocodeStatus = "Помилка API: " + e.toString();
      countFailed++;
    }
    
    var locationId = "L" + padZeroOdessa(nextIdNum, 3);
    var targetRowIndex = targetSheet.getLastRow() + 1;
    var mapLinkFormula = "=HYPERLINK(\"https://www.google.com/maps/search/?api=1&query=\"&SUBSTITUTE(D" + targetRowIndex + ";\",\";\".\")&\",\"&SUBSTITUTE(E" + targetRowIndex + ";\",\";\".\");\"Карта\")";
    
    var notes = "Імпортовано: " + geocodeStatus;
    if (rawRayon) {
      notes += " | Район: " + rawRayon;
    }
    if (rawName && rawName !== cleanName) {
      notes += " | Повне ім'я: " + rawName;
    }
    
    var newRow = [
      locationId,
      cleanName,
      rawAddress,
      lat,
      lng,
      30, // radius_m
      "false", // indoor
      "true", // active
      nowStr, // updated_at
      notes, // notes
      "Одеса", // region (встановлюємо місто як спільний регіон)
      mapLinkFormula
    ];
    
    targetSheet.appendRow(newRow);
    nextIdNum++;
  }
  
  // Збільшуємо points_version в Settings
  incrementPointsVersionOdessa(activeSS);
  
  Logger.log("Імпорт адрес завершено!");
  Logger.log("Успішно зкодовано: " + countSuccess + " точок.");
  Logger.log("Не вдалося/помилки: " + countFailed + " точок.");
}

/**
 * Імпортує кур'єрів та логістів з Одеси, автоматично генеруючи для них паролі (PIN)
 * на основі останніх 4 цифр телефону.
 */
function importOdessaPersonnel() {
  var activeSS = SpreadsheetApp.getActiveSpreadsheet();
  var couriersSheet = activeSS.getSheetByName("Couriers");
  var logistsSheet = activeSS.getSheetByName("Logists");
  
  if (!couriersSheet || !logistsSheet) {
    Logger.log("Помилка: не знайдено аркуш Couriers або Logists в поточній базі.");
    return;
  }
  
  // 1. Відкриваємо джерело з персоналом
  var sourceUrl = "https://docs.google.com/spreadsheets/d/1EuWteV8vzhLXbAHLWCjKCXBPwsrrDUWlK0AKly9aTVY/edit#gid=629668047";
  var sourceSS;
  try {
    sourceSS = SpreadsheetApp.openByUrl(sourceUrl);
  } catch (e) {
    Logger.log("Помилка доступу до таблиці джерела. Перевірте права доступу. Помилка: " + e.toString());
    return;
  }
  
  var sourceSheet = sourceSS.getSheetByName("ПІБ кур'єрів");
  if (!sourceSheet) {
    sourceSheet = sourceSS.getSheets()[0];
  }
  var sourceData = sourceSheet.getDataRange().getValues();
  
  // 2. Визначаємо поточний максимальний ID кур'єрів
  var courierData = couriersSheet.getDataRange().getValues();
  var maxCourierNum = 0;
  for (var i = 1; i < courierData.length; i++) {
    var idStr = String(courierData[i][0]);
    if (idStr.match(/^C\d+$/i)) {
      var num = parseInt(idStr.substring(1), 10);
      if (num > maxCourierNum) {
        maxCourierNum = num;
      }
    }
  }
  var nextCourierNum = maxCourierNum + 1;
  
  // 3. Визначаємо поточний максимальний ID логістів
  var logistData = logistsSheet.getDataRange().getValues();
  var maxLogistNum = 0;
  for (var i = 1; i < logistData.length; i++) {
    var idStr = String(logistData[i][0]);
    if (idStr.match(/^LO\d+$/i)) {
      var num = parseInt(idStr.substring(2), 10);
      if (num > maxLogistNum) {
        maxLogistNum = num;
      }
    }
  }
  var nextLogistNum = maxLogistNum + 1;
  
  var couriersAdded = 0;
  var logistsAdded = 0;
  
  for (var r = 0; r < sourceData.length; r++) {
    var colA = String(sourceData[r][0] || "").trim();
    var colB = String(sourceData[r][1] || "").trim();
    var colC = String(sourceData[r][2] || "").trim();
    var colD = String(sourceData[r][3] || "").trim();
    
    // Окремий випадок для логіста: Осадченко Катерина
    if (colA.indexOf("Осадченко") !== -1 && colC) {
      var logistName = colA;
      var logistPhone = colC;
      var logistDevice = colD;
      
      // Форматуємо телефон
      var cleanPhone = logistPhone.replace(/[\s+-]/g, "");
      if (cleanPhone.indexOf("0") === 0 && cleanPhone.length === 10) {
        cleanPhone = "38" + cleanPhone;
      } else if (cleanPhone.length === 9) {
        cleanPhone = "380" + cleanPhone;
      }
      
      // Перевірка дублікатів
      var isDuplicate = false;
      for (var i = 1; i < logistData.length; i++) {
        var existingPhone = String(logistData[i][2] || "").replace(/[\s+-]/g, "");
        if (existingPhone === cleanPhone) {
          isDuplicate = true;
          Logger.log("Логіст з телефоном " + logistPhone + " вже є в базі. Пропускаємо.");
          break;
        }
      }
      if (isDuplicate) continue;
      
      var pin = cleanPhone.substring(cleanPhone.length - 4);
      var pinHash = getSha256HashOdessa(pin);
      
      var logistId = "LO" + String(nextLogistNum).padStart(3, '0');
      var newRow = [
        logistId,
        logistName,
        "+" + cleanPhone,
        pinHash,
        "", // token
        "true", // active
        logistDevice.toLowerCase().indexOf("айфон") !== -1 || logistDevice.toLowerCase().indexOf("ios") !== -1 ? "ios" : "android",
        "Імпортовано з Одеси (PIN: " + pin + ")",
        "Одеса"
      ];
      
      logistsSheet.appendRow(newRow);
      Logger.log("Додано логіста: " + logistName + " (" + logistId + ") | PIN: " + pin);
      nextLogistNum++;
      logistsAdded++;
      continue;
    }
    
    // Перевірка на звичайного кур'єра
    if (!colC || colC.indexOf("Ном.тел") !== -1 || colC === "") {
      continue;
    }
    
    if (colB && colB !== "Ім'я") {
      var courierName = colB;
      var courierPhone = colC;
      var courierDevice = colD;
      
      // Форматуємо телефон
      var cleanPhone = courierPhone.replace(/[\s+-]/g, "");
      if (cleanPhone.indexOf("0") === 0 && cleanPhone.length === 10) {
        cleanPhone = "38" + cleanPhone;
      } else if (cleanPhone.length === 9) {
        cleanPhone = "380" + cleanPhone;
      }
      
      // Перевірка дублікатів
      var isDuplicate = false;
      for (var i = 1; i < courierData.length; i++) {
        var existingPhone = String(courierData[i][2] || "").replace(/[\s+-]/g, "");
        if (existingPhone === cleanPhone) {
          isDuplicate = true;
          Logger.log("Кур'єр з телефоном " + courierPhone + " вже є в базі. Пропускаємо.");
          break;
        }
      }
      if (isDuplicate) continue;
      
      var pin = cleanPhone.substring(cleanPhone.length - 4);
      var pinHash = getSha256HashOdessa(pin);
      
      var courierId = "C" + String(nextCourierNum).padStart(3, '0');
      var newRow = [
        courierId,
        courierName,
        "+" + cleanPhone,
        pinHash,
        "", // token
        "true", // active
        courierDevice.toLowerCase().indexOf("айфон") !== -1 || courierDevice.toLowerCase().indexOf("ios") !== -1 ? "ios" : "android",
        "Імпортовано з Одеси (PIN: " + pin + ")",
        "Одеса"
      ];
      
      couriersSheet.appendRow(newRow);
      Logger.log("Додано кур'єра: " + courierName + " (" + courierId + ") | PIN: " + pin);
      nextCourierNum++;
      couriersAdded++;
    }
  }
  
  Logger.log("Імпорт персоналу завершено! Додано кур'єрів: " + couriersAdded + ", логістів: " + logistsAdded);
}

// --- Допоміжні функції для Одеси ---

function padZeroOdessa(num, size) {
  var s = num + "";
  while (s.length < size) s = "0" + s;
  return s;
}

function incrementPointsVersionOdessa(ss) {
  var sheet = ss.getSheetByName("Settings");
  if (!sheet) return;
  
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === "points_version") {
      var currentVal = parseInt(data[i][1] || 1);
      sheet.getRange(i + 1, 2).setValue(currentVal + 1);
      Logger.log("Версію точок (points_version) збільшено на 1. Нова версія: " + (currentVal + 1));
      return;
    }
  }
}

function getSha256HashOdessa(input) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  var output = "";
  for (var i = 0; i < rawHash.length; i++) {
    var byteVal = rawHash[i];
    if (byteVal < 0) {
      byteVal += 256;
    }
    var byteString = byteVal.toString(16);
    if (byteString.length == 1) {
      byteString = "0" + byteString;
    }
    output += byteString;
  }
  return output;
}
