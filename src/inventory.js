import * as xlsx from 'xlsx';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');

/**
 * Updates the shop inventory from an Excel file sent via WhatsApp.
 * Expected columns: Bidhaa, Hali, Bei_Kawaida, Bei_Mwisho
 *
 * @param {string} base64Data - Base64 encoded Excel file data
 * @returns {number} Count of items successfully updated
 */
export function updateInventoryFromExcel(base64Data) {
    // Convert base64 to buffer and read workbook
    const buffer = Buffer.from(base64Data, 'base64');
    const workbook = xlsx.read(buffer, { type: 'buffer' });

    // Get first sheet as JSON
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(firstSheet);

    if (!data || data.length === 0) {
        throw new Error('Excel file is empty or has no valid data rows');
    }

    // Validate required columns exist
    const requiredColumns = ['Bidhaa', 'Hali', 'Bei_Kawaida', 'Bei_Mwisho'];
    const firstRow = data[0];
    for (const col of requiredColumns) {
        if (!(col in firstRow)) {
            throw new Error(`Missing required column: "${col}". Expected columns: ${requiredColumns.join(', ')}`);
        }
    }

    // Map Excel rows to our inventory format
    const newInventory = data.map(row => ({
        item: String(row.Bidhaa || '').trim(),
        condition: String(row.Hali || '').trim(),
        public_price: parseInt(row.Bei_Kawaida) || 0,
        secret_floor_price: parseInt(row.Bei_Mwisho) || 0,
    })).filter(item => item.item && item.public_price > 0);

    // Read existing shop profile
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));

    // Replace inventory
    profile.inventory = newInventory;

    // Write back to disk
    writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

    console.log(`📦 INVENTORY UPDATED: ${newInventory.length} items loaded from Excel`);
    newInventory.forEach(item => {
        console.log(`   • ${item.item} — TZS ${item.public_price.toLocaleString()} (floor: ${item.secret_floor_price.toLocaleString()})`);
    });

    return newInventory.length;
}
