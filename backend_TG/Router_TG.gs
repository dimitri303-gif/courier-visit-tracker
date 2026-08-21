/**
 * Обробка Telegram вебхука (викликається з центрального doPost або автономно)
 */
function handleTelegramWebhook(e, update) {
  var chatId = null;
  try {
    if (!update && e && e.postData && e.postData.contents) {
      update = JSON.parse(e.postData.contents);
    }
    if (!update) {
      return HtmlService.createHtmlOutput('OK');
    }
    
    if (update.message && update.message.chat) {
      chatId = update.message.chat.id;
    } else if (update.edited_message && update.edited_message.chat) {
      chatId = update.edited_message.chat.id;
    }
    
    // Обробка звичайних повідомлень (команди, контакти)
    if (update.message) {
      handleTelegramMessage(update.message);
    } 
    // Обробка оновлень локації (Live Location)
    else if (update.edited_message) {
      handleTelegramLocation(update.edited_message);
    }
    
    return HtmlService.createHtmlOutput('OK');
  } catch (err) {
    Logger.log("handleTelegramWebhook Error: " + err.toString());
    if (chatId) {
      sendTelegramRequest("sendMessage", {
        "chat_id": chatId,
        "text": "⚠️ Помилка сервера:\n" + err.toString() + "\n" + (err.stack || "")
      });
    }
    return HtmlService.createHtmlOutput('OK');
  }
}

/**
 * Ручне встановлення вебхука
 */
function setupWebhook() {
  var webAppUrl = "https://script.google.com/macros/s/AKfycbxJNslGY4flV3_Mm6lsqWWvpwkNSV8WeVxwSUnM-EFF7upjKZIVyN4w1CSmZjnOfAo/exec";
  var response = UrlFetchApp.fetch(TELEGRAM_API_URL + "/setWebhook?url=" + encodeURIComponent(webAppUrl));
  Logger.log(response.getContentText());
}
