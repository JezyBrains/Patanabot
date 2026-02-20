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
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
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
    context += `🚚 DELIVERY: ${profile.delivery_policy}\n\n`;
    context += `📦 BIDHAA ZILIZOPO:\n`;
    context += `${'─'.repeat(50)}\n`;

    for (const item of profile.inventory) {
        context += `• ${item.item}\n`;
        context += `  Hali: ${item.condition}\n`;
        context += `  Bei ya Kawaida: TZS ${item.public_price.toLocaleString()}\n`;
        context += `  🔒 Floor Price (SIRI!): TZS ${item.secret_floor_price.toLocaleString()}\n\n`;
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
            list += `  ${n}. ${item.item} — TZS ${item.public_price.toLocaleString()}\n`;
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
