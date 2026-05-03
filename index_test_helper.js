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

const testCases = [
  "skinless, boneless chicken breasts (about 4)",
  "(1/2 stick) unsalted butter",
  "russet potatoes (-about 2 large potatoes peeled and cut into 1 inch cubes)",
  "3 cloves garlic",
  "garlic cloves (-minced)",
  "salt, divided",
  "1 tbsp olive oil",
  "minced garlic",
  "garlic, chopped",
  "garlic",
  "apple cider"
];

testCases.forEach(tc => {
    console.log(tc);
    console.log("   =>", extractIngredient(tc));
});
