/**
 * ServerVisitDetector_TG.gs
 * Серверний детектор візитів, оновлення гео-статусу кур'єра та логування подій у реальному часі.
 */

function handleTelegramLocation(message) {
  try {
    var chatId = message.chat ? message.chat.id : null;
    if (!chatId || !message.location) return;
    
    var lat = message.location.latitude;
    var lng = message.location.longitude;
    var accuracy = message.location.horizontal_accuracy || 10;
    var timestamp = message.edit_date || message.date || Math.floor(Date.now() / 1000); // Unix time in seconds
    
    var profile = getCourierProfile(chatId);
    if (!profile) {
      Logger.log("Unknown courier for chat: " + chatId);
      return;
    }
    
    var courierId = profile.courier_id;
    var courierName = profile.name;
    var shiftId = getActiveShiftId(courierId);
    
    // Якщо зміни немає — не обробляємо візити, але можна оновити локацію кур'єра
    if (!shiftId) {
      Logger.log("No active shift for courier: " + courierId);
      return;
    }
    
    // 1. ОНОВЛЮЄМО СТАТУС ТА КООРДИНАТИ КУР'ЄРА НА ДАШБОРДІ
    updateCourierStatus_TG(courierId, courierName, lat, lng, accuracy, null, "active");
    
    // 2. ЛОГУЄМО ПЕРІОДИЧНИЙ HEARTBEAT В EventLog
    logEvent_TG(courierId, shiftId, "heartbeat", "Periodic location heartbeat", {
      latitude: lat,
      longitude: lng,
      accuracy_m: accuracy,
      source: "telegram_live"
    });
    
    // 3. Отримуємо список активних гео-точок
    var cache = CacheService.getScriptCache();
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
    
    // 4. Пошук найближчої точки
    var closestLoc = null;
    var minDistance = Infinity;
    
    for (var i = 0; i < locations.length; i++) {
      var d = getDistanceInMeters(lat, lng, locations[i].latitude, locations[i].longitude);
      if (d < minDistance) {
        minDistance = d;
        closestLoc = locations[i];
      }
    }
    
    // 5. Детекція візитів (State Machine)
    var stateStr = cache.get("state_TG_" + courierId);
    var state = null;
    if (stateStr) {
      try {
        state = JSON.parse(stateStr);
      } catch(e) {}
    }
    
    var DWELL_TIME_SEC = 60; // 60 секунд для зарахування візиту
    var EXIT_THRESHOLD = 3;  // 3 виміри поза зоною для фіксації виходу
    
    if (closestLoc && minDistance <= closestLoc.radius_m) {
      // МИ В ЗОНІ ТОЧКИ
      if (!state) {
        // Новий кандидат у візити
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
        
        logEvent_TG(courierId, shiftId, "diagnostic", "Location candidate: " + closestLoc.name + " (" + closestLoc.location_id + "), distance: " + minDistance + "m", {
          location_id: closestLoc.location_id,
          distance_m: minDistance
        });
      } else {
        if (state.location_id === closestLoc.location_id) {
          state.last_seen = timestamp;
          state.outside_count = 0;
          
          // Перехід Кандидат -> Підтверджений візит (перебування > 60 сек)
          if (state.status === "candidate" && (timestamp - state.enter_time) >= DWELL_TIME_SEC) {
            state.status = "inside";
            
            logEvent_TG(courierId, shiftId, "visit_detected", "Visit confirmed: " + closestLoc.name + " (" + closestLoc.location_id + ") after " + (timestamp - state.enter_time) + "s", {
              location_id: closestLoc.location_id,
              dwell_seconds: (timestamp - state.enter_time)
            });
            
            sendTelegramRequest("sendMessage", {
              "chat_id": chatId, 
              "text": "📍 Візит на точку «" + closestLoc.name + "» розпочато."
            });
          }
        } else {
          // Кур'єр перемістився на іншу локацію
          if (state.status === "inside") {
            recordVisit(courierId, shiftId, state, timestamp, lat, lng);
            logEvent_TG(courierId, shiftId, "visit_completed", "Visit completed: " + state.location_name, {
              location_id: state.location_id
            });
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
          
          logEvent_TG(courierId, shiftId, "diagnostic", "Location candidate: " + closestLoc.name + " (" + closestLoc.location_id + "), distance: " + minDistance + "m", {
            location_id: closestLoc.location_id,
            distance_m: minDistance
          });
        }
      }
      
      try {
        cache.put("state_TG_" + courierId, JSON.stringify(state), 21600);
      } catch(e) {}
      
    } else {
      // МИ ПОЗА ЗОНОЮ ТОЧОК
      if (state) {
        state.outside_count = (state.outside_count || 0) + 1;
        
        if (state.outside_count >= EXIT_THRESHOLD) {
          if (state.status === "inside") {
            var exitTime = state.last_seen;
            recordVisit(courierId, shiftId, state, exitTime, lat, lng);
            
            logEvent_TG(courierId, shiftId, "visit_completed", "Visit completed: " + (state.location_name || state.location_id), {
              location_id: state.location_id
            });
            
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
    
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 6).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    sheet.getRange(lastRow, 7).setNumberFormat("dd.MM.yyyy HH:mm:ss");
    sheet.getRange(lastRow, 17).setNumberFormat("dd.MM.yyyy HH:mm:ss");
  } catch (e) {
    Logger.log("recordVisit error: " + e.toString());
  }
}
