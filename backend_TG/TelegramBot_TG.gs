/**
 * TelegramBot_TG.gs
 * Логіка відповідей бота, авторизації кур'єрів та керування змінами.
 */

function getMainKeyboard() {
  return {
    "keyboard": [
      [{"text": "▶️ Почати зміну"}, {"text": "⏹ Завершити зміну"}],
      [{"text": "ℹ️ Як налаштувати"}]
    ],
    "resize_keyboard": true
  };
}

function handleTelegramMessage(message) {
  var chatId = message.chat.id;
  var text = message.text || "";
  
  if (text === "/start") {
    var profile = getCourierProfile(chatId);
    if (profile) {
      sendTelegramRequest("sendMessage", {
        "chat_id": chatId,
        "text": "👋 Вітаємо, " + profile.name + "!\n\nОберіть дію на клавіатурі нижче:",
        "reply_markup": getMainKeyboard()
      });
      return;
    }
    sendWelcomeMessage(chatId);
    return;
  }
  
  if (message.contact) {
    handleContactRegistration(chatId, message.contact.phone_number);
    return;
  }
  
  if (text === "▶️ Почати зміну") {
    startShiftCommand(chatId);
    return;
  }
  
  if (text === "⏹ Завершити зміну") {
    endShiftCommand(chatId);
    return;
  }
  
  if (text.indexOf("налаштувати") !== -1 || text === "/help" || text === "/setup") {
    sendSetupInstructions(chatId);
    return;
  }
  
  // Якщо кур'єр просто надіслав разову статичну локацію
  if (message.location) {
    handleTelegramLocation(message);
    return;
  }

  // Для будь-якого іншого повідомлення повертаємо меню
  var courierProfile = getCourierProfile(chatId);
  if (courierProfile) {
    sendTelegramRequest("sendMessage", {
      "chat_id": chatId,
      "text": "Оберіть дію на кнопках нижче 👇",
      "reply_markup": getMainKeyboard()
    });
  }
}

function sendSetupInstructions(chatId) {
  var text = "📱 *Інструкція з налаштування геопозиції:*\n\n" +
             "🍏 *Для iPhone (iOS):*\n" +
             "1️⃣ Відкрийте **Параметри** (Settings) на iPhone ⚙️\n" +
             "2️⃣ Прокрутіть униз до списку програм і виберіть **Telegram**\n" +
             "3️⃣ Перейдіть у пункт **«Геопозиція»** (Location)\n" +
             "4️⃣ Оберіть **«Завжди»** (Always) — *(а не «Під час використання»)*\n" +
             "5️⃣ Переконайтеся, що увімкнено **«Точна геопозиція»** (Precise Location)\n\n" +
             "🤖 *Для Android:*\n" +
             "1️⃣ Налаштування ➡️ Програми ➡️ **Telegram**\n" +
             "2️⃣ Дозволи ➡️ Місцезнаходження ➡️ **«Дозволити у будь-якому режимі»** (Allow all the time)\n" +
             "3️⃣ Увімкніть **«Точне місцезнаходження»**\n\n" +
             "⚠️ *Це потрібно для того, щоб передача геопозиції не переривалася, коли екран телефону вимкнено або закрито додаток.*";

  sendTelegramRequest("sendMessage", {
    "chat_id": chatId,
    "text": text,
    "parse_mode": "Markdown",
    "reply_markup": getMainKeyboard()
  });
}

function sendWelcomeMessage(chatId) {
  var text = "👋 Вітаємо у системі Courier Tracker!\n\nДля початку роботи надішліть свій номер телефону (натисніть кнопку нижче).";
  var keyboard = {
    "keyboard": [
      [{"text": "📱 Надіслати номер телефону", "request_contact": true}]
    ],
    "resize_keyboard": true,
    "one_time_keyboard": true
  };
  
  sendTelegramRequest("sendMessage", {
    "chat_id": chatId,
    "text": text,
    "reply_markup": keyboard
  });
}

