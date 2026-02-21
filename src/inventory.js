import * as xlsx from 'xlsx';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');

/**
 * Generate an Excel template for bulk product import.
 * Returns a base64-encoded .xlsx file buffer.
 */
export function generateExcelTemplate() {
    const wb = xlsx.utils.book_new();

    // Sample data rows to guide the owner
    const sampleData = [
        {
            Bidhaa: 'Samsung Galaxy A54',
            Brand: 'Samsung',
            Tier: 'Mid-Range',
            Hali: 'Brand New, 128GB',
            Bei_Kununua: 480000,
            Bei_Kuuza: 550000,
            Stock: 5,
            Features: 'Kamera 50MP OIS, AMOLED 120Hz, Betri 5000mAh',
        },
        {
            Bidhaa: 'Apple iPhone 11',
            Brand: 'Apple',
            Tier: 'Mid-Range',
            Hali: 'Used, 64GB, Green',
            Bei_Kununua: 300000,
            Bei_Kuuza: 350000,
            Stock: 1,
            Features: 'Kamera dual 12MP, A13 Bionic, Face ID',
        },
        {
            Bidhaa: 'Oraimo Earbuds',
            Brand: 'Oraimo',
            Tier: 'Budget',
            Hali: 'Brand New',
            Bei_Kununua: 25000,
            Bei_Kuuza: 35000,
            Stock: 10,
            Features: 'Wireless, Bass nzuri, Bei poa',
        },
    ];

    const ws = xlsx.utils.json_to_sheet(sampleData);

    // Set column widths for readability
    ws['!cols'] = [
        { wch: 25 }, // Bidhaa
        { wch: 12 }, // Brand
        { wch: 12 }, // Tier
        { wch: 25 }, // Hali
        { wch: 12 }, // Bei_Kununua
        { wch: 12 }, // Bei_Kuuza
        { wch: 8 },  // Stock
        { wch: 50 }, // Features
    ];

    xlsx.utils.book_append_sheet(wb, ws, 'Bidhaa');

    // Write to buffer
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buf;
}

/**
 * Updates the shop inventory from an Excel file sent via WhatsApp.
 * Required: Bidhaa, Bei_Kununua, Bei_Kuuza, Stock
 * Optional: Brand, Tier, Hali, Features
 *
 * @param {string} base64Data - Base64 encoded Excel file data
 * @returns {number} Count of items successfully imported
 */
export function updateInventoryFromExcel(base64Data) {
    const buffer = Buffer.from(base64Data, 'base64');
    const workbook = xlsx.read(buffer, { type: 'buffer' });

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(firstSheet);

    if (!data || data.length === 0) {
        throw new Error('Excel haina data! Jaza bidhaa kwanza.');
    }

    // Validate minimum required columns
    const firstRow = data[0];
    const requiredColumns = ['Bidhaa', 'Bei_Kununua', 'Bei_Kuuza', 'Stock'];
    for (const col of requiredColumns) {
        if (!(col in firstRow)) {
            throw new Error(`Column "${col}" haipo! Lazima: ${requiredColumns.join(', ')}`);
        }
    }

    // Map Excel rows to inventory format
    const newInventory = data.map(row => {
        const name = String(row.Bidhaa || '').trim();
        if (!name) return null;

        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const floorPrice = parseInt(String(row.Bei_Kununua).replace(/\D/g, '')) || 0;
        const publicPrice = parseInt(String(row.Bei_Kuuza).replace(/\D/g, '')) || 0;
        const stockQty = parseInt(row.Stock) || 0;

        if (floorPrice === 0 && publicPrice === 0) return null;

        return {
            id,
            category: guessCategoryFromName(name, String(row.Brand || '')),
            brand: String(row.Brand || '').trim() || guessBrand(name),
            tier: String(row.Tier || '').trim() || 'General',
            item: name,
            condition: String(row.Hali || 'Brand New').trim(),
            features: String(row.Features || '').trim(),
            public_price: publicPrice || Math.round(floorPrice * 1.3),
            secret_floor_price: floorPrice || Math.round(publicPrice * 0.77),
            stock_qty: stockQty,
            images: [],
        };
    }).filter(Boolean);

    if (newInventory.length === 0) {
        throw new Error('Hakuna bidhaa valid kwenye Excel! Angalia format.');
    }

    // Read existing shop profile and MERGE (don't replace)
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    const existingIds = new Set(profile.inventory.map(i => i.id));

    let added = 0, updated = 0;
    for (const newItem of newInventory) {
        const existingIdx = profile.inventory.findIndex(i => i.id === newItem.id);
        if (existingIdx >= 0) {
            // Update existing — preserve images
            const old = profile.inventory[existingIdx];
            newItem.images = old.images || old.image_file ? [old.image_file] : [];
            profile.inventory[existingIdx] = newItem;
            updated++;
        } else {
            profile.inventory.push(newItem);
            added++;
        }
    }

    writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
    console.log(`📦 EXCEL IMPORT: ${added} added, ${updated} updated (${profile.inventory.length} total)`);

    return { added, updated, total: profile.inventory.length };
}

