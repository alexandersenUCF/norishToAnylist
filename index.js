require('dotenv').config();
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const AnyList = require('anylist');
const cron = require('node-cron');

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
    // NOTE: This assumes Norish exposes an endpoint to get the shopping list.
    // Replace with the exact API call for your Norish instance or Postgres logic.
    const response = await axios.get(process.env.NORISH_API_URL, {
      headers: {
        'Authorization': `Bearer ${process.env.NORISH_API_KEY}`,
      }
    });

    // Norish returns the list, let's extract raw ingredient strings.
    // Example format needs adjusting based on the real API response:
    // response.data could be something like: [{ id: 1, text: "a pinch of kosher salt" }, ...]
    // We assume an array of items with a 'text' or similar property. Adjust as needed.

    let rawItems = [];
    if (Array.isArray(response.data)) {
        rawItems = response.data.map(item => typeof item === 'string' ? item : (item.text || item.name || item.ingredient || JSON.stringify(item)));
    } else if (response.data && Array.isArray(response.data.items)) {
        rawItems = response.data.items.map(item => typeof item === 'string' ? item : (item.text || item.name || item.ingredient || JSON.stringify(item)));
    } else {
        throw new Error(`Unexpected Norish API response format: ${JSON.stringify(response.data)}`);
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

    // Default to the first list if "Grocery" isn't found, or find by name.
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
      // Simple exact deduplication (can be improved with fuzzy matching if needed)
      if (currentItemNames.includes(ingredientName.toLowerCase())) {
        console.log(`Skipping existing item: ${ingredientName}`);
        continue;
      }

      // Format name to include quantity if it exists for AnyList
      // AnyList doesn't natively handle "quantities" the same way, usually it's combined in the name or details.
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

  } catch (error) {
    console.error('Error syncing with AnyList:', error);
    anylist.teardown();
    throw error;
  }
}

async function runSync() {
  console.log(`--- Starting sync at ${new Date().toISOString()} ---`);
  try {
    const rawItems = await fetchNorishList();
    if (rawItems.length > 0) {
      const normalizedItems = await normalizeItemsWithGemini(rawItems);
      await syncWithAnyList(normalizedItems);
    } else {
      console.log('No items found in Norish list. Skipping sync.');
    }
  } catch (error) {
    console.error('Sync failed:', error);
  } finally {
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
