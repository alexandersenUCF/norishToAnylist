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

const prepWords = [
    'minced', 'chopped', 'diced', 'sliced', 'peeled', 'grated', 'finely', 'freshly', 'ground',
    'crushed', 'beaten', 'melted', 'divided', 'to taste', 'optional', 'fresh', 'dried',
    'large', 'small', 'medium', 'skinless', 'boneless', 'low-sodium', 'unsalted', 'salted',
    'extra-virgin', 'lean', 'mixed', 'frozen', 'inch-thick', 'bone-in', 'grated', 'about', 'some'
];

const units = [
    'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
    'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams',
    'kg', 'ml', 'l', 'clove', 'cloves', 'pinch', 'dash', 'sprig', 'sprigs', 'stick', 'sticks',
    'can', 'cans', 'head', 'heads', 'bunch', 'bunches', 'piece', 'pieces', 'wedge', 'wedges', 'package'
];

function parseNum(numStr) {
    let q = 0;
    const parts = numStr.split(' ').filter(p => p.trim() !== '');
    for (const p of parts) {
        if (p.includes('/')) {
            const [n, d] = p.split('/');
            if (n && d && parseInt(d) !== 0) {
                q += parseInt(n) / parseInt(d);
            }
        } else {
            q += parseFloat(p);
        }
    }
    return isNaN(q) ? 0 : q;
}

