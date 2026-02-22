import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import * as xlsx from 'xlsx';
import * as inventory from '../src/inventory.js';

// Mock fs module
vi.mock('fs', () => ({
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
}));

describe('Inventory Module', () => {
    // Sample shop profile to be returned by readFileSync
    const mockProfile = {
        shop_name: "Test Shop",
        inventory: [
            {
                id: 'old_item',
                item: 'Old Item',
                public_price: 1300,
                secret_floor_price: 1000,
                stock_qty: 5,
                condition: 'Used',
                images: []
            }
        ]
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup readFileSync to return our mock profile
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockProfile));
    });

    describe('generateExcelTemplate', () => {
        it('should return a valid Excel buffer', () => {
            const buf = inventory.generateExcelTemplate();
            expect(Buffer.isBuffer(buf)).toBe(true);

            // Verify content using xlsx
            const wb = xlsx.read(buf, { type: 'buffer' });
            expect(wb.SheetNames).toContain('Bidhaa');
            const ws = wb.Sheets['Bidhaa'];
            const data = xlsx.utils.sheet_to_json(ws);
            expect(data.length).toBeGreaterThan(0);
            expect(data[0]).toHaveProperty('Bidhaa');
        });
    });

    describe('updateInventoryFromExcel', () => {
        it('should add new items from Excel', () => {
            // Create a sample Excel file in memory
            const newData = [
                { Bidhaa: 'New Phone', Brand: 'Samsung', Bei_Kununua: 500000, Bei_Kuuza: 600000, Stock: 10, Hali: 'New' }
            ];
            const ws = xlsx.utils.json_to_sheet(newData);
            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
            const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
            const base64Data = excelBuffer.toString('base64');

            const result = inventory.updateInventoryFromExcel(base64Data);

            expect(result.added).toBe(1);
            expect(result.updated).toBe(0);
            expect(writeFileSync).toHaveBeenCalledTimes(1);

            // Verify the written data
            const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
            const savedProfile = JSON.parse(content);
            expect(savedProfile.inventory).toHaveLength(2); // 1 existing + 1 new
            const newItem = savedProfile.inventory.find(i => i.item === 'New Phone');
            expect(newItem).toBeDefined();
            expect(newItem.stock_qty).toBe(10);
        });

        it('should update existing items from Excel', () => {
            // Update the existing 'Old Item'
            const updateData = [
                { Bidhaa: 'Old Item', Brand: 'Generic', Bei_Kununua: 1500, Bei_Kuuza: 2000, Stock: 20, Hali: 'Refurbished' }
            ];
            const ws = xlsx.utils.json_to_sheet(updateData);
            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
            const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
            const base64Data = excelBuffer.toString('base64');

            const result = inventory.updateInventoryFromExcel(base64Data);

            expect(result.added).toBe(0);
            expect(result.updated).toBe(1);
            expect(writeFileSync).toHaveBeenCalledTimes(1);

            const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
            const savedProfile = JSON.parse(content);
            const updatedItem = savedProfile.inventory.find(i => i.id === 'old_item');
            expect(updatedItem.stock_qty).toBe(20);
            expect(updatedItem.condition).toBe('Refurbished');
        });

        it('should throw error if required columns are missing', () => {
            const invalidData = [{ Foo: 'Bar' }];
            const ws = xlsx.utils.json_to_sheet(invalidData);
            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
            const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
            const base64Data = excelBuffer.toString('base64');

            expect(() => inventory.updateInventoryFromExcel(base64Data)).toThrow(/Column "Bidhaa" haipo/);
        });
    });

    describe('bulkImportFromText', () => {
        it('should add items from text format', () => {
            // Format: "Jina, bei_kununua, stock, hali"
            const text = `
                Simple Phone, 20000, 5, Used
                Another Item, 5000, 2
            `;

            const result = inventory.bulkImportFromText(text);

            expect(result.added).toBe(2);
            expect(writeFileSync).toHaveBeenCalledTimes(1);

            const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
            const savedProfile = JSON.parse(content);
            const simplePhone = savedProfile.inventory.find(i => i.item === 'Simple Phone');
            expect(simplePhone).toBeDefined();
            expect(simplePhone.secret_floor_price).toBe(20000);
            expect(simplePhone.condition).toBe('Used');

            const anotherItem = savedProfile.inventory.find(i => i.item === 'Another Item');
            expect(anotherItem).toBeDefined();
            expect(anotherItem.stock_qty).toBe(2);
            expect(anotherItem.condition).toBe('Brand New'); // default
        });

        it('should update existing items from text format', () => {
            const text = `Old Item, 9999, 50, Mint`;

            const result = inventory.bulkImportFromText(text);

            expect(result.updated).toBe(1);
            expect(result.added).toBe(0);

            const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
            const savedProfile = JSON.parse(content);
            const updatedItem = savedProfile.inventory.find(i => i.id === 'old_item');
            expect(updatedItem.stock_qty).toBe(50);
            expect(updatedItem.condition).toBe('Mint');
        });
    });
});