/**
 * Bulk import from text. Format: one product per line
 * "Jina, bei_kununua, stock, hali"
 *
 * @param {string} text - Multi-line text after "ONGEZA:" prefix
 * @returns {{ added: number, updated: number, total: number }}
 */
export function bulkImportFromText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    if (lines.length === 0) {
        throw new Error('Hakuna bidhaa! Kila mstari = bidhaa moja.');
    }

    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    let added = 0, updated = 0;

    for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 2) continue;

        const name = parts[0];
        const floorPrice = parseInt(parts[1].replace(/\D/g, ''));
        const stockQty = parts[2] ? parseInt(parts[2]) : 1;
        const condition = parts[3] || 'Brand New';

        if (!name || isNaN(floorPrice)) continue;

        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const existingIdx = profile.inventory.findIndex(i => i.id === id);

        const item = {
            id,
            category: guessCategoryFromName(name, ''),
            brand: guessBrand(name),
            tier: 'General',
            item: name,
            condition,
            features: '',
            public_price: Math.round(floorPrice * 1.3),
            secret_floor_price: floorPrice,
            stock_qty: stockQty,
            images: [],
        };

        if (existingIdx >= 0) {
            const old = profile.inventory[existingIdx];
            item.images = old.images || [];
            item.brand = old.brand || item.brand;
            item.tier = old.tier || item.tier;
            item.features = old.features || item.features;
            profile.inventory[existingIdx] = item;
            updated++;
        } else {
            profile.inventory.push(item);
            added++;
        }
    }

    writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
    console.log(`📦 TEXT IMPORT: ${added} added, ${updated} updated (${profile.inventory.length} total)`);

    return { added, updated, total: profile.inventory.length };
}

// --- Helpers ---

function guessBrand(name) {
    const n = name.toLowerCase();
    const brands = ['samsung', 'apple', 'iphone', 'ipad', 'macbook', 'airpods',
        'google', 'pixel', 'nokia', 'tecno', 'oraimo', 'jbl', 'sony', 'anker',
        'hp', 'modio', 'atouch'];
    for (const b of brands) {
        if (n.includes(b)) {
            if (['iphone', 'ipad', 'macbook', 'airpods'].includes(b)) return 'Apple';
            if (b === 'pixel') return 'Google';
            return b.charAt(0).toUpperCase() + b.slice(1);
        }
    }
    return 'Other';
}

function guessCategoryFromName(name, brand) {
    const n = (name + ' ' + brand).toLowerCase();
    if (n.match(/phone|iphone|samsung galaxy [sa]|pixel [0-9]|nokia|tecno|spark|redmi/)) return 'SIMU';
    if (n.match(/tab|ipad|modio|atouch/)) return 'TABLET';
    if (n.match(/pod|bud|earphone|headphone|jbl|oraimo.*bud|sony.*wf|anker.*sound/)) return 'EARPHONES';
    if (n.match(/power.*bank/)) return 'POWER BANK';
    if (n.match(/charger|cable|lightning/)) return 'CHARGER/CABLE';
    if (n.match(/watch/)) return 'SMART WATCH';
    if (n.match(/laptop|macbook|hp.*15|thinkpad/)) return 'LAPTOP';
    return 'NYINGINE';
}
