/**
 * Додає нових кур'єрів з Івано-Франківська до бази даних Couriers.
 * PIN-кодом є останні 4 цифри номера телефону кур'єра (хешуються через SHA-256).
 * Запустіть цю функцію один раз в інтерфейсі Google Apps Script.
 */
function addNewIFCouriers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Couriers");
  if (!sheet) {
    Logger.log("Помилка: не знайдено аркуш Couriers");
    return;
  }
  
  var targetData = sheet.getDataRange().getValues();
  var maxIdNum = 0;
  for (var i = 1; i < targetData.length; i++) {
    var idStr = String(targetData[i][0]);
    if (idStr.match(/^C\d+$/i)) {
      var num = parseInt(idStr.substring(1), 10);
      if (num > maxIdNum) {
        maxIdNum = num;
      }
    }
  }
  
  var nextIdNum = maxIdNum + 1;
  
  // Список нових кур'єрів з вашого чату Telegram
  var newCouriers = [
    { name: "Андрій Телько", phone: "+380663056054", active: "true", notes: "Син Володимира Івановича" },
    { name: "Наталя", phone: "+380680408458", active: "true", notes: "кур'єрка" },
    { name: "Ростислав Кушлик", phone: "+380974650681", active: "true", notes: "На водія" },
    { name: "Василь", phone: "+380986140796", active: "false", notes: "Не активний (водій)" },
    { name: "Влад", phone: "+380688732323", active: "true", notes: "На веліку" },
    { name: "Олександр", phone: "+380662682981", active: "true", notes: "Саша" }
  ];
  
  var addedCount = 0;
  for (var k = 0; k < newCouriers.length; k++) {
    var c = newCouriers[k];
    
    // Очищуємо телефон від пробілів та зайвих знаків
    var cleanCPhone = c.phone.replace(/[\s+-]/g, "");
    if (cleanCPhone.length < 4) {
      Logger.log("Помилка: некоректний номер телефону для " + c.name + ". Пропускаємо.");
      continue;
    }
    
    // Перевірка телефону на дублікати
    var isDuplicate = false;
    for (var i = 1; i < targetData.length; i++) {
      var existingPhone = String(targetData[i][2] || "").replace(/[\s+-]/g, "");
      if (existingPhone === cleanCPhone) {
        isDuplicate = true;
        Logger.log("Кур'єр з телефоном " + c.phone + " вже є в базі під іменем '" + targetData[i][1] + "'. Пропускаємо.");
        break;
      }
    }
    
    if (isDuplicate) continue;
    
    // Витягуємо останні 4 цифри телефону як PIN
    var pin = cleanCPhone.substring(cleanCPhone.length - 4);
    var pinHash = getSha256Hash(pin);
    
    var courierId = "C" + String(nextIdNum).padStart(3, '0');
    var newRow = [
      courierId,
      c.name,
      c.phone,
      pinHash, // pin_hash (SHA-256 від останніх 4 цифр телефону)
      "", // token
      c.active, // active ("true" або "false")
      "", // platform
      c.notes + " (PIN: " + pin + ")", // Додаємо пін-код у нотатки для зручності адміна
      "Івано-Франківськ" // region
    ];
    
    sheet.appendRow(newRow);
    Logger.log("Додано кур'єра: " + c.name + " (" + courierId + ") | Телефон: " + c.phone + " | ПІН: " + pin);
    nextIdNum++;
    addedCount++;
  }
  
  Logger.log("Успішно додано нових кур'єрів: " + addedCount);
}

/**
 * Генерує SHA-256 хеш для рядка (вбудовані методи Apps Script)
 */
function getSha256Hash(input) {
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
