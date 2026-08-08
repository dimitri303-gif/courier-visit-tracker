# Courier Visit Tracker - Workspace Guidelines

## Geocoding and Adding New Locations
When the user asks to add new locations to the database using plain-text addresses (e.g., "Вінниця: вул. Пирогова 73а, Дачна 8"), follow this workflow:

1. **Find Coordinates:** Use the `search_web` tool to lookup the exact latitude and longitude coordinates for each requested address in the specified city/region.
2. **Generate Script:** Create a Google Apps Script function that:
   * Maps each new location to a new unique ID (e.g., `L008`, `L009`, etc. by checking the sheet's next rows).
   * Appends these rows to the `Locations` sheet (with `name`, `address`, `latitude`, `longitude`, `radius_m` = 30, `indoor` = false, `active` = true, `region`).
   * Automatically increments the `points_version` value in the `Settings` sheet by +1 to trigger an automatic update on all couriers' mobile devices.
3. **Instruct User:** Provide the complete Google Apps Script code to the user and explain how to add it and run it inside the Google Sheets Apps Script editor.
