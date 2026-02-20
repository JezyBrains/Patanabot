import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');

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
