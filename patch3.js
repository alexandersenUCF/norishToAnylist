const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldGemini = `  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
        }
    });

    const jsonString = response.text;
    const parsedItems = JSON.parse(jsonString);
    console.log(\`Successfully normalized \${parsedItems.length} items using Gemini.\`);
    return parsedItems;
  } catch (error) {`;

const newGemini = `  try {
    // Workaround for Node.js native fetch UND_ERR_SOCKET bug on Windows:
    // Make a direct REST call using Axios instead of the @google/genai SDK.
    const url = \`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\${process.env.GEMINI_API_KEY}\`;

    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
    });

    const jsonString = response.data.candidates[0].content.parts[0].text;
    const parsedItems = JSON.parse(jsonString);
    console.log(\`Successfully normalized \${parsedItems.length} items using Gemini.\`);
    return parsedItems;
  } catch (error) {`;

code = code.replace(oldGemini, newGemini);
fs.writeFileSync('index.js', code);
