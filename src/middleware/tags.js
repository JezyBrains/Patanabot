import {
    ORDER_TAG_REGEX, PENDING_PAYMENT_TAG_REGEX, RECEIPT_TAG_REGEX,
    SEND_IMAGE_TAG_REGEX, ALERT_TAG_REGEX, OOS_TAG_REGEX,
    CHECK_STOCK_TAG_REGEX, TROLL_TAG_REGEX,
    STOCK_CHECK_REMINDER_MS, MAX_ESCALATIONS_PER_CUSTOMER,
    TROLL_COOLDOWN_MS, OWNER_PHONE
} from '../constants.js';
import {
    saveOrder, incrementEscalation, resetEscalation,
    getCustomerRating, setCustomerRating, getCustomerProfile,
    saveMissedOpportunity
} from '../db.js';
import { deductStock, getItemById, findItemByName } from '../shop.js';
import { generateResponse } from '../ai.js';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function startStockCheck(customerPhone, item, chatId, client, state) {
    // Clear any existing check for this customer
    clearStockCheck(customerPhone, state);

    let reminders = 0;
    const sendReminder = async () => {
        const check = state.stockCheckQueue.get(customerPhone);
        if (!check) return;

        reminders++;
        check.reminders = reminders;

        if (reminders <= 3 && OWNER_PHONE) {
            const urgency = reminders === 1 ? '📦' : reminders === 2 ? '⏰' : '🚨';
            await client.sendMessage(
                OWNER_PHONE,
                `${urgency} *STOCK CHECK #${reminders}/3*\n\n` +
                `Mteja +${customerPhone} anataka: *${item}*\n` +
                `Tunaipata? Jibu *NDIYO* au *HAPANA*\n\n` +
                `${reminders === 3 ? '⚠️ Hii ni reminder ya mwisho! Baada ya dakika 3 nitamwambia mteja haina.' : ''}`
            );
            console.log(`📦 [STOCK CHECK #${reminders}] Reminder sent to owner for "${item}" (customer: ${customerPhone})`);
        }

        // After 3 reminders (9 minutes total), auto-respond OOS
        if (reminders >= 3) {
            check.timer = setTimeout(async () => {
                if (state.stockCheckQueue.has(customerPhone)) {
                    // Owner didn't reply — tell customer OOS via AI
                    const oosResponse = await generateResponse(
                        customerPhone,
                        `❌ BIDHAA HAINA: ${item}. Boss hajajibu kwa muda.
SHERIA KALI: Kama kuna bidhaa nyingine katika CATEGORY ILE ILE (simu kwa simu, laptop kwa laptop) inayolingana na bajeti ya mteja, mpe ofa kwa heshima.
KAMA HAKUNA bidhaa kwenye category hiyo inayotosha bajeti yake, MUAGE KWA HESHIMA — "Samahani boss, kwa sasa hii haipatikani. Ukihitaji kitu kingine nipo hapa!"
ONYO KALI: USIMPE bidhaa tofauti (earphones/charger kwa mtu anayetaka simu = DHARAU!)`
                    );
                    let cleanResponse = oosResponse.replace(OOS_TAG_REGEX, '').replace(CHECK_STOCK_TAG_REGEX, '').trim();
                    await client.sendMessage(chatId, cleanResponse);
                    saveMissedOpportunity(item);
                    console.log(`📉 [OOS AUTO] "${item}" — owner didn't reply, sent alternatives to ${customerPhone}`);
                    clearStockCheck(customerPhone, state);
                }
            }, STOCK_CHECK_REMINDER_MS);
        } else {
            check.timer = setTimeout(sendReminder, STOCK_CHECK_REMINDER_MS);
        }
    };

    state.stockCheckQueue.set(customerPhone, { item, reminders: 0, timer: setTimeout(sendReminder, 0), chatId });
}

export function clearStockCheck(phone, state) {
    const check = state.stockCheckQueue.get(phone);
    if (check) {
        clearTimeout(check.timer);
        state.stockCheckQueue.delete(phone);
    }
}

