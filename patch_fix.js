const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const regex = /async function normalizeItemsWithGemini[\s\S]*?catch \(error\) \{\n    console\.error\('Error normalizing with Gemini:', error\);\n    throw error;\n  }\n}/m;

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

code = code.replace(regex, newLocalFunc);
fs.writeFileSync('index.js', code);
