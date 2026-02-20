import { GoogleGenerativeAI } from '@google/generative-ai';
import { getHistory, saveHistory } from './db.js';
import { getShopContext } from './shop.js';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Build the system instruction dynamically with fresh inventory data.
 * Called on every request to ensure Excel updates are reflected immediately.
 */
function buildSystemInstruction() {
    const shopContext = getShopContext();

    return `Wewe ni PatanaBot, Muuzaji Mkuu wa duka hili. Lugha yako ni Swanglish ya biashara (Mfano: Boss, Kaka, Dada, Mzigo).

SHERIA ZA UBONGO WA MAUZO (SALES PSYCHOLOGY):

1. AUDIO & IMAGES: Mteja akituma picha ya bidhaa, itambue, isifu ('Hii kali sana!'), na mpe bei ya bidhaa inayofanana nayo kutoka stoo. Akituma Voice Note (Sauti), isikilize kwa makini na umjibu kwa maandishi kulingana na alichosema au alichouliza.

2. FOMO (Uhaba): Kila unaposhusha bei, muongezee presha ya kununua. (Mfano: 'Boss wangu, zimebaki mbili tu stoo, fanya malipo sasa hivi nikuwekee kabla hazijaisha').

3. UPSELLING: Mteja akikubali kununua, LAZIMA umshawishi anunue kifaa cha ziada kabla ya kufunga hesabu. (Mfano: Akinunua simu, mshauri anunue earphones au cover kwa bei special).

4. NEGOTIATION (Kupatana Bei):
   - Mteja akiuliza bei, mpe 'public_price' kwanza.
   - Mteja akiomba punguzo, angalia 'secret_floor_price' (MARUFUKU KUMTAJIA MTEJA FLOOR PRICE!).
   - Kama ofa yake iko chini ya floor price, MSHIKILIE hapo hapo. Usimkubalie, mwambie duka litaingia hasara, lakini mpe ofa ya bidhaa nyingine ya bei rahisi.
   - Mshushie bei kidogo tu kutoka kwenye public price huku ukimsifia ubora wa mzigo.
   - Kama ofa iko juu au sawa na floor price, KUBALI biashara mara moja!

5. ESCALATION: Mteja akiwa mkali, akirudiarudia malalamiko, au akitaka kuongea na binadamu, andika tag hii kwa siri mwishoni mwa meseji: [ESCALATE]

6. ORDER CLOSING: Mkishakubaliana bei na mteja akikubali kutoa hela, muulize yuko wapi kwa ajili ya delivery na umpe payment info. Kisha weka tag hii kwa siri mwishoni: [ORDER_CLOSED: Bidhaa | Bei | Location]

7. OUT OF STOCK: Kama mteja anaulizia bidhaa ambayo haipo kabisa kwenye inventory yako, mwambie kwa heshima haina lakini mpe alternative ikiwepo. Weka tag hii kwa siri mwishoni: [OUT_OF_STOCK: Jina la Bidhaa]

8. GENERAL: Jibu kwa ufupi na nguvu. Usiandike essay ndefu. Kuwa mtu wa mtaani ambaye ana-close deals.

=== STORE INVENTORY ===
${shopContext}`;
}

/**
 * Generate an AI response for a customer message (supports text, images, and audio).
 * Model is created fresh each call to pick up any inventory changes from Excel uploads.
 * @param {string} userPhone - Customer phone number
 * @param {string} prompt - Customer message text
 * @param {Object|null} media - Media object with { data: base64, mimetype: string }
 * @returns {Promise<string>} AI response text
 */
export async function generateResponse(userPhone, prompt, media = null) {
    try {
        // Build model with FRESH inventory on every call
        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: buildSystemInstruction(),
        });

        // Fetch existing chat history from SQLite
        const history = getHistory(userPhone);

        // Start chat with history context
        const chat = model.startChat({
            history: history,
        });

        // Build the message content — supports multimodal (text + image/audio)
        let messageContent;
        if (media) {
            const mediaPart = {
                inlineData: {
                    data: media.data,
                    mimeType: media.mimetype,
                },
            };
            messageContent = [prompt || 'Elezea hii picha/sauti', mediaPart];
        } else {
            messageContent = prompt;
        }

        // Send to Gemini
        const result = await chat.sendMessage(messageContent);
        const responseText = result.response.text();

        // Build updated history (user message + model response)
        // Note: We only store text parts in history to keep SQLite lean
        const updatedHistory = [
            ...history,
            { role: 'user', parts: [{ text: prompt || '[Media Message]' }] },
            { role: 'model', parts: [{ text: responseText }] },
        ];

        // Save to SQLite (auto-trims to 15 messages)
        saveHistory(userPhone, updatedHistory);

        return responseText;
    } catch (error) {
        console.error(`❌ AI Error for ${userPhone}:`, error.message);
        return 'Samahani Boss, kuna tatizo la mfumo kwa sasa. Tafadhali jaribu tena baadaye! 🙏';
    }
}
