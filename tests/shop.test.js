import { test, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

// Mock data
let mockProfile = {
    shop_name: "Test Shop",
    inventory: []
};

// Mock fs methods
// Note: mock.method must be called on the object where the method resides.
// fs is the default export object.

mock.method(fs, 'readFileSync', (path) => {
    return JSON.stringify(mockProfile);
});

mock.method(fs, 'writeFileSync', (path, content) => {
    mockProfile = JSON.parse(content);
});

mock.method(fs, 'existsSync', (path) => true);
mock.method(fs, 'mkdirSync', (path, options) => {});

// Import the module under test
// Note: path relative to test file. 'tests/shop.test.js' -> '../src/shop.js'
const { addQuickProduct } = await import('../src/shop.js');

test('addQuickProduct adds a new product', () => {
    // Reset mock data
    mockProfile = { shop_name: "Test Shop", inventory: [] };

    const result = addQuickProduct('Maji ya Uhai', 1000, 50, 'New');

    assert.strictEqual(result.isNew, true);
    assert.strictEqual(result.item.id, 'maji_ya_uhai');
    assert.strictEqual(result.item.item, 'Maji ya Uhai');
    assert.strictEqual(result.item.secret_floor_price, 1000);
    assert.strictEqual(result.item.public_price, 1300); // 1000 * 1.3
    assert.strictEqual(result.item.stock_qty, 50);

    // Verify persistence
    assert.strictEqual(mockProfile.inventory.length, 1);
    assert.strictEqual(mockProfile.inventory[0].id, 'maji_ya_uhai');
});

test('addQuickProduct updates existing product', () => {
    mockProfile = {
        shop_name: "Test Shop",
        inventory: [{
            id: 'maji_ya_uhai',
            item: 'Maji ya Uhai',
            secret_floor_price: 1000,
            public_price: 1300,
            stock_qty: 50,
            condition: 'New'
        }]
    };

    const result = addQuickProduct('Maji ya Uhai', 2000, 100, 'Used');

    assert.strictEqual(result.isNew, false);
    assert.strictEqual(result.item.secret_floor_price, 2000);
    assert.strictEqual(result.item.public_price, 2600); // 2000 * 1.3
    assert.strictEqual(result.item.stock_qty, 100);
    assert.strictEqual(result.item.condition, 'Used');

    // Verify persistence
    assert.strictEqual(mockProfile.inventory[0].secret_floor_price, 2000);
    assert.strictEqual(mockProfile.inventory[0].stock_qty, 100);
});

test('addQuickProduct handles ID generation correctly', () => {
    mockProfile = { shop_name: "Test Shop", inventory: [] };

    const result = addQuickProduct('  AirPods Pro 2nd Gen!  ', 50000, 10, 'Open Box');

    // "  AirPods Pro 2nd Gen!  " -> "airpods_pro_2nd_gen"
    assert.strictEqual(result.item.id, 'airpods_pro_2nd_gen');
    assert.strictEqual(result.item.item, '  AirPods Pro 2nd Gen!  ');
});
