import { db } from '../db/dexie.js';

export async function exportBackupData() {
  const data = {};
  for (const table of db.tables) {
    data[table.name] = await table.toArray();
  }
  return JSON.stringify(data, null, 2);
}

export async function importBackupData(jsonString) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON format');
  }

  const requiredTables = ['trips', 'exchanges', 'transactions', 'categories'];
  for (const table of requiredTables) {
    if (!data[table] || !Array.isArray(data[table])) {
      throw new Error(`Invalid backup file: Missing required table '${table}'`);
    }
  }

  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      if (data[table.name]) {
        await table.clear();
        await table.bulkAdd(data[table.name]);
      }
    }
  });
}
