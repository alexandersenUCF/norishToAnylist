const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const regex = /function extractIngredient\(raw\) \{[\s\S]*?return \{ name: name \|\| raw, quantity, unit \};\n}/m;

const newParser = `function extractIngredient(raw) {
    let s = raw.toLowerCase().trim();

    // Protect "half and half" / "half & half"
    const isHalfAndHalf = s.includes('half & half') || s.includes('half and half');
    if (isHalfAndHalf) {
        s = s.replace(/half \\& half/g, 'halfandhalf').replace(/half and half/g, 'halfandhalf');
    }

    // Protect percentages (e.g. 90%)
    const pctMatch = s.match(/([\\d.]+)\\s*%/);
    let pctStr = '';
    if (pctMatch) {
        pctStr = pctMatch[0];
        s = s.replace(pctMatch[0], 'PCTHOLDER');
    }

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

    // Strip everything after a comma (preparation instructions)
    if (s.includes(',')) {
        s = s.split(',')[0];
    }

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
}`;

code = code.replace(regex, newParser);
fs.writeFileSync('index.js', code);
