/**
 * Імпортує адреси клієнтів з Івано-Франківська, автоматично геокодує їх через Google Maps
 * та додає до бази точок Courier Visit Tracker.
 */
function importAndGeocodeIFLocations() {
  var activeSS = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = activeSS.getSheetByName("Locations");
  if (!targetSheet) {
    Logger.log("Помилка: не знайдено аркуш Locations в поточній базі.");
    return;
  }
  
  // Встановлюємо заголовок для посилань на карти в стовпчик L (12)
  targetSheet.getRange(1, 12).setValue("map_link");
  
  // 1. Відкриваємо джерело з адресами
  var sourceUrl = "https://docs.google.com/spreadsheets/d/17tqftI59LrdB6TaAKBr53GRlQ_CC6aWFNP6t6j3aSjc/edit#gid=0";
  var sourceSS;
  try {
    sourceSS = SpreadsheetApp.openByUrl(sourceUrl);
  } catch (e) {
    Logger.log("Помилка доступу до таблиці джерела. Перевірте права доступу. Помилка: " + e.toString());
    return;
  }
  
  var sourceSheet = sourceSS.getSheets()[0];
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
  
  // Центр Івано-Франківська на випадок збою геокодера
  var defaultLat = 48.9226;
  var defaultLng = 24.7111;
  
  Logger.log("Починаємо імпорт. Наступний вільний ID: L" + padZero(nextIdNum, 3));
  
  // Пропускаємо заголовок (рядок 0)
  for (var r = 1; r < sourceData.length; r++) {
    var rawName = String(sourceData[r][0] || "").trim();
    var rawAddress = String(sourceData[r][1] || "").trim();
    
    if (!rawName || !rawAddress || rawName === "Клієнт") {
      continue;
    }
    
    // 3. Очищуємо ім'я клієнта для красивого відображення в додатку
    // Видаляємо префікси міста та компаній
    var cleanName = rawName
      .replace(/^Івано-Франківськ\s*(\([^)]+\))?\s*/i, "")
      .replace(/MediaSoft/i, "")
      .replace(/\s+/g, " ")
      .trim();
      
    // 4. Очищуємо адресу для точнішого геокодування
    var geocodeAddress = rawAddress;
    
    // Якщо немає міста, додаємо Івано-Франківськ
    if (!geocodeAddress.match(/Франківськ/i)) {
      geocodeAddress = "Івано-Франківськ, " + geocodeAddress;
    }
    
    // Якщо адреса подвійна (через слейш / або " або "), беремо першу частину
    if (geocodeAddress.indexOf("/") !== -1) {
      geocodeAddress = geocodeAddress.split("/")[0].trim();
    }
    
    // Видаляємо офіси, кабінети, квартири, назви компаній в кінці
    geocodeAddress = geocodeAddress
      .replace(/(?:ПП|ТОВ|ТзОВ|офіс|оф\.|кв\.|п\.|підвальне|кімната|буд\.).*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
      
    // 5. Виконуємо геокодування через вбудований сервіс Google Maps
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
    
    // 6. Формуємо рядок для запису
    var locationId = "L" + padZero(nextIdNum, 3);
    var targetRowIndex = targetSheet.getLastRow() + 1;
    var mapLinkFormula = "=HYPERLINK(\"https://www.google.com/maps/search/?api=1&query=\"&SUBSTITUTE(D" + targetRowIndex + ";\",\";\".\")&\",\"&SUBSTITUTE(E" + targetRowIndex + ";\",\";\".\");\"Карта\")";
    
    var newRow = [
      locationId,
      cleanName,
      rawAddress, // Зберігаємо повну адресу для кур'єра
      lat,
      lng,
      30, // Радіус за замовчуванням (30м)
      "false", // indoor
      "true", // active
      nowStr, // updated_at
      "Імпортовано: " + geocodeStatus, // notes
      "Івано-Франківськ", // region
      mapLinkFormula // map_link (стовпчик L)
    ];
    
    targetSheet.appendRow(newRow);
    nextIdNum++;
  }
  
  // 7. Збільшуємо points_version в Settings
  incrementPointsVersion(activeSS);
  
  Logger.log("Імпорт завершено!");
  Logger.log("Успішно зкодовано: " + countSuccess + " точок.");
  Logger.log("Не вдалося/помилки: " + countFailed + " точок.");
}

function padZero(num, size) {
  var s = num + "";
  while (s.length < size) s = "0" + s;
  return s;
}

function incrementPointsVersion(ss) {
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

/**
 * Додає формулу посилання на карту (Google Maps) у стовпчик L для всіх існуючих локацій.
 * Запустіть цю функцію ОДИН РАЗ, щоб створити посилання для вже імпортованих точок.
 */
function addMapLinksToAllLocations() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Locations");
  if (!sheet) {
    Logger.log("Помилка: не знайдено аркуш Locations");
    return;
  }
  
  // Встановлюємо заголовок стовпчика L (стовпчик 12)
  sheet.getRange(1, 12).setValue("map_link");
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  var formulas = [];
  for (var r = 2; r <= lastRow; r++) {
    var formula = "=HYPERLINK(\"https://www.google.com/maps/search/?api=1&query=\"&SUBSTITUTE(D" + r + ";\",\";\".\")&\",\"&SUBSTITUTE(E" + r + ";\",\";\".\");\"Карта\")";
    formulas.push([formula]);
  }
  
  // Записуємо формули одним пакетом для швидкості
  sheet.getRange(2, 12, formulas.length, 1).setFormulas(formulas);
  Logger.log("Успішно додано посилання на карту для " + formulas.length + " точок!");
}

