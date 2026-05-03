const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldPrompt = `  const prompt = \`
    I have a list of raw ingredient strings from a recipe app.
    Please normalize these strings into a clean JSON array of objects.
    Each object should have a "name" (the ingredient name) and an optional "quantity" (if specified).
    For example: "a pinch of kosher salt" -> { "name": "kosher salt", "quantity": "a pinch" }
    or "3 large peeled carrots" -> { "name": "carrots", "quantity": "3 large" }

    Here is the list:
    \${JSON.stringify(rawItems, null, 2)}
  \`;`;

const newPrompt = `  const prompt = \`
    I have a list of raw ingredient strings from a recipe app.
    Please normalize these strings into a clean JSON array of objects.

    CRITICAL INSTRUCTIONS:
    1. You must combine duplicate ingredients. If "garlic" appears multiple times (e.g. "3 cloves garlic", "1 clove garlic"), you must combine them into a single object with the total summed quantity: { "name": "garlic", "quantity": "4 cloves" }.
    2. Do the math to combine quantities if they share the same unit (e.g., 2 cups + 1 cup = 3 cups). If the units are completely different and cannot be summed safely, list them together (e.g. "1 tbsp + 2 cups").
    3. The "name" should be the base ingredient (e.g., "apple cider", "garlic", "kosher salt").
    4. The "quantity" should be a string representing the total amount needed (e.g., "5 cloves", "1/2 cup", "1 gallon"). If no quantity is specified, omit the quantity field or leave it blank.

    Here is the list of raw ingredients to process:
    \${JSON.stringify(rawItems, null, 2)}
  \`;`;

code = code.replace(oldPrompt, newPrompt);
fs.writeFileSync('index.js', code);
