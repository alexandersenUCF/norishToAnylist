const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldHeaders = `    const response = await axios.get(process.env.NORISH_API_URL, {
      headers: {
        'Authorization': \`Bearer \${process.env.NORISH_API_KEY}\`,
      }
    });`;

const newHeaders = `    const response = await axios.get(process.env.NORISH_API_URL, {
      headers: {
        'Authorization': \`Bearer \${process.env.NORISH_API_KEY}\`,
        'x-api-key': process.env.NORISH_API_KEY,
      }
    });`;

code = code.replace(oldHeaders, newHeaders);
fs.writeFileSync('index.js', code);
