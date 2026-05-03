const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldGeminiFunc = `async function normalizeItemsWithGemini(rawItems) {
  if (rawItems.length === 0) {
    return [];
  }

  console.log('Sending items to Gemini for normalization...');
  const prompt = \`
    I have a list of raw ingredient strings from a recipe app.
    Please normalize these strings into a clean JSON array of objects.

    CRITICAL INSTRUCTIONS:
    1. You must combine duplicate ingredients. If "garlic" appears multiple times (e.g. "3 cloves garlic", "1 clove garlic"), you must combine them into a single object with the total summed quantity: { "name": "garlic", "quantity": "4 cloves" }.
    2. Do the math to combine quantities if they share the same unit (e.g., 2 cups + 1 cup = 3 cups). If the units are completely different and cannot be summed safely, list them together (e.g. "1 tbsp + 2 cups").
    3. The "name" should be the base ingredient (e.g., "apple cider", "garlic", "kosher salt").
    4. The "quantity" should be a string representing the total amount needed (e.g., "5 cloves", "1/2 cup", "1 gallon"). If no quantity is specified, omit the quantity field or leave it blank.

    Here is the list of raw ingredients to process:
    \${JSON.stringify(rawItems, null, 2)}
  \`;

  try {
    // Create an HTTPS agent with keep-alive to prevent firewalls/NATs
    // from dropping the connection during long AI processing times.
    const httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 10000,
        timeout: 180000 // 3 minutes
    });

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
        timeout: 180000, // 3 minutes overall request timeout
        httpsAgent: httpsAgent
    });

    const jsonString = response.data.candidates[0].content.parts[0].text;
    const parsedItems = JSON.parse(jsonString);
    console.log(\`Successfully normalized \${parsedItems.length} items using Gemini.\`);
    return parsedItems;
  } catch (error) {
    console.error('Error normalizing with Gemini:', error);
    throw error;
  }
}`;

const newGeminiFunc = `async function processGeminiChunk(chunk) {
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

code = code.replace(oldGeminiFunc, newGeminiFunc);
fs.writeFileSync('index.js', code);