function handleContactRegistration(chatId, phone) {
  try {
    if (!phone) {
      sendTelegramRequest("sendMessage", {
        "chat_id": chatId,
        "text": "❌ Номер телефону не передано. Спробуйте ще раз."
      });
      return;
    }
    
    // Нормалізація телефону: залишаємо лише цифри
    var cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.startsWith("38")) cleanPhone = cleanPhone.substring(2);
    
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("Couriers");
    if (!sheet) {
      sendTelegramRequest("sendMessage", {
        "chat_id": chatId,
        "text": "❌ Аркуш 'Couriers' не знайдено в таблиці."
      });
      return;
    }
    
    var rows = sheet.getDataRange().getValues();
    var courierId = null;
    var courierName = "";
    var matchedRowIndex = -1;
    
    // Пошук кур'єра за телефоном (колонка C / індекс 2)
    for (var i = 1; i < rows.length; i++) {
      var rowPhone = String(rows[i][2]).replace(/\D/g, '');
      if (rowPhone.startsWith("38")) rowPhone = rowPhone.substring(2);
      
      if (rowPhone === cleanPhone && rowPhone.length >= 9) {
        courierId = String(rows[i][0]);
        courierName = String(rows[i][1]);
        matchedRowIndex = i + 1; // 1-based index в Sheets
        break;
      }
    }
    
    if (courierId && matchedRowIndex > 0) {
      // Безпечно записуємо токен (chatId) у колонку 5 (E)
      try {
        sheet.getRange(matchedRowIndex, 5).setValue(String(chatId));
        // Якщо є 7+ колонок - пишемо платформу
        if (sheet.getMaxColumns() >= 7) {
          sheet.getRange(matchedRowIndex, 7).setValue("telegram");
        }
      } catch (sheetErr) {
        Logger.log("Sheet write error: " + sheetErr.toString());
      }
      
      // Зберігаємо прив'язку в CacheService
      try {
        var cache = CacheService.getScriptCache();
        var profile = { courier_id: courierId, name: courierName, phone: phone };
        cache.put("profile_" + chatId, JSON.stringify(profile), 21600);
        cache.put("chat_" + chatId, courierId, 21600);
      } catch (cacheErr) {
        Logger.log("Cache error: " + cacheErr.toString());
      }
      
      var welcomeText = "✅ Авторизація успішна, " + courierName + "!\n\nВикористовуйте кнопки нижче для управління зміною.";
      var keyboard = {
        "keyboard": [
          [{"text": "▶️ Почати зміну"}, {"text": "⏹ Завершити зміну"}],
          [{"text": "ℹ️ Як налаштувати"}]
        ],
        "resize_keyboard": true
      };
      
      sendTelegramRequest("sendMessage", {
        "chat_id": chatId,
        "text": welcomeText,
        "reply_markup": keyboard
      });
    } else {
      sendTelegramRequest("sendMessage", {
        "chat_id": chatId,
        "text": "❌ Ваш номер телефону (" + phone + ") не знайдено в списку кур'єрів.\nЗверніться до логіста/адміністратора для додавання."
      });
    }
  } catch (err) {
    Logger.log("handleContactRegistration error: " + err.toString());
    sendTelegramRequest("sendMessage", {
      "chat_id": chatId,
      "text": "⚠️ Помилка під час реєстрації: " + err.toString()
    });
  }
}

function startShiftCommand(chatId) {
  try {
    var profile = getCourierProfile(chatId);
    if (!profile) {
      sendTelegramRequest("sendMessage", {"chat_id": chatId, "text": "Спочатку авторизуйтесь через команду /start"});
      return;
    }
    
    var courierId = profile.courier_id;
    var courierName = profile.name;
    var shiftId = generateUUID();
    var startTime = new Date();
    
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("Shifts");
    if (!sheet) return;
    
    // Автозакриття попередніх відкритих змін (колонка 9 / index 8 == "active")
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var numRows = Math.min(lastRow - 1, 100);
      var startR = lastRow - numRows + 1;
      var range = sheet.getRange(startR, 1, numRows, 10);
      var rows = range.getValues();
      
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][1]) === courierId && String(rows[i][8]) === "active") {
          var prevStart = new Date(rows[i][2]);
          var durationMins = Math.round((startTime.getTime() - prevStart.getTime()) / 60000);
          var targetRow = startR + i;
          sheet.getRange(targetRow, 4).setValue(startTime).setNumberFormat("dd.MM.yyyy HH:mm:ss"); // end_time
          sheet.getRange(targetRow, 5).setValue(durationMins); // duration_minutes
          sheet.getRange(targetRow, 9).setValue("auto-closed"); // status
          sheet.getRange(targetRow, 10).setValue("Автоматично закрито новою зміною з Telegram");
        }
      }
    }
    
    // Створення нової зміни (10 колонок)
    sheet.appendRow([
      shiftId,
      courierId,
      startTime,
      "", // end_time
      "", // duration_minutes
      "telegram", // device_platform
      "1.0.0", // app_version
      "tg_" + chatId, // device_id
      "active", // status
      "Started via Telegram Bot" // notes
    ]);
    var newShiftRow = sheet.getLastRow();
    sheet.getRange(newShiftRow, 3).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    
    // Зберігаємо ID активної зміни в кеш
    try {
      var cache = CacheService.getScriptCache();
      cache.put("shift_" + courierId, shiftId, 21600);
    } catch(e) {}
    
    // ОНОВЛЮЄМО СТАТУС КУР'ЄРА НА ДАШБОРДІ В РЕАЛЬНОМУ ЧАСІ
    updateCourierStatus_TG(courierId, courierName, null, null, null, null, "active");
    
    // ЛОГУЄМО ПОДІЮ СТАРТУ ЗМІНИ В EventLog
    logEvent_TG(courierId, shiftId, "shift_start", "Shift started via Telegram Bot", {
      platform: "telegram",
      device_id: "tg_" + chatId,
      app_version: "1.0.0"
    });
    
    var text = "🟢 Зміну розпочато!\n\nТепер натисніть на **Скріпку (📎)** ➡️ **«Геопозиція»** ➡️ **«Транслювати мою геопозицію» (Live Location)** на 8 годин.";
    sendTelegramRequest("sendMessage", {
      "chat_id": chatId,
      "text": text,
      "parse_mode": "Markdown",
      "reply_markup": getMainKeyboard()
    });
  } catch (err) {
    Logger.log("startShiftCommand error: " + err.toString());
    sendTelegramRequest("sendMessage", {"chat_id": chatId, "text": "⚠️ Помилка старту зміни: " + err.toString()});
  }
}

