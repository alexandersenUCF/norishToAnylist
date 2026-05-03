const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldFix = `    if (name.includes('apple cider')) name = 'apple cider';
    if (name.includes('chicken breast')) name = 'chicken breast';
    if (name.includes('ground beef')) name = 'ground beef';
    if (name.includes('olive oil')) name = 'olive oil';`;

const newFix = `    if (name.includes('apple cider')) {
        name = 'apple cider';
        if (quantity === 0) quantity = 1; // Apple cider usually comes in 1 unit if not specified
    }
    if (name.includes('chicken breast')) {
        name = 'chicken breast';
        if (quantity === 0 && qtyFromParen > 0) quantity = qtyFromParen;
        if (quantity === 0) quantity = 1; // Default to at least 1
    }
    if (name.includes('ground beef')) {
        name = 'ground beef';
        if (quantity === 0) quantity = 1;
        if (!unit) unit = 'pound';
    }
    if (name.includes('olive oil')) name = 'olive oil';

    // If an item has NO quantity, default it to 1 so AnyList shows "1" instead of nothing.
    if (quantity === 0) {
        quantity = 1;
    }`;

code = code.replace(oldFix, newFix);
fs.writeFileSync('index.js', code);
