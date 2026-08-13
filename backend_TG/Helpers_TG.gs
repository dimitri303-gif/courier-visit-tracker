/**
 * Helpers_TG.gs
 * Допоміжні функції для розрахунків та генерації UUID.
 */

/**
 * Генерація UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Розрахунок відстані між двома координатами за формулою гаверсину (в метрах)
 */
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  var R = 6371e3; // радіус Землі в метрах
  var toRadians = function(deg) { return deg * Math.PI / 180; };
  var dLat = toRadians(lat2 - lat1);
  var dLon = toRadians(lon2 - lon1);
  
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
          
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

/**
 * Відправка POST запиту до Telegram API
 */
function sendTelegramRequest(method, payload) {
  var options = {
    'method' : 'post',
    'contentType': 'application/json',
    'payload' : JSON.stringify(payload),
    'muteHttpExceptions': true
  };
  
  try {
    var response = UrlFetchApp.fetch(TELEGRAM_API_URL + "/" + method, options);
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log("Telegram API Error: " + e.toString());
    return null;
  }
}
