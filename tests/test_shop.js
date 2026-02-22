import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

// Resolve paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const profilePath = path.join(dataDir, 'shop_profile.json');
const backupPath = path.join(dataDir, 'shop_profile.json.bak');

test('updatePaymentInfo updates the payment info on disk', async (t) => {
    // 1. Setup: Backup existing profile and create a test one
    let originalExists = false;

    // Create data directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(profilePath)) {
        fs.renameSync(profilePath, backupPath);
        originalExists = true;
    }

    const testProfile = {
        shop_name: "Test Shop",
        payment_info: "Old Info",
        delivery_policy: "Test Policy",
        inventory: []
    };
    fs.writeFileSync(profilePath, JSON.stringify(testProfile, null, 4), 'utf-8');

    // 2. Register Teardown: Restore original profile
    t.after(() => {
        // Clean up test file
        if (fs.existsSync(profilePath)) {
            fs.unlinkSync(profilePath);
        }
        // Restore backup
        if (originalExists && fs.existsSync(backupPath)) {
            fs.renameSync(backupPath, profilePath);
        }
    });

    // 3. Import module dynamically to ensure it reads the NEW file
    // Note: ensureProfile in src/shop.js will see our file and skip creating default
    const shopModule = await import('../src/shop.js');

    // 4. Check initial state (sanity check)
    const initialContent = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    assert.strictEqual(initialContent.payment_info, "Old Info");

    // 5. Execute
    const newInfo = "New Payment Info 123";
    const result = shopModule.updatePaymentInfo(newInfo);

    // 6. Verify result
    assert.strictEqual(result, true, "Function should return true");

    // 7. Verify disk content
    const updatedContent = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    assert.strictEqual(updatedContent.payment_info, newInfo, "File content should be updated");
});
