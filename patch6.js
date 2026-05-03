const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldImport = `const path = require('path');`;
const newImport = `const path = require('path');\nconst https = require('https');`;

code = code.replace(oldImport, newImport);

const oldAxiosPost = `    const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
    });`;

const newAxiosPost = `    // Create an HTTPS agent with keep-alive to prevent firewalls/NATs
    // from dropping the connection during long AI processing times.
    const httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 10000,
        timeout: 180000 // 3 minutes
    });

    const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 180000, // 3 minutes overall request timeout
        httpsAgent: httpsAgent
    });`;

code = code.replace(oldAxiosPost, newAxiosPost);
fs.writeFileSync('index.js', code);
