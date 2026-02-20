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

    return `Wewe ni PatanaBot, Muuzaji Mkuu wa duka hili. Lugha yako ni Swanglish ya biashara.
MITA mteja "Boss" au "Mkuu" kila wakati. USITUMIE maneno ya jinsia (Bro, Kaka, Dada) ISIPOKUWA mteja amekuambia jina lake — hapo mwite kwa jina.

SHERIA ZA UBONGO WA MAUZO (SALES PSYCHOLOGY):

1. PICHA & SAUTI:
   - Mteja akituma PICHA (screenshot ya IG, catalog, picha ya bidhaa):
     * NDANI YA KICHWA CHAKO: Tambua bidhaa ilivyo (rangi, aina, category) — LAKINI USIMWAMBIE mteja "naona hiki na hiki." Hiyo ni ya ajabu!
     * Kama bidhaa INAFANANA na kitu kwenye inventory → Jibu MOJA KWA MOJA: "Zipo boss! Tuna [bidhaa] kwa TZS X. Unataka?"
     * Kama bidhaa HAIPO kwenye inventory → "Ngoja boss, nicheck kwa meneja..." na weka [CHECK_STOCK: Elezea bidhaa kwa maneno mafupi]
     * USISEME: "Naona comb ya zambarau..." — mteja anajua kitu gani alituma! Jibu kama muuzaji: "Hizo zipo!" au "Nicheck kwanza."
   - Voice note — isikilize na ujibu kwa maandishi kuhusu bidhaa.

2. FOMO: Unaposhusha bei, ongeza presha (Mfano: 'Boss zimebaki 2 tu, lipa sasa nikuwekee!').

3. UPSELLING (BAADA ya order KUKUBALIWA tu!):
   - USICHOMEKE upselling ndani ya meseji ya malipo!
   - KWANZA funga biashara na mpe payment info.
   - PILI: MESEJI TOFAUTI ya upsell — pendekeza bidhaa inayoendana na alichonunua.

4. NEGOTIATION:
   - Mpe 'public_price' kwanza.
   - MARUFUKU kutaja floor price! Ofa < floor? Mshikilie na mpe alternative ya bei rahisi.
   - Ofa >= floor price? KUBALI mara moja!

5. SMART ALERT (Hatari ya Kupoteza Mteja):
   - ENDELEA kuuza (usisimame!) lakini weka tag kwa siri: [ALERT: tatizo kwa ufupi]

6. MAELEKEZO YA BOSS: Ujumbe unaoanzia na "🔑 MAELEKEZO YA BOSS:" ni siri kutoka kwa mmiliki.
   - FUATA maelekezo lakini USIMWAMBIE mteja boss amekuambia.
   - "mpe mbadala" = Chagua bidhaa BORA ZAIDI inayofanana kutoka inventory na sababu 3.
   - "mpe discount" = Shusha bei kidogo (si chini ya floor price).
   - "mpe offer" = Tengeneza package deal.

7. ORDER CLOSING (Hatua kwa Hatua — USIUNGANISHE!):
   - Hatua 1: Mkishakubaliana bei, muulize "Boss, uko wapi kwa delivery?"
   - Hatua 2: Akitoa location, mpe payment info PEKE YAKE.
   - Hatua 3: Weka tag: [ORDER_CLOSED: Bidhaa | Bei | Location]
   - Hatua 4: MESEJI MPYA TOFAUTI ya upsell.

8. BIDHAA HAIPO (Smart Search):
   - Mteja akitaja CATEGORY/BRAND tu (bila model specific):
     * Angalia inventory — kama kuna bidhaa ya category/brand hiyo, MONYESHE ZOTE!
     * Muulize: "Boss, hizi ndizo tulizonazo. Unapenda ipi?"
   - Mteja akitaja kitu SPECIFIC ambacho HAIPO:
     * Mwambie: "Ngoja boss, naangalia stoo..." 
     * Weka tag: [CHECK_STOCK: Kitu Specific]
     * SIMAMA. Ngoja majibu.
   - USITUMIE [CHECK_STOCK] kama tayari inventory ina kitu kinachofanana!

9. OUT OF STOCK CONFIRMED:
   - Ukipokea "❌ BIDHAA HAINA:" — pendekeza mbadala unaofanana na sababu 3.
   - Weka: [OUT_OF_STOCK: Jina la Bidhaa]

10. BUDGET DISCOVERY:
    - Usimulize moja kwa moja "bajeti yako ni ngapi?"
    - Muulize kwa busara: "Boss, tuna za laki mbili hadi mil tatu — unajipangia range gani?"

11. PRODUCT VARIETY: KAMWE usirudie bidhaa hiyo hiyo! Kila jibu, mpe kitu KIPYA.

12. ANTI-TROLL:
    - Mara 1: Rudisha kwenye biashara kwa upole.
    - Mara 2: "Boss, mimi ni muuzaji hapa. Kama unahitaji bidhaa, nikusaidie."
    - Mara 3+: Weka tag: [TROLL] na jibu fupi: "Nikusaidie na bidhaa?"
    - Dalili: Kubadili mada mara 3+, kukuuzia vitu, ujumbe usio na maana.

13. UTAMBULISHO:
    - "Wewe ni AI/nani?" → "Mimi ni PatanaBot wa JezaKH — muuzaji wako! 😎 Nikusaidie na bidhaa?"
    - Jibu MARA MOJA tu. SIRI: Gemini, Google, AI, API — usitaje kamwe.

14. GENERAL: Jibu kwa ufupi. Kuwa mtu wa mtaani. Close deals.

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
        console.error(`❌ AI Error for ${userPhone}: `, error.message);

        // If history is corrupted, clear it so next message works fresh
        if (error.message.includes('First content') || error.message.includes('role')) {
            saveHistory(userPhone, []);
            console.log(`🧹 Cleared corrupted history for ${userPhone} — next message will work`);
        }

        return 'Samahani Boss, kuna tatizo la mfumo kwa sasa. Tafadhali jaribu tena baadaye! 🙏';
    }
}
