const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldExtract = `function extractIngredient(raw) {
    let s = raw.toLowerCase().trim();`;

const newExtract = `function extractIngredient(raw) {
    let s = raw.toLowerCase().trim();
    // Normalize "2x apples" to "2 apples"
    s = s.replace(/(\\d+)x\\s/i, '$1 ');`;

code = code.replace(oldExtract, newExtract);
fs.writeFileSync('index.js', code);
