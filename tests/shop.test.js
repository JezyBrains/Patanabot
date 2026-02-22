import { describe, it } from 'node:test';
import assert from 'node:assert';
import { findItemInInventory } from '../src/shop.js';

describe('Shop Inventory Search', () => {
    // Mock inventory
    const inventory = [
        { id: 'apple_iphone_13', item: 'iPhone 13' },
        { id: 'apple_airpods', item: 'AirPods Pro' },
        { id: 'samsung_s21', item: 'Samsung Galaxy S21' },
        { id: 'case_iphone_13', item: 'Case for iPhone 13' },
        { id: 'screen_protector', item: 'Screen Protector' }
    ];

    it('should find item by exact ID', () => {
        const result = findItemInInventory(inventory, 'apple_iphone_13');
        assert.deepStrictEqual(result, inventory[0]);
    });

    it('should find item by exact name (case insensitive)', () => {
        const result = findItemInInventory(inventory, 'iphone 13');
        assert.deepStrictEqual(result, inventory[0]);

        const resultUpper = findItemInInventory(inventory, 'IPHONE 13');
        assert.deepStrictEqual(resultUpper, inventory[0]);
    });

    it('should find item by partial name', () => {
        const result = findItemInInventory(inventory, 'galaxy');
        assert.deepStrictEqual(result, inventory[2]);
    });

    it('should find item by partial ID', () => {
        const result = findItemInInventory(inventory, 's21');
        assert.deepStrictEqual(result, inventory[2]);
    });

    it('should prioritize exact ID match over others', () => {
        const ambiguousInv = [
            { id: 'match', item: 'Nothing' },
            { id: 'other', item: 'match' } // Name matches 'match'
        ];
        const result = findItemInInventory(ambiguousInv, 'match');
        assert.deepStrictEqual(result, ambiguousInv[0]);
    });

    it('should prioritize exact name match over partial', () => {
        const ambiguousInv = [
            { id: '2', item: 'Test Item Extra' }, // Partial match comes first in list
            { id: '1', item: 'Test Item' }       // Exact match comes second
        ];
        // If partial match had priority, it would find 'Test Item Extra' first.
        // Since exact match has priority, it should find 'Test Item'.
        const result = findItemInInventory(ambiguousInv, 'test item');
        assert.deepStrictEqual(result, ambiguousInv[1]);
    });

    it('should prioritize partial name match over partial ID', () => {
        const ambiguousInv = [
            { id: 'z1', item: 'CommonTerm' },
            { id: 'commonterm_id', item: 'Something Else' }
        ];
        // "commonterm" matches item name of [0] and ID of [1].
        // Logic says partial name comes before partial ID.
        const result = findItemInInventory(ambiguousInv, 'commonterm');
        assert.deepStrictEqual(result, ambiguousInv[0]);
    });

    it('should return null if not found', () => {
        const result = findItemInInventory(inventory, 'nonexistent');
        assert.strictEqual(result, null);
    });

    it('should return null for empty query', () => {
        const result = findItemInInventory(inventory, '');
        assert.strictEqual(result, null);
    });

    it('should return null for whitespace-only query', () => {
        const result = findItemInInventory(inventory, '   ');
        assert.strictEqual(result, null);
    });
});
