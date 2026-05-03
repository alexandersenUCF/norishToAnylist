require('dotenv').config();
const express = require('express');
const axios = require('axios');
// Removed GoogleGenAI
const AnyList = require('anylist');
const cron = require('node-cron');
const path = require('path');
const https = require('https');

// Check required environment variables
const REQUIRED_ENV_VARS = [
  'ANYLIST_EMAIL',
  'ANYLIST_PASSWORD',
  'NORISH_API_URL',
  'NORISH_API_KEY'
];

for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const { parseIngredient } = require('parse-ingredient');

async function fetchNorishList() {
  try {
    console.log(`Fetching shopping list from Norish (${process.env.NORISH_API_URL})...`);
    const response = await axios.get(process.env.NORISH_API_URL, {
      headers: {
        'Authorization': `Bearer ${process.env.NORISH_API_KEY}`,
        'x-api-key': process.env.NORISH_API_KEY,
      }
    });

    let rawItems = [];
    if (Array.isArray(response.data)) {
        rawItems = response.data.map(item => typeof item === 'string' ? item : (item.text || item.name || item.ingredient || JSON.stringify(item)));
    } else if (response.data && Array.isArray(response.data.items)) {
        rawItems = response.data.items.map(item => typeof item === 'string' ? item : (item.text || item.name || item.ingredient || JSON.stringify(item)));
    } else {
        let debugData = response.data;
        if (typeof debugData === 'string' && debugData.includes('<html')) {
             throw new Error('Received HTML response instead of JSON. Ensure your NORISH_API_URL points to the API endpoint (e.g., http://your-domain/api/v1/groceries) and not the web frontend, and that your API key is correct.');
        }
        if (typeof debugData === 'object') {
           debugData = JSON.stringify(debugData).substring(0, 500);
        } else if (typeof debugData === 'string') {
           debugData = debugData.substring(0, 500);
        }
        throw new Error(`Unexpected Norish API response format. First 500 chars: ${debugData}`);
    }

    console.log(`Found ${rawItems.length} raw items from Norish.`);
    return rawItems;
  } catch (error) {
    console.error('Error fetching from Norish:', error.message);
    throw error;
  }
}

async function normalizeItemsLocally(rawItems) {
  if (rawItems.length === 0) {
    return [];
  }

  console.log(`Parsing ${rawItems.length} items locally...`);

  const ingredientMap = new Map();

  for (const raw of rawItems) {
      if (!raw || typeof raw !== 'string') continue;

      let parsed;
      try {
          const result = parseIngredient(raw);
          if (result && result.length > 0) {
              parsed = result[0];
          }
      } catch (e) {
          // If the parser fails, we fall back to using the raw string as the description.
      }

      let description = parsed && parsed.description ? parsed.description.toLowerCase().trim() : raw.toLowerCase().trim();
      let quantity = parsed && parsed.quantity ? parseFloat(parsed.quantity) : 0;
      let unit = parsed && parsed.unitOfMeasure ? parsed.unitOfMeasure.toLowerCase().trim() : '';

      // Cleanup common artifacts
      description = description.replace(/^-\s*/, '').replace(/\*$/, '').trim();

      // Special logic: The parser sometimes leaves things like "garlic cloves" vs "cloves garlic".
      // Let's do some basic normalization for "garlic" and "cloves"
      if (description.includes('garlic clove') || description.includes('clove of garlic') || description.includes('cloves garlic') || description === 'garlic cloves (-minced)' || description === 'garlic cloves, minced') {
          description = 'garlic';
          if (!unit) unit = 'cloves';
      }

      if (ingredientMap.has(description)) {
          const existing = ingredientMap.get(description);

          if (quantity > 0) {
              // Try to sum if the units match or if neither has a unit
              if (existing.unit === unit || (!existing.unit && !unit)) {
                 existing.quantity += quantity;
                 // Inherit unit if existing had none
                 if (!existing.unit && unit) existing.unit = unit;
              } else {
                 // Different units, just append it as a text string instead of trying to convert volume to mass.
                 existing.extraText = existing.extraText ? existing.extraText + ` + ${quantity} ${unit}` : `${quantity} ${unit}`;
              }
          }
      } else {
          ingredientMap.set(description, {
              name: description,
              quantity: quantity,
              unit: unit,
              extraText: ''
          });
      }
  }

  const finalItems = [];
  for (const [key, val] of ingredientMap.entries()) {
      let finalQuantityStr = '';
      if (val.quantity > 0) {
          finalQuantityStr = `${val.quantity}${val.unit ? ' ' + val.unit : ''}`;
      }
      if (val.extraText) {
          finalQuantityStr += finalQuantityStr ? ` + ${val.extraText}` : val.extraText;
      }

      finalItems.push({
          name: val.name,
          quantity: finalQuantityStr.trim()
      });
  }

  console.log(`Successfully aggregated into ${finalItems.length} unique items.`);
  return finalItems;
}

