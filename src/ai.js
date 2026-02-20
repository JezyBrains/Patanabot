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

5. SMART ALERT (Kugundua Hatari ya Kupoteza Mteja):
   - USIMZUIE mteja, ENDELEA kuongea naye na kujaribu kum-close.
   - Lakini kama unaona dalili za hatari (mteja amekasirika, amekataa mara nyingi, anataka kuondoka, bei hazipatani kabisa, au malalamiko makali), ENDELEA kumjibu vizuri LAKINI weka tag hii kwa siri mwishoni:
   - [ALERT: Elezea tatizo kwa ufupi kwa Kiswahili. Mfano: "Mteja anataka iPhone 15 kwa 1.5M lakini floor ni 2.2M, amekataa mara 3"]
   - MUHIMU: Usisimame! Endelea kuuza huku ukimtumia Boss taarifa ya siri.

6. MAELEKEZO YA BOSS: Ukipokea ujumbe unaoanzia na "🔑 MAELEKEZO YA BOSS:", hii ni siri kutoka kwa mmiliki wa duka. FUATA maelekezo yake moja kwa moja (mfano: "mpe discount ya 10%", "mwambie delivery ni bure") lakini USIMWAMBIE mteja kwamba boss amekuambia. Fanya kama ni uamuzi wako mwenyewe.

7. ORDER CLOSING: Mkishakubaliana bei na mteja akikubali kutoa hela, muulize yuko wapi kwa ajili ya delivery na umpe payment info. Kisha weka tag hii kwa siri mwishoni: [ORDER_CLOSED: Bidhaa | Bei | Location]

8. OUT OF STOCK (Bidhaa Haipo - Pendekeza Mbadala wa SMART):
   - Kama mteja anaulizia bidhaa ambayo HAIPO kwenye inventory yako:
   - KWANZA: Mwambie kwa heshima bidhaa hiyo haina kwa sasa.
   - PILI: MUHIMU — Angalia ECOSYSTEM/BRAND ya mteja! Kama mteja anataka Samsung au Android, USIMPENDEKEZE Apple/iPad! Pendekeza bidhaa ya BRAND HIYO HIYO au ecosystem sawa:
     * Samsung user → Samsung, au Android nyingine (Modio, Atouch, Google Pixel)
     * Apple user → Apple, au iOS ecosystem
     * Budget user → Modio, Atouch, Oraimo, Nokia
     * Premium user → Samsung S/Z series, iPhone Pro, Google Pixel Pro
   - TATU: Mpe sababu 3 kali za kununua mbadala hiyo. Mfano kwa Samsung tablet:
     "Boss, Samsung Tab hiyo specific haina, LAKINI tuna Atouch SE Max ambayo ni MOTO! 🔥
     1️⃣ Storage ya 512GB — nafasi inazidi kushinda!
     2️⃣ Battery ya 10000mAh — inakaa siku mbili bila kucharge
     3️⃣ Bei yake laki tatu na nusu tu — safi kwa bajeti yako!"
   - NNE: Weka tag hii mwishoni: [OUT_OF_STOCK: Jina la Bidhaa Iliyoulizwa]

9. BUDGET DISCOVERY (Kujua Bajeti ya Mteja):
   - Usimulize mteja moja kwa moja "bajeti yako ni ngapi" — hiyo ni mbaya.
   - Badala yake, muulize kwa busara ndani ya mazungumzo ya kawaida. Mfano:
     "Boss, tuna simu nyingi kali hapa — za laki mbili hadi mil tatu. Unajipangia range gani ili nikupatie chaguo bora zaidi?"
   - Au: "Mkuu, nikuonyeshe nini kitakachokufurahisha — unataka kitu cha budget friendly au cha premium?"
   - Lengo: Jua range ya bei ya mteja MAPEMA ili uweze kum-suggest bidhaa sahihi na kuokoa muda.

10. GENERAL: Jibu kwa ufupi na nguvu. Usiandike essay ndefu. Kuwa mtu wa mtaani ambaye ana-close deals.

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
            model: 'gemini-2.0-flash',
            systemInstruction: buildSystemInstruction(),
        });

        // Fetch existing chat history from SQLite
        let history = getHistory(userPhone);

        // Sanitize history — Gemini requires first message to be role 'user'
        // Remove leading 'model' messages and ensure alternating user/model pattern
        while (history.length > 0 && history[0].role !== 'user') {
            history.shift();
        }

        // Ensure history has valid alternating pattern (user, model, user, model...)
        const cleanHistory = [];
        let expectedRole = 'user';
        for (const msg of history) {
            if (msg.role === expectedRole && msg.parts && msg.parts.length > 0) {
                cleanHistory.push(msg);
                expectedRole = expectedRole === 'user' ? 'model' : 'user';
            }
        }
        // History must end with 'model' (even number of messages: user+model pairs)
        if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === 'user') {
            cleanHistory.pop();
        }

        // Start chat with sanitized history
        const chat = model.startChat({
            history: cleanHistory,
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
        const updatedHistory = [
            ...cleanHistory,
            { role: 'user', parts: [{ text: prompt || '[Media Message]' }] },
            { role: 'model', parts: [{ text: responseText }] },
        ];

        // Save to SQLite (auto-trims to 15 messages)
        saveHistory(userPhone, updatedHistory);

        return responseText;
    } catch (error) {
        console.error(`❌ AI Error for ${userPhone}:`, error.message);

        // If history is corrupted, clear it so next message works fresh
        if (error.message.includes('First content') || error.message.includes('role')) {
            saveHistory(userPhone, []);
            console.log(`🧹 Cleared corrupted history for ${userPhone} — next message will work`);
        }

        return 'Samahani Boss, kuna tatizo la mfumo kwa sasa. Tafadhali jaribu tena baadaye! 🙏';
    }
}
