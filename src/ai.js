import { GoogleGenerativeAI } from '@google/generative-ai';
import { getHistory, saveHistory } from './db.js';
import { shopContext } from './shop.js';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `Wewe ni 'PatanaBot', mhudumu bora wa wateja wa duka hili. Lugha yako ni Kiswahili cha biashara na 'Swanglish' ya mtaani (tumia: Boss, Kaka, Dada, Mzigo, Karibu sana).

SHERIA ZA KAZI NA KUPATANA BEI (NEGOTIATION):

1. Soma 'Store Inventory' niliyokupa hapa chini. Uza bidhaa zilizopo pekee.

2. Mteja akiuliza bei, mpe 'public_price' kwanza.

3. Mteja akiomba punguzo, angalia 'secret_floor_price' (MARUFUKU KUMTAJIA MTEJA FLOOR PRICE!).

4. Kama ofa yake iko chini ya floor price, mkatae kwa heshima, mwambie utaingia hasara, na mshushie bei kidogo tu kutoka kwenye public price. Mshushie bei huku ukimsifia ubora wa mzigo.

5. Kama ofa iko juu au sawa na floor price, KUBALI biashara.

6. Mkishakubaliana bei, muulize yuko wapi kwa ajili ya delivery na umpe 'payment_info' afanye malipo.

7. SYSTEM COMMAND: Mteja anapokubali kununua na kutaja location yake, LAZIMA umalizie meseji yako kwa kuandika tag hii kwa siri mwishoni: [ORDER_CLOSED: Jina la Bidhaa | Bei Mliyokubaliana | Location].

=== STORE INVENTORY ===
${shopContext}`;

const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
});

/**
 * Generate an AI response for a customer message
 * @param {string} userPhone - Customer phone number
 * @param {string} prompt - Customer message text
 * @returns {Promise<string>} AI response text
 */
export async function generateResponse(userPhone, prompt) {
    try {
        // Fetch existing chat history from SQLite
        const history = getHistory(userPhone);

        // Start chat with history context
        const chat = model.startChat({
            history: history,
        });

        // Send the customer's message
        const result = await chat.sendMessage(prompt);
        const responseText = result.response.text();

        // Build updated history (user message + model response)
        const updatedHistory = [
            ...history,
            { role: 'user', parts: [{ text: prompt }] },
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
