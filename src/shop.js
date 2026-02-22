import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');

// --- Default shop profile (created on first Docker boot) ---
const DEFAULT_PROFILE = {
    shop_name: "Kariakoo Tech Hub",
    payment_info: "M-Pesa Lipa Namba: 123456 (Jina: Kariakoo Tech)",
    delivery_policy: "Dar es Salaam ni TZS 5,000 (Bodaboda). Mikoani tunatuma kwa basi.",
    inventory: [
        { item: "iPhone 13 Pro Max", condition: "Used, 256GB", public_price: 1200000, secret_floor_price: 1100000 },
        { item: "Airpods Pro Gen 2", condition: "Brand New Sealed", public_price: 60000, secret_floor_price: 45000 }
    ]
};

/**
 * Ensures shop_profile.json exists. Creates it with defaults if missing.
 * This handles Docker volumes being empty on first boot.
 */
function ensureProfile() {
    const dataDir = join(__dirname, '..', 'data');
    const imagesDir = join(dataDir, 'images');
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }
    if (!existsSync(imagesDir)) {
        mkdirSync(imagesDir, { recursive: true });
    }
    if (!existsSync(profilePath)) {
        writeFileSync(profilePath, JSON.stringify(DEFAULT_PROFILE, null, 2), 'utf-8');
        console.log('📦 Created default shop_profile.json (first boot)');
    }
}

// Run on module load
ensureProfile();

/**
 * Dynamically reads the shop profile from disk on EVERY call.
 * This ensures that when the owner uploads a new Excel inventory,
 * the AI uses the updated prices immediately — no restart needed.
 */
export function getShopContext() {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));

    let context = `🏪 DUKA: ${profile.shop_name}\n`;
    context += `💰 MALIPO: ${profile.payment_info}\n`;
    context += `🚚 DELIVERY: ${profile.delivery_policy}\n`;
    const policy = profile.payment_policy || 'pay_first';
    context += `📋 SERA YA MALIPO: ${policy === 'pay_first' ? 'Mteja ANALIPA KWANZA kabla ya kupokea mzigo' : 'Mteja ANALIPA BAADAYE akipokea na kukagua mzigo (COD)'}\n\n`;
    context += `📦 BIDHAA ZILIZOPO:\n`;
    context += `${'─'.repeat(50)}\n`;

    for (const item of profile.inventory) {
        const qty = item.stock_qty ?? '?';
        const status = qty === 0 ? ' ❌ SOLD OUT' : '';
        context += `• [ID: ${item.id}] ${item.item}${status}\n`;
        if (item.brand) context += `  Brand: ${item.brand} | Tier: ${item.tier || 'General'}\n`;
        context += `  Hali: ${item.condition}\n`;
        context += `  Bei ya Kawaida: TZS ${item.public_price.toLocaleString()}\n`;
        context += `  🔒 Floor Price (SIRI!): TZS ${item.secret_floor_price.toLocaleString()}\n`;
        context += `  📦 Stock: ${qty} pcs\n`;
        if (item.features) context += `  ⭐ Features: ${item.features}\n`;
        const imgCount = Array.isArray(item.images) ? item.images.length : (item.image_file ? 1 : 0);
        if (imgCount > 0) context += `  🖼️ Picha: ${imgCount} (${item.id})\n`;
        context += `\n`;
    }

    return context;
}

/**
 * Get the shop name (read fresh from disk)
 */
export function getShopName() {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    return profile.shop_name;
}

// Export static shopName for startup display only
const initialProfile = JSON.parse(readFileSync(profilePath, 'utf-8'));
export const shopName = initialProfile.shop_name;

/**
 * Get a formatted inventory list for owner display via WhatsApp
 */
export function getInventoryList() {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    const items = profile.inventory;

    if (!items || items.length === 0) return '📦 Stoo iko tupu! Tuma Excel au andika STOO: kuongeza bidhaa.';

    let list = `📦 *STOO YA ${profile.shop_name.toUpperCase()}*\nBidhaa: ${items.length}\n${'━'.repeat(30)}\n\n`;

    // Group by category
    const groups = {};
    items.forEach(item => {
        const cat = item.category || 'NYINGINE';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(item);
    });

    let n = 1;
    for (const [cat, catItems] of Object.entries(groups)) {
        list += `📂 *${cat}*\n`;
        catItems.forEach(item => {
            const qty = item.stock_qty ?? '?';
            const oos = qty === 0 ? ' ❌' : '';
            list += `  ${n}. ${item.item} — TZS ${item.public_price.toLocaleString()} (${qty} pcs)${oos}\n`;
            n++;
        });
        list += `\n`;
    }

    list += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    list += `_Kubadili:_ stoo: au update:\n`;
    list += `_Kufuta:_ stoo: futa iPhone 13\n`;
    list += `_Kubadili bei:_ update: AirPods bei mpya 60K`;

    return list;
}