async function syncWithAnyList(normalizedItems) {
  const anylist = new AnyList({
    email: process.env.ANYLIST_EMAIL,
    password: process.env.ANYLIST_PASSWORD
  });

  try {
    console.log('Logging into AnyList...');
    await anylist.login();

    console.log('Fetching AnyList data...');
    await anylist.getLists();

    const listName = process.env.ANYLIST_LIST_NAME || 'Grocery';
    let targetList = anylist.getListByName(listName);

    if (!targetList) {
        console.warn(`List "${listName}" not found. Trying "Grocery" or default...`);
        targetList = anylist.getListByName('Grocery');
        if (!targetList && anylist.lists.length > 0) {
            targetList = anylist.lists[0];
        } else if (!targetList) {
            throw new Error('No AnyList lists found!');
        }
    }

    console.log(`Syncing with AnyList list: "${targetList.name}"`);

    const currentItems = targetList.items || [];

    let addedCount = 0;
    let updatedCount = 0;

    for (const item of normalizedItems) {
      if (!item.name) continue;

      const ingredientName = item.name;
      const quantityStr = item.quantity ? String(item.quantity) : '';

      // Find if item already exists in the list (case-insensitive)
      const existingItem = currentItems.find(i => i.name.toLowerCase() === ingredientName.toLowerCase());

      if (existingItem) {
        let needsSave = false;

        // If it's checked off, uncheck it so it appears on the active list
        if (existingItem.checked) {
          existingItem.checked = false;
          needsSave = true;
        }

        // Update the quantity if it's different
        if (quantityStr && existingItem.quantity !== quantityStr) {
          existingItem.quantity = quantityStr;
          needsSave = true;
        }

        if (needsSave) {
          console.log(`Updating existing item: ${ingredientName} (Quantity: ${quantityStr})`);
          await existingItem.save();
          updatedCount++;
        } else {
          console.log(`Skipping existing unchanged item: ${ingredientName}`);
        }
        continue;
      }

      // Item does not exist, create it
      let newItem = anylist.createItem({ name: ingredientName });
      newItem = await targetList.addItem(newItem);

      // Set quantity if provided and save
      if (quantityStr) {
          newItem.quantity = quantityStr;
          await newItem.save();
      }

      console.log(`Adding new item: ${ingredientName} ${quantityStr ? `(Quantity: ${quantityStr})` : ''}`);
      addedCount++;
    }

    console.log(`Successfully added ${addedCount} new items and updated ${updatedCount} existing items.`);

    anylist.teardown();
    return addedCount;
  } catch (error) {
    console.error('Error syncing with AnyList:', error);
    anylist.teardown();
    throw error;
  }
}

let isSyncing = false;

async function runSync() {
  if (isSyncing) {
    console.log('Sync is already in progress, skipping duplicate request.');
    return { status: 'skipped', message: 'Sync is already running.' };
  }

  isSyncing = true;
  console.log(`--- Starting sync at ${new Date().toISOString()} ---`);

  try {
    const rawItems = await fetchNorishList();
    if (rawItems.length > 0) {
      const normalizedItems = await normalizeItemsLocally(rawItems);
      const addedCount = await syncWithAnyList(normalizedItems);
      return { status: 'success', message: `Successfully added ${addedCount} new items.` };
    } else {
      console.log('No items found in Norish list. Skipping sync.');
      return { status: 'success', message: 'No items found in Norish list.' };
    }
  } catch (error) {
    console.error('Sync failed:', error);
    return { status: 'error', error: error.message };
  } finally {
    isSyncing = false;
    console.log(`--- Sync finished at ${new Date().toISOString()} ---`);
  }
}

// Run once immediately on startup
runSync();

// Schedule for subsequent runs
const cronSchedule = process.env.CRON_SCHEDULE || '0 * * * *'; // Default to every hour
console.log(`Scheduling background sync with cron pattern: ${cronSchedule}`);
cron.schedule(cronSchedule, () => {
  runSync();
});

// Setup Express server for frontend trigger
const app = express();
const PORT = process.env.PORT || 3010;

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/sync', async (req, res) => {
  try {
    const result = await runSync();
    if (result.status === 'error') {
        res.status(500).json(result);
    } else {
        res.json(result);
    }
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Frontend and API listening on port ${PORT}`);
});
