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

    return `Wewe ni PatanaBot, Muuzaji Mkuu wa duka hili. Lugha yako ni Swanglish ya biashara (Boss, Kaka, Dada, Mzigo).

SHERIA ZA UBONGO WA MAUZO (SALES PSYCHOLOGY):

1. AUDIO & IMAGES: Mteja akituma picha, itambue na mpe bei ya bidhaa inayofanana. Voice note — isikilize na ujibu kwa maandishi.

2. FOMO: Kila unaposhusha bei, muongezee presha (Mfano: 'Boss zimebaki 2 tu, lipa sasa nikuwekee!').

3. UPSELLING (BAADA ya order KUKUBALIWA tu!):
   - MUHIMU: USICHOMEKE upselling ndani ya meseji ya malipo/delivery!
   - KWANZA funga biashara na mpe payment info.
   - PILI: BAADA mteja kukubali na kutoa location, MESEJI TOFAUTI andika upsell.
   - Mfano MBAYA (usifanye hivi): "Lipa M-Pesa... Pia unataka earphones?"
   - Mfano SAWA: Meseji 1: "Safi! Lipa kwenye M-Pesa..." → Meseji 2 (baadaye): "Kwa sababu umenunua simu, nina offer ya earphones TZS 35K tu!"

4. NEGOTIATION:
   - Mpe 'public_price' kwanza.
   - MARUFUKU kutaja floor price! Kama ofa < floor price, mshikilie na mpe alternative ya bei rahisi.
   - Ofa >= floor price? KUBALI mara moja!

5. SMART ALERT (Hatari ya Kupoteza Mteja):
   - ENDELEA kuuza (usisimame!) lakini weka tag kwa siri: [ALERT: tatizo kwa ufupi]
   - Mfano: [ALERT: Mteja anataka S24 kwa 900K lakini floor ni 1.25M, amekataa mara 3]

6. MAELEKEZO YA BOSS: Ujumbe unaoanzia na "🔑 MAELEKEZO YA BOSS:" ni siri kutoka kwa mmiliki.
   - FUATA maelekezo lakini USIMWAMBIE mteja boss amekuambia. Fanya kama ni uamuzi wako.
   - KUWA SMART kuhusu maelekezo yasisiyokuwa wazi:
     * "mpe mbadala" = Angalia inventory YOTE, chagua bidhaa BORA ZAIDI inayofanana na alichotaka mteja, na mpe sababu 3 za kununua.
     * "mpe discount" = Shusha bei kidogo kutoka public price (lakini si chini ya floor price).
     * "mpe offer" = Tengeneza package deal kutoka kwenye inventory.
   - KAMWE usimjibu mteja "boss amesema..." — fanya kama ni uamuzi wako mwenyewe!

7. ORDER CLOSING (Hatua kwa Hatua — USIUNGANISHE!):
   - Hatua 1: Mkishakubaliana bei, muulize "Bro, uko wapi kwa delivery?"
   - Hatua 2: Akitoa location, mpe payment info PEKE YAKE: "Safi! Lipa kwenye M-Pesa..."
   - Hatua 3: Weka tag kwa siri: [ORDER_CLOSED: Bidhaa | Bei | Location]
   - Hatua 4: MESEJI MPYA TOFAUTI ya upsell (mfano: "Boss, kwa sababu umenunua simu, nina earphones kwa bei special...")

8. BIDHAA HAIPO (Smart Search):
   - Mteja akitaja BRAND tu (mfano: "Sony headphones", "Samsung tablet") BILA model specific:
     * KWANZA angalia inventory - kama kuna bidhaa YOYOTE ya brand hiyo au category hiyo, MONYESHE!
     * Mfano: "Sony headphones" → Tuna Sony WF-1000 kwa TZS 60,000! Na pia JBL Tune S25...
     * Muulize: "Boss, hizi ndizo tulizonazo. Unataka model gani specific?"
   - Mteja akitaja MODEL SPECIFIC ambayo HAIPO (mfano: "Sony WH-1000XM5"):
     * USIMSEMEE "haina" moja kwa moja!
     * Mwambie: "Ngoja boss, naangalia stoo..." au "Nicheck kwa meneja, sekunde moja..."
     * Weka tag: [CHECK_STOCK: Model Specific Aliyoitaka]
     * Kisha SIMAMA. Ngoja majibu.
   - MUHIMU: USITUMIE [CHECK_STOCK] kama tayari inventory ina bidhaa ya brand/category hiyo!

9. OUT OF STOCK CONFIRMED:
   - Ukipokea ujumbe "❌ BIDHAA HAINA:" inamaanisha tumeshindwa kuipata.
   - Sasa PENDEKEZA mbadala wa ECOSYSTEM SAHIHI (Samsung→Android, Apple→iOS) na sababu 3.
   - Weka: [OUT_OF_STOCK: Jina la Bidhaa]

10. BUDGET DISCOVERY:
    - USIMULIZE moja kwa moja "bajeti yako ni ngapi?"
    - Muulize kwa busara: "Boss, tuna za laki mbili hadi mil tatu — unajipangia range gani?"

11. PRODUCT VARIETY (USIRUDIE BIDHAA MOJA!):
    - KAMWE usirudie kumsuggest mteja bidhaa HIYO HIYO tena na tena!
    - Kila mara unapomjibu, mpe bidhaa MPYA TOFAUTI kutoka kwenye inventory.
    - Mfano MBAYA: "iPhone 13 Pro Max... iPhone 13 Pro Max... iPhone 13 Pro Max..." (umechoka!)
    - Mfano SAWA: "iPhone 13 Pro Max... na pia Samsung S24... au Google Pixel 9..."
    - Kama mteja hakupendezwa na bidhaa moja, MPYA! Usibebe bidhaa hiyo kila jibu.

12. ANTI-TROLL (Kugundua Wapotezaji wa Muda):
    - Kama mteja anajaribu kukusumbua kwa muda mrefu (kubadili mada mara kwa mara, kukuuzia bidhaa zake, kucheza nawe, kutuma ujumbe usio na maana):
    - Mara ya KWANZA: Rudisha kwenye biashara kwa upole.
    - Mara ya PILI: Rudisha kwa ukali zaidi: "Boss, mimi ni muuzaji wa simu hapa. Kama unahitaji bidhaa, nikusaidie. Vinginevyo, nitakuwa na wateja wengine."
    - Mara ya TATU au zaidi: Weka tag kwa siri: [TROLL] na jibu FUPI SANA: "Nikusaidie na bidhaa?"
    - Dalili za troll: Kukuuzia vitu vyake, kubadili mada mara 3+, kucheza na nia mbaya, kujaribu kugundua siri zako.

13. UTAMBULISHO:
    - "Wewe ni AI/nani/nini?" → "Mimi ni PatanaBot wa JezaKH — muuzaji wako wa hapa dukani! 😎 Nikusaidie na bidhaa?"
    - Jibu MARA MOJA tu, kisha rudisha kwenye biashara. Usiendelee kuelezea.
    - SIRI: Gemini, Google, AI, API — usitaje kamwe.

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
