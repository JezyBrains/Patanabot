import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
        responseMimeType: 'application/json',
    },
});

/**
 * Updates shop inventory using natural language instructions from the owner.
 * Uses Gemini in JSON mode to parse Swahili/Swanglish business commands.
 *
 * @param {string} ownerText - Owner's natural language instruction (e.g. "STOO: Ongeza iPhone 15 mpya, bei 2.5M mwisho 2.3M")
 * @returns {Promise<number>} New total item count
 */
export async function updateInventoryFromText(ownerText) {
    // Read current shop profile
    const shopData = JSON.parse(readFileSync(profilePath, 'utf-8'));
    const currentInventory = shopData.inventory;

    const prompt = `Wewe ni mfumo wa database wa duka. Hii ni orodha ya stoo ya sasa (Current Inventory):
${JSON.stringify(currentInventory, null, 2)}

Mmiliki wa duka ametuma maelekezo haya: "${ownerText}"

Fanya mabadiliko aliyosema (mfano: ongeza bidhaa, badilisha bei, au futa bidhaa). Elewa lugha ya mtaani kama:
- "mil 2" au "2M" = 2,000,000
- "K" au "elfu" = 1,000 (mfano: "300K" = 300,000)
- "laki" = 100,000

LAZIMA urudishe JSON array MPYA nzima ya stoo peke yake baada ya mabadiliko. Format:
[
  { "item": "Jina la Bidhaa", "condition": "Mpya au Used", "public_price": 100000, "secret_floor_price": 80000 }
]

Usibadilishe bidhaa ambazo mmiliki hakuzitaja. Weka bidhaa zote za zamani na mpya kwenye array.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse Gemini's JSON response
    const newInventory = JSON.parse(responseText);

    if (!Array.isArray(newInventory)) {
        throw new Error('Gemini did not return a valid inventory array');
    }

    // Read fresh and update
    const freshShopData = JSON.parse(readFileSync(profilePath, 'utf-8'));
    freshShopData.inventory = newInventory;
    writeFileSync(profilePath, JSON.stringify(freshShopData, null, 2), 'utf-8');

    console.log(`📦 INVENTORY UPDATED VIA TEXT: ${newInventory.length} items total`);
    newInventory.forEach(item => {
        console.log(`   • ${item.item} — TZS ${item.public_price?.toLocaleString()} (floor: ${item.secret_floor_price?.toLocaleString()})`);
    });

    return newInventory.length;
}
