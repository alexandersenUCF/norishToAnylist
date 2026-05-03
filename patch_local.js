const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// Remove Gemini init
const oldInit = `// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });`;
code = code.replace(oldInit, `const { parseIngredient } = require('parse-ingredient');`);

// Refactor normalizeItemsWithGemini
const oldGeminiFunc = `async function processGeminiChunk(chunk) {
  const prompt = \`
    I have a list of raw ingredient strings from a recipe app.
    Please normalize these strings into a clean JSON array of objects.

    CRITICAL INSTRUCTIONS:
    1. You must combine duplicate ingredients. If "garlic" appears multiple times (e.g. "3 cloves garlic", "1 clove garlic"), you must combine them into a single object with the total summed quantity: { "name": "garlic", "quantity": "4 cloves" }.
    2. Do the math to combine quantities if they share the same unit (e.g., 2 cups + 1 cup = 3 cups). If the units are completely different and cannot be summed safely, list them together (e.g. "1 tbsp + 2 cups").
    3. The "name" should be the base ingredient (e.g., "apple cider", "garlic", "kosher salt").
    4. The "quantity" should be a string representing the total amount needed (e.g., "5 cloves", "1/2 cup", "1 gallon"). If no quantity is specified, omit the quantity field or leave it blank.

    Here is the list of raw ingredients to process:
    \${JSON.stringify(chunk, null, 2)}
  \`;

  const url = \`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\${process.env.GEMINI_API_KEY}\`;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 180000
  });

  const jsonString = response.data.candidates[0].content.parts[0].text;
  return JSON.parse(jsonString);
}

async function normalizeItemsWithGemini(rawItems) {
  if (rawItems.length === 0) {
    return [];
  }

  console.log(\`Sending \${rawItems.length} items to Gemini for normalization...\`);

  // Batch requests into chunks of 25 to prevent 60-second firewall timeouts
  const CHUNK_SIZE = 25;
  let allParsedItems = [];

  for (let i = 0; i < rawItems.length; i += CHUNK_SIZE) {
      const chunk = rawItems.slice(i, i + CHUNK_SIZE);
      console.log(\`Processing chunk \${(i/CHUNK_SIZE) + 1} of \${Math.ceil(rawItems.length / CHUNK_SIZE)} (\${chunk.length} items)...\`);
      try {
          const parsedChunk = await processGeminiChunk(chunk);
          allParsedItems = allParsedItems.concat(parsedChunk);
      } catch (error) {
          console.error(\`Error processing chunk \${(i/CHUNK_SIZE) + 1}:\`, error.message);
          throw error; // Fail the sync if a chunk fails
      }
  }

  // Now we need to do a final pass to combine duplicates that might have spanned across different chunks
  if (allParsedItems.length > 0 && rawItems.length > CHUNK_SIZE) {
      console.log('Performing final cross-chunk deduplication pass...');
      allParsedItems = await processGeminiChunk(allParsedItems);
  }

  console.log(\`Successfully normalized into \${allParsedItems.length} combined items.\`);
  return allParsedItems;
}`;

const newLocalFunc = `async function normalizeItemsLocally(rawItems) {
  if (rawItems.length === 0) {
    return [];
  }

  console.log(\`Parsing \${rawItems.length} items locally...\`);

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
      description = description.replace(/^-\\s*/, '').replace(/\\*$/, '').trim();

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
                 existing.extraText = existing.extraText ? existing.extraText + \` + \${quantity} \${unit}\` : \`\${quantity} \${unit}\`;
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
          finalQuantityStr = \`\${val.quantity}\${val.unit ? ' ' + val.unit : ''}\`;
      }
      if (val.extraText) {
          finalQuantityStr += finalQuantityStr ? \` + \${val.extraText}\` : val.extraText;
      }

      finalItems.push({
          name: val.name,
          quantity: finalQuantityStr.trim()
      });
  }

  console.log(\`Successfully aggregated into \${finalItems.length} unique items.\`);
  return finalItems;
}`;

code = code.replace(oldGeminiFunc, newLocalFunc);

// Update caller
const oldCaller = `const normalizedItems = await normalizeItemsWithGemini(rawItems);`;
const newCaller = `const normalizedItems = await normalizeItemsLocally(rawItems);`;
code = code.replace(oldCaller, newCaller);

// Remove GEMINI from REQUIRED_ENV
const oldEnv = `  'ANYLIST_PASSWORD',
  'NORISH_API_URL',
  'NORISH_API_KEY',
  'GEMINI_API_KEY'
];`;
const newEnv = `  'ANYLIST_PASSWORD',
  'NORISH_API_URL',
  'NORISH_API_KEY'
];`;
code = code.replace(oldEnv, newEnv);

// Remove the import line
code = code.replace(`const { GoogleGenAI } = require('@google/genai');`, `// Removed GoogleGenAI`);

fs.writeFileSync('index.js', code);
