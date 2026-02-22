import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import * as shop from '../src/shop.js';

// Define mockProfile outside so we can use it in the mock factory if needed,
// but for simplicity we'll just return a basic valid JSON in the factory
// and then override it in beforeEach.

// Mock fs module
vi.mock('fs', () => ({
    // Return a valid JSON string by default to avoid top-level JSON.parse error
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({
        shop_name: "Test Shop",
        payment_info: "Default",
        delivery_policy: "Default",
        inventory: []
    })),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true), // Assume files exist to skip creation
    mkdirSync: vi.fn(),
}));

describe('Shop Module', () => {
    const mockProfile = {
        shop_name: "Test Shop",
        payment_info: "Pay me here",
        delivery_policy: "We deliver",
        payment_policy: "pay_first",
        inventory: [
            {
                id: 'item_1',
                item: 'Test Item 1',
                brand: 'BrandA',
                public_price: 1000,
                secret_floor_price: 800,
                stock_qty: 5,
                condition: 'New',
                features: 'Good stuff',
                images: []
            },
            {
                id: 'item_2',
                item: 'Another Item',
                public_price: 2000,
                secret_floor_price: 1500,
                stock_qty: 0,
                condition: 'Used',
                images: ['img1.jpg']
            }
        ]
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup readFileSync to return our detailed mock profile
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockProfile));
        // Mock existsSync to return true
        vi.mocked(existsSync).mockReturnValue(true);
    });

    describe('getShopContext', () => {
        it('should return shop context string with correct info', () => {
            const context = shop.getShopContext();
            expect(context).toContain('Test Shop');
            expect(context).toContain('Pay me here');
            expect(context).toContain('Test Item 1');
            expect(context).toContain('SOLD OUT'); // item_2 has 0 stock
            expect(context).toContain('Brand: BrandA');
        });
    });

    describe('findItemByName', () => {
        it('should find item by exact ID', () => {
            const item = shop.findItemByName('item_1');
            expect(item).toBeDefined();
            expect(item.id).toBe('item_1');
        });

        it('should find item by exact name (case insensitive)', () => {
            const item = shop.findItemByName('test item 1');
            expect(item).toBeDefined();
            expect(item.id).toBe('item_1');
        });

        it('should find item by partial name', () => {
            const item = shop.findItemByName('Another');
            expect(item).toBeDefined();
            expect(item.id).toBe('item_2');
        });

        it('should return null if not found', () => {
            const item = shop.findItemByName('Nonexistent');
            expect(item).toBeNull(); // findItemByName returns null if not found
        });
    });

    describe('getItemById', () => {
        it('should return item by ID', () => {
            const item = shop.getItemById('item_1');
            expect(item).toEqual(mockProfile.inventory[0]);
        });

        it('should return undefined or null if ID not found', () => {
            const item = shop.getItemById('bad_id');
            expect(item).toBeFalsy();
        });
    });

    describe('addProductImage', () => {
        it('should add image to item and save', () => {
            const success = shop.addProductImage('item_1', 'new_image.jpg');
            expect(success).toBe(true);
            expect(writeFileSync).toHaveBeenCalledTimes(1);

            const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
            const savedProfile = JSON.parse(content);
            const item = savedProfile.inventory.find(i => i.id === 'item_1');
            expect(item.images).toContain('new_image.jpg');
        });

        it('should return false if item not found', () => {
            const success = shop.addProductImage('bad_id', 'img.jpg');
            expect(success).toBe(false);
            expect(writeFileSync).not.toHaveBeenCalled();
        });
    });
});
