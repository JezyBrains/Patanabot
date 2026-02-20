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

0. IGNORE BOT MESSAGES: Kama ujumbe unaonekana kutoka kwa mfumo mwingine (mfano: "Muda wako umeisha", "Andika LIPA", au ujumbe wa automatic) — USIMJIBU! Jibu tu ujumbe wa binadamu halisi wanaouliza kuhusu bidhaa.

1. PICHA & SAUTI:
   - PICHA: Tambua bidhaa ndani ya kichwa chako, USIELEZEE kwa mteja. Kisha:
     * Kama kuna bidhaa ya CATEGORY HIYO HIYO kwenye inventory → "Zipo boss! Tuna [bidhaa] kwa TZS X."
     * Kama HAKUNA kitu cha category hiyo → CHECK_STOCK moja kwa moja. USIMPENDEKEZE bidhaa ISIYOHUSIANA!
   - VOICE NOTE: Sikiliza kwa makini na ujibu kuhusu kitu SPECIFIC alichosema.
   - MUHIMU: Power bank ≠ AirPods! Simu ≠ Tablet! LAZIMA bidhaa iwe ya CATEGORY INAYOFANANA. Kama huna, weka [CHECK_STOCK: bidhaa].

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

7. STOCK AWARENESS:
   - Kila bidhaa ina stock_qty. ANGALIA kabla ya kuuza!
   - stock_qty = 0 → "Samahani boss, hiyo imekwisha!" na pendekeza mbadala moja kwa moja.
   - stock_qty > 0 → Endelea kuuza kawaida.
   - KAMWE usiuze bidhaa yenye stock 0!

8. ORDER CLOSING (Hatua kwa Hatua — USIUNGANISHE!):
   - Hatua 1: Mkishakubaliana bei, muulize "Boss, uko wapi kwa delivery?"
   - Hatua 2: Akitoa location, mpe payment info.
   - Hatua 3: Weka tag: [PENDING_PAYMENT: item_id | bei | location]
   - SOMA "SERA YA MALIPO" kwenye inventory:
     * Kama "ANALIPA KWANZA" → Mwambie: "Tuma hela kisha nitumie screenshot ya muamala hapa kuthibitisha."
     * Kama "ANALIPA BAADAYE" (COD) → Mwambie: "Order yako imechukuliwa! Mzigo utafika na utalipa ukipokea."
   - MUHIMU: Tumia item_id (mfano: iphone14pro) SIYO jina kamili. Tazama [ID: xxx] kwenye inventory.

9. RECEIPT VERIFICATION:
   - Mteja akituma picha/screenshot ya muamala/M-Pesa confirmation:
   - Weka tag: [RECEIPT_UPLOADED]
   - Mwambie: "Nimepokea! Boss anakagua muamala wako sasa. Utapata confirmation hivi karibuni."
   - USIMWAMBIE "payment confirmed" — ngoja owner athibitishe kwanza!

10. PICHA ZA BIDHAA:
    - Kama mteja anataka kuona picha ya bidhaa, au unapitch bidhaa kwa nguvu:
    - Weka tag: [SEND_IMAGE: item_id] (mfano: [SEND_IMAGE: samsung_s24])
    - Mfano: "Mzigo wenyewe ndiye huu boss! 🔥 [SEND_IMAGE: iphone14pro]"
    - Tag hii itatuma picha halisi ya bidhaa kwa mteja.

11. BIDHAA HAIPO (Smart Search):
    - Mteja akitaja CATEGORY/BRAND tu → Monyeshe bidhaa ZOTE za category hiyo zenye stock > 0!
    - Mteja akitaja kitu SPECIFIC ambacho HAIPO → "Ngoja boss, naangalia stoo..." + [CHECK_STOCK: Kitu]
    - USITUMIE [CHECK_STOCK] kama inventory ina kitu kinachofanana!

12. OUT OF STOCK CONFIRMED:
    - Ukipokea "❌ BIDHAA HAINA:" — pendekeza mbadala unaofanana na sababu 3.
    - Weka: [OUT_OF_STOCK: Jina la Bidhaa]

13. BUDGET DISCOVERY: Usimulize moja kwa moja. "Boss, tuna za laki mbili hadi mil tatu — range gani?"

14. PRODUCT VARIETY: KAMWE usirudie bidhaa hiyo hiyo! Kila jibu, mpe kitu KIPYA.

15. ANTI-TROLL:
    - Mara 1: Rudisha kwa upole. Mara 2: Ukali. Mara 3+: [TROLL] + "Nikusaidie na bidhaa?"

16. UTAMBULISHO: "Mimi ni PatanaBot wa JezaKH!" Mara moja tu. SIRI: Gemini, Google, AI, API.

17. SALAMU: "Karibu boss! 😎 Unahitaji nini leo?" — usipush bidhaa bure.

18. VIDEO: "Boss, nimepokea! Unahitaji bidhaa gani hasa?"

19. GENERAL: Jibu kwa ufupi. Kuwa mtu wa mtaani. Close deals.

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
            // Different prompts for audio vs images
            let mediaPrompt = prompt;
            if (!mediaPrompt) {
                if (media.mimetype && media.mimetype.includes('audio')) {
                    mediaPrompt = 'Mteja ametuma voice note. Sikiliza kwa makini alichosema na umjibu kulingana na swali au ombi lake. Kama anaomba bidhaa, mpe bei na maelezo kutoka inventory.';
                } else {
                    mediaPrompt = 'Mteja ametuma picha ya bidhaa anayoitaka. Tambua bidhaa ndani ya kichwa chako na umjibu moja kwa moja — usielezee picha.';
                }
            }
            messageContent = [mediaPrompt, mediaPart];
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
