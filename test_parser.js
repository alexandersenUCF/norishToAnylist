const { parse } = require('ingredient-parser');

const testCases = [
  "skinless, boneless chicken breasts (about 4)",
  "(1/2 stick) unsalted butter",
  "russet potatoes (-about 2 large potatoes peeled and cut into 1 inch cubes)",
  "3 cloves garlic",
  "garlic cloves (-minced)",
  "salt, divided",
  "1 tbsp olive oil"
];

testCases.forEach(tc => {
  try {
    console.log(parse(tc));
  } catch (e) {
    console.error("Failed:", tc);
  }
});
