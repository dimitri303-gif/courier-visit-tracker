/**
 * ServerVisitDetector_TG.gs
 * Обчислення візитів на сервері (заміна клієнтського детектора).
 */

function handleTelegramLocation(message) {
  try {
    var chatId = message.chat.id;
    if (!message.location) return;
    
    var lat = message.location.latitude;
    var lng = message.location.longitude;
    var timestamp = message.edit_date || message.date; // Unix time in seconds
    
    var courierId = getCourierIdFromChat(chatId);
    if (!courierId) return; // Невідомий користувач
    
    var cache = CacheService.getScriptCache();
    var shiftId = cache.get("shift_" + courierId);
    if (!shiftId) return; // Немає активної зміни
    
    // 1. Отримуємо кешовані локації
    var locationsStr = cache.get("locations_TG");
    var locations = [];
    if (locationsStr) {
      try {
        locations = JSON.parse(locationsStr);
      } catch(e) {}
    }
    
    if (!locations || locations.length === 0) {
      locations = getActiveLocations();
      try {
        cache.put("locations_TG", JSON.stringify(locations), 300); // 5 хвилин
      } catch(e) {}
    }
    
    // 2. Пошук найближчої точки
    var closestLoc = null;
    var minDistance = Infinity;
    
    for (var i = 0; i < locations.length; i++) {
      var d = getDistanceInMeters(lat, lng, locations[i].latitude, locations[i].longitude);
      if (d < minDistance) {
        minDistance = d;
        closestLoc = locations[i];
      }
    }
    
    // 3. State Machine (Кінцевий автомат)
    var stateStr = cache.get("state_TG_" + courierId);
    var state = null;
    if (stateStr) {
      try {
        state = JSON.parse(stateStr);
      } catch(e) {}
    }
    
    var DWELL_TIME_SEC = 60; // 60 секунд для зарахування візиту
    var EXIT_THRESHOLD = 3;  // 3 виміри поза зоною для виходу
    
    if (closestLoc && minDistance <= closestLoc.radius_m) {
      // МИ В ЗОНІ
      if (!state) {
        // Новий кандидат
        state = {
          location_id: closestLoc.location_id,
          location_name: closestLoc.name,
          status: "candidate",
          enter_time: timestamp,
          last_seen: timestamp,
          enter_lat: lat,
          enter_lng: lng,
          outside_count: 0
        };
      } else {
        if (state.location_id === closestLoc.location_id) {
          state.last_seen = timestamp;
          state.outside_count = 0;
          
          // Перехід Кандидат -> Підтверджений візит
          if (state.status === "candidate" && (timestamp - state.enter_time) >= DWELL_TIME_SEC) {
            state.status = "inside";
            sendTelegramRequest("sendMessage", {
              "chat_id": chatId, 
              "text": "📍 Візит на точку «" + closestLoc.name + "» розпочато."
            });
          }
        } else {
          // Зміна локації
          if (state.status === "inside") {
            recordVisit(courierId, shiftId, state, timestamp, lat, lng);
          }
          state = {
            location_id: closestLoc.location_id,
            location_name: closestLoc.name,
            status: "candidate",
            enter_time: timestamp,
            last_seen: timestamp,
            enter_lat: lat,
            enter_lng: lng,
            outside_count: 0
          };
        }
      }
      try {
        cache.put("state_TG_" + courierId, JSON.stringify(state), 21600);
      } catch(e) {}
      
    } else {
      // МИ ПОЗА ЗОНОЮ
      if (state) {
        state.outside_count = (state.outside_count || 0) + 1;
        
        if (state.outside_count >= EXIT_THRESHOLD) {
          if (state.status === "inside") {
            var exitTime = state.last_seen;
            recordVisit(courierId, shiftId, state, exitTime, lat, lng);
            
            sendTelegramRequest("sendMessage", {
              "chat_id": chatId, 
              "text": "🏁 Візит на точку «" + (state.location_name || state.location_id) + "» завершено."
            });
          }
          try {
            cache.remove("state_TG_" + courierId);
          } catch(e) {}
        } else {
          try {
            cache.put("state_TG_" + courierId, JSON.stringify(state), 21600);
          } catch(e) {}
        }
      }
    }
  } catch (err) {
    Logger.log("handleTelegramLocation error: " + err.toString());
  }
}

/**
 * Запис підтвердженого візиту в таблицю Visits (18 колонок)
 */
function recordVisit(courierId, shiftId, state, exitTime, exitLat, exitLng) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("Visits");
    if (!sheet) return;
    
    var visitId = generateUUID();
    var eventUuid = generateUUID();
    
    var enterDate = new Date(state.enter_time * 1000);
    var exitDate = new Date(exitTime * 1000);
    var durationSecs = Math.max(0, Math.round((exitDate.getTime() - enterDate.getTime()) / 1000));
    var now = new Date();
    
    sheet.appendRow([
      visitId,
      eventUuid,
      courierId,
      shiftId,
      state.location_id,
      enterDate,
      exitDate,
      durationSecs,
      state.enter_lat,
      state.enter_lng,
      exitLat,
      exitLng,
      10, // accuracy_m
      0,  // matched_distance_m
      "telegram_live", // source
      "true", // offline_synced
      now, // created_at
      JSON.stringify(state) // raw_payload
    ]);
  } catch (e) {
    Logger.log("recordVisit error: " + e.toString());
  }
}
