const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// Update fetchNorishList with better logging and error handling
const oldFetch = `    let rawItems = [];
    if (Array.isArray(response.data)) {
        rawItems = response.data.map(item => typeof item === 'string' ? item : (item.text || item.name || item.ingredient || JSON.stringify(item)));
    } else if (response.data && Array.isArray(response.data.items)) {
        rawItems = response.data.items.map(item => typeof item === 'string' ? item : (item.text || item.name || item.ingredient || JSON.stringify(item)));
    } else {
        throw new Error(\`Unexpected Norish API response format: \${JSON.stringify(response.data)}\`);
    }`;

const newFetch = `    let rawItems = [];
    if (Array.isArray(response.data)) {
        rawItems = response.data.map(item => typeof item === 'string' ? item : (item.text || item.name || item.ingredient || JSON.stringify(item)));
    } else if (response.data && Array.isArray(response.data.items)) {
        rawItems = response.data.items.map(item => typeof item === 'string' ? item : (item.text || item.name || item.ingredient || JSON.stringify(item)));
    } else {
        let debugData = response.data;
        if (typeof debugData === 'string' && debugData.includes('<html')) {
             throw new Error('Received HTML response instead of JSON. Ensure your NORISH_API_URL points to the API endpoint (e.g., http://your-domain/api/v1/groceries) and not the web frontend, and that your API key is correct.');
        }
        if (typeof debugData === 'object') {
           debugData = JSON.stringify(debugData).substring(0, 500);
        } else if (typeof debugData === 'string') {
           debugData = debugData.substring(0, 500);
        }
        throw new Error(\`Unexpected Norish API response format. First 500 chars: \${debugData}\`);
    }`;

code = code.replace(oldFetch, newFetch);
fs.writeFileSync('index.js', code);
