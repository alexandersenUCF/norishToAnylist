require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const AnyList = require('anylist');
const cron = require('node-cron');
const path = require('path');

// Check required environment variables
const REQUIRED_ENV_VARS = [
  'ANYLIST_EMAIL',
  'ANYLIST_PASSWORD',
  'NORISH_API_URL',
  'NORISH_API_KEY',
  'GEMINI_API_KEY'
];

for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function fetchNorishList() {
  try {
    console.log(`Fetching shopping list from Norish (${process.env.NORISH_API_URL})...`);
    const response = await axios.get(process.env.NORISH_API_URL, {
      headers: {
        'Authorization': `Bearer ${process.env.NORISH_API_KEY}`,
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

async function normalizeItemsWithGemini(rawItems) {
  if (rawItems.length === 0) {
    return [];
  }

  console.log('Sending items to Gemini for normalization...');
  const prompt = `
    I have a list of raw ingredient strings from a recipe app.
    Please normalize these strings into a clean JSON array of objects.
    Each object should have a "name" (the ingredient name) and an optional "quantity" (if specified).
    For example: "a pinch of kosher salt" -> { "name": "kosher salt", "quantity": "a pinch" }
    or "3 large peeled carrots" -> { "name": "carrots", "quantity": "3 large" }

    Here is the list:
    ${JSON.stringify(rawItems, null, 2)}
  `;

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
        }
    });

    const jsonString = response.text;
    const parsedItems = JSON.parse(jsonString);
    console.log(`Successfully normalized ${parsedItems.length} items using Gemini.`);
    return parsedItems;
  } catch (error) {
    console.error('Error normalizing with Gemini:', error);
    throw error;
  }
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
    const currentItemNames = currentItems.map(item => item.name.toLowerCase());

    let addedCount = 0;

    for (const item of normalizedItems) {
      if (!item.name) continue;

      const ingredientName = item.name;
      if (currentItemNames.includes(ingredientName.toLowerCase())) {
        console.log(`Skipping existing item: ${ingredientName}`);
        continue;
      }

      let finalName = ingredientName;
      let details = item.quantity ? `Quantity: ${item.quantity}` : '';

      const newItem = anylist.createItem({
        name: finalName,
        details: details
      });

      console.log(`Adding item: ${finalName} ${details ? `(${details})` : ''}`);
      await targetList.addItem(newItem);
      addedCount++;
    }

    console.log(`Successfully added ${addedCount} new items to AnyList.`);

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
      const normalizedItems = await normalizeItemsWithGemini(rawItems);
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
