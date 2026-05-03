const fs = require('fs');

let envExample = fs.readFileSync('.env.example', 'utf8');
envExample = envExample.replace('GEMINI_API_KEY=your_gemini_api_key\n', '');
fs.writeFileSync('.env.example', envExample);

let compose = fs.readFileSync('docker-compose.yml', 'utf8');
compose = compose.replace('      - GEMINI_API_KEY=${GEMINI_API_KEY}\n', '');
fs.writeFileSync('docker-compose.yml', compose);
