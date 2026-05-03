const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const regex = /async function normalizeItemsLocally[\s\S]*?return finalItems;\n}/m;

const newLocalFunc = `const prepWords = [
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

    // 1. Extract embedded quantities like (4), (1/2 stick), (5 ounces each)
    let qtyFromParen = 0;
    let unitFromParen = '';

    // Look for (number unit) or (about number) or (number ounces each)
    const parenMatches = [...s.matchAll(/\\(([\\d\\s./]+)\\s*([a-zA-Z]*)[^)]*\\)/g)];
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
        const hyphenMatch = s.match(/-\\s*(about\\s+)?([\\d\\s./]+)\\s*([a-zA-Z]*)/);
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
    s = s.replace(/\\([^)]*\\)/g, ' ').replace(/[*-]/g, ' ');

    // 3. Extract leading numbers
    let quantity = qtyFromParen;
    const qtyRegex = /^([\\d\\s./]+)\\s*/;
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
    let words = s.split(/[\\s,]+/);

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
        // Strip non-alpha
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

    if (name.includes('apple cider')) name = 'apple cider';
    if (name.includes('chicken breast')) name = 'chicken breast';
    if (name.includes('ground beef')) name = 'ground beef';
    if (name.includes('olive oil')) name = 'olive oil';

    return { name: name || raw, quantity, unit };
}

async function normalizeItemsLocally(rawItems) {
  if (rawItems.length === 0) {
    return [];
  }

  console.log(\`Parsing \${rawItems.length} items locally with custom NLP...\`);

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
                 existing.extraText = existing.extraText ? existing.extraText + \` + \${quantity} \${unit}\` : \`\${quantity} \${unit}\`;
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
          finalQuantityStr = \`\${val.quantity}\${val.unit ? ' ' + val.unit : ''}\`;
      }
      if (val.extraText) {
          finalQuantityStr += finalQuantityStr ? \` + \${val.extraText}\` : val.extraText;
      }

      // If still empty but it's garlic, default to at least 1 clove if multiple un-quantified were found.
      // But usually it's better to just leave it blank if no quantity was ever specified.

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
