/**
 * Router.gs
 * Головний маршрутизатор та обробка HTTP-запитів.
 */

// Глобальний контекст для передачі параметрів у вкладені HTML-шаблони
var currentTemplateContext = {};

/**
 * Підключає HTML-файл як вставку (для include-паттерну в шаблонах)
 */
function include(filename) {
  var template = HtmlService.createTemplateFromFile(filename);
  template.currentPage = currentTemplateContext.currentPage || '';
  template.webAppUrl = currentTemplateContext.webAppUrl || '';
  return template.evaluate().getContent();
}

function doGet(e) {
  var action = e.parameter.action;
  
  // Якщо дія не задана, віддаємо веб-інтерфейс для iOS fallback
  if (!action) {
    try {
      var template = HtmlService.createTemplateFromFile("Web");
      // Передаємо URL веб-додатку в шаблон для відправки запитів до себе
      template.webAppUrl = ScriptApp.getService().getUrl();
      return template.evaluate()
        .setTitle("Courier Visit Tracker MVP")
        .addMetaTag("viewport", "width=device-width, initial-scale=1")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch(err) {
      return ContentService.createTextOutput("Помилка завантаження веб-інтерфейсу: " + err.toString());
    }
  }
  

  if (action === "dashboard") {
    try {
      var page = e.parameter.page || 'maps';
      var PAGE_MAP = {
        'maps': 'DashboardMaps',
        'analytics': 'DashboardAnalytics',
        'database': 'DashboardDB'
      };
      var templateName = PAGE_MAP[page] || 'DashboardMaps';
      
      // Зберігаємо глобальний контекст перед створенням шаблону
      currentTemplateContext.currentPage = page;
      currentTemplateContext.webAppUrl = ScriptApp.getService().getUrl();
      
      var template = HtmlService.createTemplateFromFile(templateName);
      template.webAppUrl = currentTemplateContext.webAppUrl;
      template.currentPage = page;
      return template.evaluate()
        .setTitle("Courier Tracker — Dashboard")
        .addMetaTag("viewport", "width=device-width, initial-scale=1")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch(err) {
      return ContentService.createTextOutput("Помилка завантаження дашборду: " + err.toString());
    }
  }
  
  // Маршрути для API
  if (action === "ping") {
    return jsonResponse({ ok: true, time: new Date().toISOString() });
  }
  
  var token = e.parameter.token;
  if (!token) {
    return jsonResponse({ ok: false, error: "Missing authentication token" });
  }
  
  // Перевірка авторизації токена
  var courier = getCourierByToken(token);
  if (!courier) {
    return jsonResponse({ ok: false, error: "Unauthorized token" });
  }
  
  var responseObj;
  
  if (action === "config") {
    var config = getSettings();
    responseObj = jsonResponse({
      ok: true,
      config: config,
      points_version: parseInt(config.points_version || 1)
    });
  }
  
  else if (action === "points") {
    var clientVersion = parseInt(e.parameter.version || 0);
    var config = getSettings();
    var serverVersion = parseInt(config.points_version || 1);
    
    if (clientVersion === serverVersion) {
      responseObj = jsonResponse({
        ok: true,
        status: "not_modified",
        points_version: serverVersion,
        config: config
      });
    } else {
      var points = getActiveLocations(courier.region);
      responseObj = jsonResponse({
        ok: true,
        points_version: serverVersion,
        points: points,
        config: config
      });
    }
  }
  
  else {
    responseObj = jsonResponse({ ok: false, error: "Invalid action" });
  }
  
  // Додаємо location_request у відповідь, якщо є активний запит координат для кур'єра
  if (courier && courier.role === "courier" && responseObj) {
    if (hasPendingLocationRequest(courier.courier_id)) {
      try {
        var content = JSON.parse(responseObj.getContent());
        content.location_request = true;
        responseObj = jsonResponse(content);
      } catch (e) {}
    }
  }
  
  return responseObj;
}

/**
 * POST маршрутизатор
 */
function doPost(e) {
  var action = e.parameter.action;
  var payload;
  
  try {
    // Мобільні пристрої та веб-сторінка будуть відправляти JSON у тілі запиту
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Invalid JSON payload" });
  }
  
  // Якщо action немає в URL параметрах, шукаємо в JSON тілі
  if (!action) {
    action = payload.action;
  }
  
  if (action === "login") {
    return handleLogin(payload);
  }
  
  // Для решти запитів потрібен токен авторизації
  var token = payload.token;
  if (!token) {
    return jsonResponse({ ok: false, error: "Missing authentication token" });
  }
  
  var courier = getCourierByToken(token);
  if (!courier) {
    return jsonResponse({ ok: false, error: "Unauthorized token" });
  }
  
  var responseObj;
  
  // Блокуємо одночасні записи в таблицю через LockService
  var lock = LockService.getScriptLock();
  try {
    // Чекаємо до 10 секунд на звільнення блокування
    lock.waitLock(10000);
    
    if (action === "shift/start") {
      responseObj = handleShiftStart(payload, courier);
    } else if (action === "shift/end") {
      responseObj = handleShiftEnd(payload, courier);
    } else if (action === "events/batch") {
      responseObj = handleEventsBatch(payload, courier);
    } else if (action === "logist/couriers") {
      if (courier.role !== "logist") {
        return jsonResponse({ ok: false, error: "Access denied: not a logist" });
      }
      responseObj = handleGetLogistCouriers(payload, courier);
    } else if (action === "logist/request-location") {
      if (courier.role !== "logist") {
        return jsonResponse({ ok: false, error: "Access denied: not a logist" });
      }
      responseObj = handleRequestLocation(payload);
    } else {
      responseObj = jsonResponse({ ok: false, error: "Invalid POST action" });
    }
    
    // Додаємо оновлені параметри у відповідь для кур'єра (config, points_version, location_request)
    if (courier && courier.role === "courier" && responseObj) {
      try {
        var content = JSON.parse(responseObj.getContent());
        
        // Додаємо прапорець запиту геоданих, якщо він є активним
        if (hasPendingLocationRequest(courier.courier_id)) {
          content.location_request = true;
        }
        
        // Завжди повертаємо актуальні налаштування та версію точок
        var config = getSettings();
        content.config = config;
        content.points_version = parseInt(config.points_version || 1);
        
        responseObj = jsonResponse(content);
      } catch (e) {}
    }
    
  } catch (err) {
    responseObj = jsonResponse({ ok: false, error: "Database lock timeout: " + err.toString() });
  } finally {
    lock.releaseLock();
  }
  
  return responseObj;
}
