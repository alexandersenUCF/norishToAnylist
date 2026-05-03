const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldSync = `    const currentItems = targetList.items || [];
    const currentItemNames = currentItems.map(item => item.name.toLowerCase());

    let addedCount = 0;

    for (const item of normalizedItems) {
      if (!item.name) continue;

      const ingredientName = item.name;
      if (currentItemNames.includes(ingredientName.toLowerCase())) {
        console.log(\`Skipping existing item: \${ingredientName}\`);
        continue;
      }

      let finalName = ingredientName;
      let details = item.quantity ? \`Quantity: \${item.quantity}\` : '';

      const newItem = anylist.createItem({
        name: finalName,
        details: details
      });

      console.log(\`Adding item: \${finalName} \${details ? \`(\${details})\` : ''}\`);
      await targetList.addItem(newItem);
      addedCount++;
    }

    console.log(\`Successfully added \${addedCount} new items to AnyList.\`);`;

const newSync = `    const currentItems = targetList.items || [];

    let addedCount = 0;
    let updatedCount = 0;

    for (const item of normalizedItems) {
      if (!item.name) continue;

      const ingredientName = item.name;
      const quantityStr = item.quantity ? String(item.quantity) : '';

      // Find if item already exists in the list (case-insensitive)
      const existingItem = currentItems.find(i => i.name.toLowerCase() === ingredientName.toLowerCase());

      if (existingItem) {
        let needsSave = false;

        // If it's checked off, uncheck it so it appears on the active list
        if (existingItem.checked) {
          existingItem.checked = false;
          needsSave = true;
        }

        // Update the quantity if it's different
        if (quantityStr && existingItem.quantity !== quantityStr) {
          existingItem.quantity = quantityStr;
          needsSave = true;
        }

        if (needsSave) {
          console.log(\`Updating existing item: \${ingredientName} (Quantity: \${quantityStr})\`);
          await existingItem.save();
          updatedCount++;
        } else {
          console.log(\`Skipping existing unchanged item: \${ingredientName}\`);
        }
        continue;
      }

      // Item does not exist, create it
      let newItem = anylist.createItem({ name: ingredientName });
      newItem = await targetList.addItem(newItem);

      // Set quantity if provided and save
      if (quantityStr) {
          newItem.quantity = quantityStr;
          await newItem.save();
      }

      console.log(\`Adding new item: \${ingredientName} \${quantityStr ? \`(Quantity: \${quantityStr})\` : ''}\`);
      addedCount++;
    }

    console.log(\`Successfully added \${addedCount} new items and updated \${updatedCount} existing items.\`);`;

code = code.replace(oldSync, newSync);
fs.writeFileSync('index.js', code);
