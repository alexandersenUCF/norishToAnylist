const prepWords = [
    'minced', 'chopped', 'diced', 'sliced', 'peeled', 'grated', 'finely', 'freshly', 'ground',
    'crushed', 'beaten', 'melted', 'divided', 'to taste', 'optional', 'fresh', 'dried',
    'large', 'small', 'medium', 'skinless', 'boneless', 'low-sodium', 'unsalted', 'salted',
    'extra-virgin', 'lean', 'mixed', 'frozen', 'inch-thick', 'bone-in', 'grated'
];

const units = [
    'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
    'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams',
    'kg', 'ml', 'l', 'clove', 'cloves', 'pinch', 'dash', 'sprig', 'sprigs', 'stick', 'sticks',
    'can', 'cans', 'head', 'heads', 'bunch', 'bunches', 'piece', 'pieces', 'wedge', 'wedges'
];

function extractIngredient(raw) {
    let s = raw.toLowerCase().trim();

    // Attempt to extract quantity from parentheses first, e.g., "(1/2 stick) unsalted butter"
    let parenMatch = s.match(/\(([\d\s./]+)\s*([a-zA-Z]+)\)/);
    let qtyFromParen = 0;
    let unitFromParen = '';
    if (parenMatch) {
        let numStr = parenMatch[1].trim();
        unitFromParen = parenMatch[2].trim();
        if (units.includes(unitFromParen) || units.includes(unitFromParen + 's')) {
            s = s.replace(parenMatch[0], '');
            qtyFromParen = parseNum(numStr);
        }
    }

    // Remove all remaining parentheses
    s = s.replace(/\([^)]*\)/g, ' ');
    // Remove asterisks and hyphens
    s = s.replace(/[*-]/g, ' ');

    // Extract leading numbers
    let quantity = qtyFromParen;
    const qtyRegex = /^([\d\s./]+)\s*/;
    const match = s.match(qtyRegex);
    if (match) {
        let numStr = match[1].trim();
        s = s.replace(qtyRegex, '').trim();
        quantity += parseNum(numStr);
    }

    if (quantity === 0) {
        // Look for number words
        const numWords = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'half': 0.5, 'quarter': 0.25};
        for (const [w, n] of Object.entries(numWords)) {
            if (s.startsWith(w + ' ')) {
                quantity = n;
                s = s.replace(w + ' ', '');
                break;
            }
        }
    }

    // Default to 1 if no quantity but we have a unit later, or if we just want to count it.
    // Actually, leave as 0 if not specified, AnyList will just show no quantity.

    let unit = unitFromParen;
    const words = s.split(/[\s,]+/); // split by space or comma

    if (!unit && words.length > 0 && units.includes(words[0])) {
        unit = words[0];
        words.shift();
    }

    // Normalize unit
    if (unit) {
        if (unit.endsWith('s') && unit !== 'lbs' && unit !== 'ounces') unit = unit.slice(0, -1);
        if (unit === 'tbsp' || unit === 'tablespoons') unit = 'tablespoon';
        if (unit === 'tsp' || unit === 'teaspoons') unit = 'teaspoon';
        if (unit === 'oz' || unit === 'ounces') unit = 'ounce';
        if (unit === 'lbs') unit = 'pound';
    }

    // Remove prep words
    let finalWords = [];
    for (let w of words) {
        if (!prepWords.includes(w) && w !== '') {
            finalWords.push(w);
        }
    }

    let name = finalWords.join(' ').trim();

    // Edge case fixes
    if (name === 'garlic cloves' || name === 'cloves garlic') {
        name = 'garlic';
        if (!unit) unit = 'clove';
    }

    return { name: name || raw, quantity, unit };
}

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
    return q;
}

const testCases = [
  "skinless, boneless chicken breasts (about 4)",
  "Kosher salt",
  "(1/2 stick) unsalted butter",
  "garlic, finely chopped",
  "thyme sprigs",
  "90% lean ground beef (-or ground lamb)",
  "garlic cloves (-minced)",
  "frozen mixed peas & carrots*",
  "russet potatoes (-about 2 large potatoes peeled and cut into 1 inch cubes)",
  "unsalted butter (-1 stick)",
  "garlic",
  "-inch-thick boneless pork loin chops (5 ounces each)",
  "red onion, cut into 1/2-inch wedges",
  "extra-virgin olive oil, divided",
  "cloves garlic, minced",
  "minced garlic"
];

testCases.forEach(tc => {
    console.log(tc);
    console.log("   =>", extractIngredient(tc));
});
