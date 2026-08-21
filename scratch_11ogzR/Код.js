function copyRowsByDate() {
  // 1. Вказуємо таблицю-джерело (Планувальник)
  const sourceSs = SpreadsheetApp.openById("13-sur6ex47Ajl_NSAo0CLtKLpIp43UZFa9SCVY4vQA8");
  const sourceSheet = sourceSs.getSheetByName("Планувальник");

  // 2. Вказуємо таблицю-приймач (Campaigns)
  const targetSs = SpreadsheetApp.openById("1SL45-g22NcA04tyIaLIqqIQG4YVYo0evRGAbHAqU7r8");
  const targetSheet = targetSs.getSheetByName("Campaigns");

  // Перевірка наявності аркушів
  if (!sourceSheet || !targetSheet) {
    console.log("Помилка: Один з аркушів не знайдено. Перевірте назви.");
    return;
  }

  const data = sourceSheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Обнуляємо час для точного порівняння дати

  const rowsToCopy = [];
  const dateColumnIndex = 0; // 0 — це стовпець A

  for (let i = 1; i < data.length; i++) { // Пропускаємо заголовок
    let rowDate = new Date(data[i][dateColumnIndex]);
    
    if (rowDate instanceof Date && !isNaN(rowDate)) {
      rowDate.setHours(0, 0, 0, 0);
      
      if (rowDate.getTime() === today.getTime()) {
        rowsToCopy.push(data[i]);
      }
    }
  }

  if (rowsToCopy.length > 0) {
    // Додаємо дані в кінець таблиці Campaigns
    targetSheet.getRange(targetSheet.getLastRow() + 1, 1, rowsToCopy.length, rowsToCopy[0].length).setValues(rowsToCopy);
    console.log('Успішно скопійовано рядків: ' + rowsToCopy.length);
  } else {
    console.log('Сьогоднішніх дат у файлі Планувальник не знайдено.');
  }
}