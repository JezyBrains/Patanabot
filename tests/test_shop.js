import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import the function to test
import { getInventoryList } from '../src/shop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');

describe('getInventoryList', () => {
    let originalProfile = null;

    before(() => {
        // Backup existing profile if it exists
        if (existsSync(profilePath)) {
            originalProfile = readFileSync(profilePath, 'utf-8');
        }
    });

    after(() => {
        // Restore original profile
        if (originalProfile) {
            writeFileSync(profilePath, originalProfile, 'utf-8');
        }
    });

    test('should return empty message when inventory is empty', () => {
        const emptyProfile = {
            shop_name: "Test Shop",
            inventory: []
        };
        writeFileSync(profilePath, JSON.stringify(emptyProfile, null, 2), 'utf-8');

        const result = getInventoryList();
        assert.match(result, /Stoo iko tupu/);
    });

    test('should list items grouped by category', () => {
        const profile = {
            shop_name: "Test Shop",
            inventory: [
                {
                    id: "item1",
                    item: "Phone",
                    category: "Electronics",
                    public_price: 1000,
                    stock_qty: 5
                },
                {
                    id: "item2",
                    item: "Shirt",
                    category: "Clothing",
                    public_price: 500,
                    stock_qty: 10
                }
            ]
        };
        writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

        const result = getInventoryList();

        assert.match(result, /📂 \*Electronics\*/);
        assert.match(result, /Phone/);
        assert.match(result, /📂 \*Clothing\*/);
        assert.match(result, /Shirt/);
    });

    test('should group items without category under NYINGINE', () => {
        const profile = {
            shop_name: "Test Shop",
            inventory: [
                {
                    id: "item3",
                    item: "Mystery Item",
                    public_price: 200,
                    stock_qty: 2
                }
            ]
        };
        writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

        const result = getInventoryList();

        assert.match(result, /📂 \*NYINGINE\*/);
        assert.match(result, /Mystery Item/);
    });

    test('should mark out of stock items with ❌', () => {
        const profile = {
            shop_name: "Test Shop",
            inventory: [
                {
                    id: "item4",
                    item: "Sold Out Item",
                    category: "Misc",
                    public_price: 100,
                    stock_qty: 0
                }
            ]
        };
        writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

        const result = getInventoryList();

        assert.match(result, /Sold Out Item/);
        assert.match(result, /❌/);
    });
});