export async function processTags(aiResponse, userPhone, message, client, state) {
    // --- SMART ALERT Interceptor (escalation without pausing) ---
    const alertMatch = aiResponse.match(ALERT_TAG_REGEX);
    if (alertMatch) {
        const [fullTag, summary] = alertMatch;
        aiResponse = aiResponse.replace(fullTag, '').trim();

        const escCount = incrementEscalation(userPhone);

        if (escCount <= MAX_ESCALATIONS_PER_CUSTOMER && OWNER_PHONE) {
            const profile = getCustomerProfile(userPhone);
            state.activeEscalations.set(userPhone, { summary, timestamp: Date.now() });

            const text = message.body || '[Media]';

            await client.sendMessage(
                OWNER_PHONE,
                `🚨 *ALERT #${escCount}/5 — Mteja +${userPhone}*\n${profile.label}\n\n` +
                `📋 *Tatizo:* ${summary}\n` +
                `💬 *Meseji:* "${text}"\n\n` +
                `💡 *Reply hii meseji* na maelekezo yako!`
            );

            console.log(`🚨 [ALERT #${escCount}] ${userPhone}: ${summary}`);
        }

        if (escCount >= MAX_ESCALATIONS_PER_CUSTOMER) {
            console.log(`⚠️ [MAX ALERTS] ${userPhone} hit ${MAX_ESCALATIONS_PER_CUSTOMER} escalations`);
        }
    }

    // --- CHECK STOCK Interceptor (pretend checking, alert owner) ---
    const checkStockMatch = aiResponse.match(CHECK_STOCK_TAG_REGEX);
    if (checkStockMatch) {
        const [fullTag, item] = checkStockMatch;
        aiResponse = aiResponse.replace(fullTag, '').trim();

        // Start the stock check relay — pings owner with reminders
        startStockCheck(userPhone, item.trim(), message.from, client, state);
        console.log(`📦 [CHECK STOCK] "${item}" — owner pinged, waiting for reply`);

        // Stop processing other tags and return response
        return aiResponse;
    }

    // --- PENDING PAYMENT Interceptor (replaces ORDER_CLOSED) ---
    const pendingMatch = aiResponse.match(PENDING_PAYMENT_TAG_REGEX);
    if (pendingMatch) {
        const [fullTag, itemId, price, location] = pendingMatch;
        aiResponse = aiResponse.replace(fullTag, '').trim();

        // Deduct stock immediately
        const deducted = deductStock(itemId.trim());
        if (!deducted) {
            console.log(`❌ [STOCK FAIL] ${itemId} — out of stock, can't reserve`);
        }

        // Store pending payment
        state.pendingPayments.set(userPhone, {
            itemId: itemId.trim(),
            price: price.trim(),
            location: location.trim(),
            timestamp: Date.now(),
        });

        // Alert owner
        if (OWNER_PHONE) {
            const item = getItemById(itemId.trim());
            const itemName = item ? item.item : itemId.trim();
            const profile2 = getCustomerProfile(userPhone);
            await client.sendMessage(
                OWNER_PHONE,
                `💰 *PENDING PAYMENT:*\n+${userPhone} (${profile2.label})\nBidhaa: ${itemName}\nBei: TZS ${price.trim()}\nLocation: ${location.trim()}\n\n_Mteja anatuma muamala. Akituma screenshot, nitakuuliza THIBITISHA au KATAA._`
            );
        }

        console.log(`💰 [PENDING] ${itemId} @ TZS ${price} → ${location} (stock deducted)`);
    }

    // --- Backward compat: ORDER_CLOSED (if AI still uses old tag) ---
    const orderMatch = aiResponse.match(ORDER_TAG_REGEX);
    if (orderMatch) {
        const [fullTag, item, price, location] = orderMatch;
        saveOrder(userPhone, item.trim(), price.trim(), location.trim());
        aiResponse = aiResponse.replace(fullTag, '').trim();
        const currentRating = getCustomerRating(userPhone);
        if (currentRating < 5) setCustomerRating(userPhone, Math.min(5, currentRating + 1));
        resetEscalation(userPhone);
        console.log(`✅ [ORDER CLOSED] ${item} @ ${price} → ${location}`);
    }

    // --- RECEIPT UPLOADED Interceptor ---
    const receiptMatch = aiResponse.match(RECEIPT_TAG_REGEX);
    if (receiptMatch) {
        aiResponse = aiResponse.replace(RECEIPT_TAG_REGEX, '').trim();

        const pending = state.pendingPayments.get(userPhone);
        if (pending && OWNER_PHONE) {
            const item = getItemById(pending.itemId);
            const itemName = item ? item.item : pending.itemId;
            const profile2 = getCustomerProfile(userPhone);
            await client.sendMessage(
                OWNER_PHONE,
                `🧾 *RECEIPT UPLOADED:*\n+${userPhone} (${profile2.label})\nBidhaa: ${itemName}\nBei: TZS ${pending.price}\n\n_Angalia kama hela imeingia. Reply:_\n*THIBITISHA* = Malipo OK ✅\n*KATAA* = Hayajaingia ❌`
            );
            console.log(`🧾 [RECEIPT] ${userPhone} sent receipt for ${itemName}`);
        }
    }

    // --- WhatsApp formatting cleanup ---
    aiResponse = aiResponse.replace(/\*\*(.+?)\*\*/g, '*$1*');
    aiResponse = aiResponse.replace(/^#+\s*/gm, '');
    aiResponse = aiResponse.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // --- SEND IMAGE Interceptor ---
    const imgRegexGlobal = /\[SEND_IMAGE:\s*([^\]]+)\]/gi;
    const imgMatches = [...aiResponse.matchAll(imgRegexGlobal)];

    aiResponse = aiResponse.replace(imgRegexGlobal, '').trim();

    if (imgMatches.length > 0) {
        if (aiResponse.length > 0) {
            await message.reply(aiResponse);
        }
        for (const match of imgMatches) {
            const rawId = match[1].trim();
            const item = getItemById(rawId) || findItemByName(rawId);
            const images = Array.isArray(item?.images) ? item.images
                : (item?.image_file ? [item.image_file] : []);

            for (const imgFile of images) {
                const imagePath = join(__dirname, '..', '..', 'data', 'images', imgFile);
                if (existsSync(imagePath)) {
                    const media2 = MessageMedia.fromFilePath(imagePath);
                    await client.sendMessage(message.from, media2);
                }
            }
        }
        console.log(`🖼️ [SEND IMAGE] ${imgMatches.length} products → ${userPhone}`);
        return ''; // Handled
    }

    // --- OUT OF STOCK Interceptor ---
    const oosMatch = aiResponse.match(OOS_TAG_REGEX);
    if (oosMatch) {
        const [fullTag, item] = oosMatch;
        saveMissedOpportunity(item.trim());
        aiResponse = aiResponse.replace(fullTag, '').trim();
        console.log(`📉 [OUT OF STOCK] "${item}" — logged`);
    }

    // --- TROLL Interceptor ---
    const trollMatch = aiResponse.match(TROLL_TAG_REGEX);
    if (trollMatch) {
        aiResponse = aiResponse.replace(TROLL_TAG_REGEX, '').trim();

        state.trollCooldown.set(userPhone, Date.now() + TROLL_COOLDOWN_MS);

        const currentRating = getCustomerRating(userPhone);
        if (currentRating > 1) setCustomerRating(userPhone, Math.max(1, currentRating - 1));

        if (OWNER_PHONE) {
            const profile2 = getCustomerProfile(userPhone);
            await client.sendMessage(
                OWNER_PHONE,
                `🚫 *TROLL DETECTED:* +${userPhone}\n${profile2.label}\nAmepigwa cooldown ya dakika 30.`
            );
        }

        setTimeout(async () => {
            try {
                await client.sendMessage(
                    message.from,
                    'Habari Boss! 👋 Natumaini uko salama. Kama unahitaji bidhaa yoyote leo, nipo hapa kukusaidia! 🔥'
                );
                console.log(`🔄 [FOLLOW-UP] ${userPhone} — re-engagement sent`);
            } catch { }
        }, TROLL_COOLDOWN_MS);

        console.log(`🚫 [TROLL] ${userPhone} — 30min cooldown + follow-up scheduled`);
    }

    return aiResponse;
}
