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
 * Встановлення вебхука для Telegram-бота
 */
function setupWebhook(customUrl) {
  var webAppUrl = customUrl || "https://script.google.com/macros/s/AKfycbwobsbpl3llmUB_GwHsZAFc15qlyt75DbzmADrcwqgOKdHWs1Xp9KiXKEls2Qw1DBchuQ/exec";
  if (webAppUrl.indexOf("/dev") !== -1) {
    webAppUrl = "https://script.google.com/macros/s/AKfycbwobsbpl3llmUB_GwHsZAFc15qlyt75DbzmADrcwqgOKdHWs1Xp9KiXKEls2Qw1DBchuQ/exec";
  }
  var response = UrlFetchApp.fetch(TELEGRAM_API_URL + "/setWebhook?url=" + encodeURIComponent(webAppUrl));
  var resText = response.getContentText();
  Logger.log("Telegram setWebhook response: " + resText + " (URL: " + webAppUrl + ")");
  return resText;
}

