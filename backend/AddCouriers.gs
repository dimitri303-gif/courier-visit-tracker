/**
 * Додає нових кур'єрів з Івано-Франківська до бази даних Couriers.
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
  
  // Хеш за замовчуванням для PIN-коду "1234":
  // Хеш потрібен додатку для перевірки PIN-коду при авторизації.
  var defaultPinHash = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";
  
  // Нові кур'єри зі скріншоту:
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
    
    // Перевірка на дублікат телефону (очищуємо пробіли та символи для порівняння)
    var cleanCPhone = c.phone.replace(/[\s+-]/g, "");
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
    
    var courierId = "C" + String(nextIdNum).padStart(3, '0');
    var newRow = [
      courierId,
      c.name,
      c.phone,
      defaultPinHash, // pin_hash (PIN: 1234 за замовчуванням)
      "", // token (згенерується при першому вході)
      c.active, // active ("true" або "false")
      "", // platform
      c.notes, // notes
      "Івано-Франківськ" // region
    ];
    
    sheet.appendRow(newRow);
    Logger.log("Додано кур'єра: " + c.name + " (" + courierId + ") з телефоном " + c.phone);
    nextIdNum++;
    addedCount++;
  }
  
  Logger.log("Успішно додано нових кур'єрів: " + addedCount);
}