/**
 * Get an item by its ID
 */
export function getItemById(itemId) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    return profile.inventory.find(i => i.id === itemId) || null;
}

/**
 * Find an item by name (fuzzy, case-insensitive partial match).
 * Owner types "picha: maji" → finds "Maji ya Uhai"
 */
export function findItemByName(query) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    const q = query.toLowerCase().trim();
    // Try exact ID first
    const byId = profile.inventory.find(i => i.id === q);
    if (byId) return byId;
    // Try exact name match
    const byName = profile.inventory.find(i => i.item.toLowerCase() === q);
    if (byName) return byName;
    // Try partial name match
    const byPartial = profile.inventory.find(i => i.item.toLowerCase().includes(q));
    if (byPartial) return byPartial;
    // Try partial ID match
    return profile.inventory.find(i => i.id.includes(q)) || null;
}

/**
 * Deduct stock by 1. Returns true if successful, false if out of stock.
 */
export function deductStock(itemId, options = {}) {
    const pPath = options.profilePath || profilePath;
    const profile = JSON.parse(readFileSync(pPath, 'utf-8'));
    const item = profile.inventory.find(i => i.id === itemId);
    if (!item || (item.stock_qty !== undefined && item.stock_qty <= 0)) return false;
    if (item.stock_qty !== undefined) item.stock_qty -= 1;
    writeFileSync(pPath, JSON.stringify(profile, null, 4), 'utf-8');
    console.log(`📦 [STOCK] ${item.item}: ${item.stock_qty} remaining`);
    return true;
}

/**
 * Restore stock by 1 (failed payment / cancelled order).
 */
export function restoreStock(itemId) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    const item = profile.inventory.find(i => i.id === itemId);
    if (!item) return false;
    if (item.stock_qty !== undefined) item.stock_qty += 1;
    writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
    console.log(`📦 [STOCK RESTORED] ${item.item}: ${item.stock_qty} now`);
    return true;
}

/**
 * Add an image to a product's images array (supports multiple photos)
 */
export function addProductImage(itemId, fileName) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    const item = profile.inventory.find(i => i.id === itemId);
    if (!item) return false;
    // Migrate from old image_file string to images array
    if (!Array.isArray(item.images)) {
        item.images = item.image_file ? [item.image_file] : [];
        delete item.image_file;
    }
    item.images.push(fileName);
    writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
    return true;
}

/**
 * Quick-add a product from owner's photo caption.
 * Format: "product name, floor price, stock qty, selling unit"
 * Returns { item, isNew } or throws error.
 */
export function addQuickProduct(name, floorPrice, stockQty, unit) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));

    // Generate ID from name: "Maji ya Uhai" → "maji_ya_uhai"
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    // Check if product already exists
    const existing = profile.inventory.find(i => i.id === id);
    if (existing) {
        // Update stock and price if exists
        existing.secret_floor_price = floorPrice;
        existing.public_price = Math.round(floorPrice * 1.3); // 30% markup
        existing.stock_qty = stockQty;
        if (unit) existing.condition = unit;
        writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
        return { item: existing, isNew: false };
    }

    // Create new product
    const markup = Math.round(floorPrice * 1.3); // 30% default markup
    const newItem = {
        id,
        category: 'NYINGINE',
        item: name,
        condition: unit || 'Brand New',
        public_price: markup,
        secret_floor_price: floorPrice,
        stock_qty: stockQty,
        images: [],
    };
    profile.inventory.push(newItem);
    writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
    return { item: newItem, isNew: true };
}

/**
 * Get all inventory IDs for owner display
 */
export function getInventoryIds() {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    return profile.inventory.map(i => `• ${i.id} → ${i.item}`).join('\n');
}

/**
 * Update payment info (M-Pesa, bank, etc.)
 */
export function updatePaymentInfo(newInfo) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    profile.payment_info = newInfo;
    writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
    return true;
}

/**
 * Set payment policy: 'pay_first' or 'pay_on_delivery'
 */
export function setPaymentPolicy(policy) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    profile.payment_policy = policy; // 'pay_first' or 'pay_on_delivery'
    writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
    return true;
}

/**
 * Get current payment policy
 */
export function getPaymentPolicy() {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    return profile.payment_policy || 'pay_first';
}
