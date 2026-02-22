import { checkRateLimit, checkTrollCooldown } from '../middleware/rateLimit.js';
import { processTags } from '../middleware/tags.js';
import { isBotActive, getCustomerProfile } from '../db.js';
import { generateResponse } from '../ai.js';
import { downloadMedia } from './media.js';

export async function handleCustomerMessage(message, client, state) {
    const contact = await message.getContact();
    const userPhone = contact.number;
    const chatKey = message.from;

    // Check pause status
    if (!isBotActive(userPhone)) {
        console.log(`⏸️ [PAUSED] Ignoring ${userPhone} — owner handling`);
        return;
    }

    // Anti-spam rate limiter
    if (checkRateLimit(userPhone, chatKey, message, state)) return;

    // Anti-troll: check if customer is in cooldown
    if (checkTrollCooldown(userPhone, state)) return;

    const text = message.body.trim();

    // --- Filter out messages from other bots/systems ---
    const BOT_PATTERNS = [
        /muda wako.*umeisha/i,
        /andika\s+LIPA/i,
        /kujifunza bure/i,
        /USSD kwenye simu/i,
        /weka PIN tu/i,
        /umejifunza vizuri/i,
    ];
    if (text && BOT_PATTERNS.some(p => p.test(text))) {
        console.log(`🤖 [BOT FILTER] Ignored automated message from ${userPhone}`);
        return;
    }

    // Download media if present
    let media = null;
    if (message.hasMedia) {
        try {
            media = await downloadMedia(message);
            console.log(`📎 [MEDIA] ${media.mimetype} from ${userPhone}`);
        } catch (err) {
            console.error(`❌ Media download failed for ${userPhone}:`, err.message);
        }
    }

    if (!text && !media) return;

    // Get customer profile for logging
    const profile = getCustomerProfile(userPhone);
    console.log(`\n📩 [${userPhone}] ${profile.label}: ${text || '[Media Only]'}`);

    // DEMO hook
    if (text.toUpperCase() === 'DEMO') {
        const demoReply = `Habari Boss! 👋 Mimi ni PatanaBot Enterprise — Muuzaji wa AI 24/7.\n\n🧠 Napatana bei\n📸 Ninapokea picha\n🎤 Ninaelewa voice notes\n💰 Ninafunga oda automatically\n\nJaribu: Uliza bei ya AirPods au tuma picha ya simu!`;
        await message.reply(demoReply);
        console.log(`🎯 [DEMO] → ${userPhone}`);
        return;
    }

    // --- AI Response ---
    let aiResponse = await generateResponse(userPhone, text, media);

    // --- Process Tags & Interceptors ---
    const finalResponse = await processTags(aiResponse, userPhone, message, client, state);

    // Reply to customer if there is a text response
    if (finalResponse) {
        await message.reply(finalResponse);
        console.log(`🤖 [PatanaBot → ${userPhone}]: ${finalResponse.substring(0, 80)}...`);
    }
}