function extractIngredient(raw) {
    let s = raw.toLowerCase().trim();
    // Normalize "2x apples" to "2 apples"
    s = s.replace(/(\d+)x\s/i, '$1 ');

    // Protect "half and half" / "half & half"
    const isHalfAndHalf = s.includes('half & half') || s.includes('half and half');
    if (isHalfAndHalf) {
        s = s.replace(/half \& half/g, 'halfandhalf').replace(/half and half/g, 'halfandhalf');
    }

    // Protect percentages (e.g. 90%)
    const pctMatch = s.match(/([\d.]+)\s*%/);
    let pctStr = '';
    if (pctMatch) {
        pctStr = pctMatch[0];
        s = s.replace(pctMatch[0], 'PCTHOLDER');
    }

    // 1. Extract embedded quantities like (4), (1/2 stick), (5 ounces each)
    let qtyFromParen = 0;
    let unitFromParen = '';

    // Look for (number unit) or (about number) or (number ounces each)
    const parenMatches = [...s.matchAll(/\(([\d\s./]+)\s*([a-zA-Z]*)[^)]*\)/g)];
    for (const match of parenMatches) {
        const numStr = match[1].trim();
        const possibleUnit = match[2].trim();

        let q = parseNum(numStr);
        if (q > 0) {
            qtyFromParen = q;
            if (units.includes(possibleUnit) || units.includes(possibleUnit + 's')) {
                unitFromParen = possibleUnit;
            } else if (s.includes('stick') && match[0].includes('stick')) {
                unitFromParen = 'stick';
            } else if (s.includes('ounce') && match[0].includes('ounce')) {
                unitFromParen = 'ounce';
            }
            break; // Stop at first valid quantity in parens
        }
    }

    // 2. Look for explicit hyphen quantities like "-1 stick" or "- 2 large"
    if (qtyFromParen === 0) {
        const hyphenMatch = s.match(/-\s*(about\s+)?([\d\s./]+)\s*([a-zA-Z]*)/);
        if (hyphenMatch) {
            let q = parseNum(hyphenMatch[2].trim());
            if (q > 0) {
                qtyFromParen = q;
                const pu = hyphenMatch[3].trim();
                if (units.includes(pu) || units.includes(pu + 's')) unitFromParen = pu;
                if (!unitFromParen && s.includes('stick')) unitFromParen = 'stick';
            }
        }
    }

    // Strip all parentheses and their contents, asterisks, hyphens
    s = s.replace(/\([^)]*\)/g, ' ').replace(/[*-]/g, ' ');

    // Strip everything after a comma (preparation instructions)
    if (s.includes(',')) {
        s = s.split(',')[0];
    }

    // 3. Extract leading numbers
    let quantity = qtyFromParen;
    const qtyRegex = /^([\d\s./]+)\s*/;
    const match = s.match(qtyRegex);
    if (match) {
        let numStr = match[1].trim();
        s = s.replace(qtyRegex, '').trim();
        quantity += parseNum(numStr);
    }

    // Try to catch word numbers if still 0
    if (quantity === 0) {
        const numWords = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'half': 0.5, 'quarter': 0.25};
        for (const [w, n] of Object.entries(numWords)) {
            if (s.startsWith(w + ' ')) {
                quantity = n;
                s = s.replace(w + ' ', '');
                break;
            }
        }
    }

    let unit = unitFromParen;
    let words = s.split(/[\s,]+/);

    // Extract leading unit if we don't have one
    if (!unit && words.length > 0) {
        if (units.includes(words[0])) {
            unit = words[0];
            words.shift();
        } else if (words.length > 1 && units.includes(words[1]) && words[0] === 'of') {
            unit = words[1];
            words.shift(); words.shift();
        }
    }

    // Normalize unit
    if (unit) {
        if (unit.endsWith('s') && unit !== 'lbs' && unit !== 'ounces') unit = unit.slice(0, -1);
        if (unit === 'tbsp' || unit === 'tablespoons') unit = 'tablespoon';
        if (unit === 'tsp' || unit === 'teaspoons') unit = 'teaspoon';
        if (unit === 'oz' || unit === 'ounces') unit = 'ounce';
        if (unit === 'lbs') unit = 'pound';
    }

    // Remove prep words to get the base ingredient name
    let finalWords = [];
    for (let w of words) {
        // Strip non-alpha, EXCEPT if it's the pct placeholder
        if (w === 'pctholder') {
            finalWords.push(pctStr);
            continue;
        }
        if (w === 'halfandhalf') {
            finalWords.push('half & half');
            continue;
        }

        let cleanW = w.replace(/[^a-z]/g, '');
        if (!prepWords.includes(cleanW) && cleanW !== '' && cleanW !== 'of' && cleanW !== 'or') {
            finalWords.push(cleanW);
        }
    }

    let name = finalWords.join(' ').trim();

    // Edge case fixes based on user feedback
    if (name.includes('garlic clove') || name.includes('cloves garlic') || name === 'garlic' || name === 'garlics') {
        name = 'garlic';
        if (!unit) unit = 'clove'; // Garlic defaults to cloves
    }

    if (name.includes('apple cider')) {
        name = 'apple cider';
        if (quantity === 0) quantity = 1; // Apple cider usually comes in 1 unit if not specified
    }
    if (name.includes('chicken breast')) {
        name = 'chicken breast';
        if (quantity === 0 && qtyFromParen > 0) quantity = qtyFromParen;
        if (quantity === 0) quantity = 1; // Default to at least 1
    }
    if (name.includes('ground beef') || name.includes('beef')) {
        name = 'ground beef';
        if (quantity === 0) quantity = 1;
        if (!unit) unit = 'pound';
    }
    if (name.includes('olive oil')) name = 'olive oil';
    if (name.includes('peas') && name.includes('carrots')) name = 'peas and carrots';
    if (name.includes('pork loin')) {
        name = 'pork loin chops';
    }
    if (name.includes('chicken thigh')) {
        name = 'chicken thighs';
    }

    // If an item has NO quantity, default it to 1 so AnyList shows "1" instead of nothing.
    if (quantity === 0) {
        quantity = 1;
    }

    return { name: name || raw, quantity, unit };
}

async function normalizeItemsLocally(rawItems) {
  if (rawItems.length === 0) {
    return [];
  }

  console.log(`Parsing ${rawItems.length} items locally with custom NLP...`);

  const ingredientMap = new Map();

  for (const raw of rawItems) {
      if (!raw || typeof raw !== 'string') continue;

      const parsed = extractIngredient(raw);

      const description = parsed.name;
      const quantity = parsed.quantity;
      const unit = parsed.unit;

      if (ingredientMap.has(description)) {
          const existing = ingredientMap.get(description);

          if (quantity > 0) {
              if (existing.unit === unit || (!existing.unit && !unit)) {
                 existing.quantity += quantity;
                 if (!existing.unit && unit) existing.unit = unit;
              } else {
                 existing.extraText = existing.extraText ? existing.extraText + ` + ${quantity} ${unit}` : `${quantity} ${unit}`;
              }
          } else if (quantity === 0 && existing.quantity === 0 && unit) {
             existing.unit = unit; // Inherit unit if both are 0 but one has a unit
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

      // If still empty but it's garlic, default to at least 1 clove if multiple un-quantified were found.
      // But usually it's better to just leave it blank if no quantity was ever specified.

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