function endShiftCommand(chatId) {
  try {
    var profile = getCourierProfile(chatId);
    if (!profile) {
      sendTelegramRequest("sendMessage", {"chat_id": chatId, "text": "Спочатку авторизуйтесь через команду /start"});
      return;
    }
    
    var courierId = profile.courier_id;
    var courierName = profile.name;
    var activeShiftId = getActiveShiftId(courierId);
    var endTime = new Date();
    
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("Shifts");
    if (!sheet) return;
    
    var lastRow = sheet.getLastRow();
    var closed = false;
    var foundShiftId = activeShiftId;
    
    if (lastRow > 1) {
      var numRows = Math.min(lastRow - 1, 100);
      var startR = lastRow - numRows + 1;
      var rows = sheet.getRange(startR, 1, numRows, 10).getValues();
      
      for (var i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i][1]) === courierId && String(rows[i][8]) === "active") {
          foundShiftId = String(rows[i][0]);
          var prevStart = new Date(rows[i][2]);
          var durationMins = Math.round((endTime.getTime() - prevStart.getTime()) / 60000);
          var targetRow = startR + i;
          sheet.getRange(targetRow, 4).setValue(endTime).setNumberFormat("dd.MM.yyyy HH:mm:ss");
          sheet.getRange(targetRow, 5).setValue(durationMins);
          sheet.getRange(targetRow, 9).setValue("ended");
          closed = true;
          break;
        }
      }
    }
    
    try {
      var cache = CacheService.getScriptCache();
      
      // Якщо кур'єр перебував на точці під час завершення зміни — автоматично записуємо завершений візит
      var stateStr = cache.get("state_TG_" + courierId);
      if (stateStr) {
        try {
          var state = JSON.parse(stateStr);
          if (state && state.status === "inside") {
            var exitUnix = Math.floor(endTime.getTime() / 1000);
            recordVisit(courierId, foundShiftId, state, exitUnix, state.enter_lat, state.enter_lng);
            logEvent_TG(courierId, foundShiftId, "visit_completed", "Visit completed on shift end: " + (state.location_name || state.location_id), {
              location_id: state.location_id
            });
          }
        } catch(stErr) {
          Logger.log("Auto-record visit on shift end error: " + stErr.toString());
        }
      }
      
      cache.remove("shift_" + courierId);
      cache.remove("state_TG_" + courierId);
    } catch(e) {}
    
    // ОНОВЛЮЄМО СТАТУС КУР'ЄРА НА ДАШБОРДІ (ended)
    updateCourierStatus_TG(courierId, courierName, null, null, null, null, "ended");
    
    // ЛОГУЄМО ПОДІЮ ЗАВЕРШЕННЯ ЗМІНИ В EventLog
    logEvent_TG(courierId, foundShiftId, "shift_end", "Shift ended via Telegram Bot", {
      platform: "telegram",
      device_id: "tg_" + chatId
    });
    
    if (closed) {
      sendTelegramRequest("sendMessage", {
        "chat_id": chatId, 
        "text": "🔴 Зміну успішно завершено!\nНе забудьте зупинити трансляцію геопозиції.",
        "reply_markup": getMainKeyboard()
      });
    } else {
      sendTelegramRequest("sendMessage", {
        "chat_id": chatId, 
        "text": "У вас немає активної зміни.",
        "reply_markup": getMainKeyboard()
      });
    }
  } catch (err) {
    Logger.log("endShiftCommand error: " + err.toString());
    sendTelegramRequest("sendMessage", {"chat_id": chatId, "text": "⚠️ Помилка завершення зміни: " + err.toString()});
  }
}
