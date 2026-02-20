import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');
const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));

/**
 * Converts the shop profile JSON into a human-readable text string
 * for injection into the AI system prompt.
 */
function buildShopContext() {
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

export const shopContext = buildShopContext();
export const shopName = profile.shop_name;
