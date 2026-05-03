const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// evaluate the functions to test them
const funcRegex = /const prepWords[\s\S]*?return \{ name: name \|\| raw, quantity, unit \};\n}/m;
const match = code.match(funcRegex);
if(match) {
    eval(match[0]);
    const testCases = [
      "2x granny smith apples, cut into 1/2-inch pieces",
      "0.3 cups half & half",
      "90% lean ground beef (-or ground lamb)",
      "-inch-thick boneless pork loin chops (5 ounces each)",
      "garlic cloves (-minced)",
      "garlic, chopped",
      "minced garlic",
      "frozen mixed peas & carrots*"
    ];

    testCases.forEach(tc => {
        // Mock the "2x " to "2 " since "x" often trips up basic regex
        let safeTc = tc.replace(/(\d+)x\s/i, '$1 ');
        console.log(tc);
        console.log("   =>", extractIngredient(safeTc));
    });
} else {
    console.error("Functions not found in index.js");
}
