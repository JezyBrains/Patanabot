
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { deductStock } from '../src/shop.js';

describe('Shop Stock Logic', () => {
    let tempDir;
    let tempProfilePath;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patana-test-'));
        tempProfilePath = path.join(tempDir, 'shop_profile.json');

        const initialProfile = {
            shop_name: "Test Shop",
            inventory: [
                { id: "item_ok", item: "Item OK", stock_qty: 5, public_price: 100 },
                { id: "item_low", item: "Item Low", stock_qty: 1, public_price: 100 },
                { id: "item_zero", item: "Item Zero", stock_qty: 0, public_price: 100 },
                { id: "item_no_stock_field", item: "Item No Stock Field", public_price: 100 }
            ]
        };

        fs.writeFileSync(tempProfilePath, JSON.stringify(initialProfile, null, 4), 'utf-8');
    });

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('deductStock should decrease stock when available', () => {
        const result = deductStock('item_ok', { profilePath: tempProfilePath });
        assert.strictEqual(result, true, 'Should return true');

        const updatedProfile = JSON.parse(fs.readFileSync(tempProfilePath, 'utf-8'));
        const item = updatedProfile.inventory.find(i => i.id === 'item_ok');
        assert.strictEqual(item.stock_qty, 4, 'Stock should be decreased by 1');
    });

    test('deductStock should fail when stock is 0', () => {
        const result = deductStock('item_zero', { profilePath: tempProfilePath });
        assert.strictEqual(result, false, 'Should return false');

        const updatedProfile = JSON.parse(fs.readFileSync(tempProfilePath, 'utf-8'));
        const item = updatedProfile.inventory.find(i => i.id === 'item_zero');
        assert.strictEqual(item.stock_qty, 0, 'Stock should remain 0');
    });

    test('deductStock should fail when item not found', () => {
        const result = deductStock('non_existent', { profilePath: tempProfilePath });
        assert.strictEqual(result, false, 'Should return false');
    });

    test('deductStock should succeed but not change undefined stock', () => {
        const result = deductStock('item_no_stock_field', { profilePath: tempProfilePath });
        assert.strictEqual(result, true, 'Should return true');

        const updatedProfile = JSON.parse(fs.readFileSync(tempProfilePath, 'utf-8'));
        const item = updatedProfile.inventory.find(i => i.id === 'item_no_stock_field');
        assert.strictEqual(item.stock_qty, undefined, 'Stock should remain undefined');
    });
});
