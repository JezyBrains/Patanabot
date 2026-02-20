import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { generateResponse } from './ai.js';
import {
    saveOrder, pauseBot, isBotActive, resumeBot, resumeAllBots,
    saveMissedOpportunity, getDailySummary,
    getEscalationCount, incrementEscalation, resetEscalation,
    getCustomerRating, setCustomerRating, getCustomerProfile,
} from './db.js';
import { shopName, getInventoryList } from './shop.js';
import { updateInventoryFromExcel } from './inventory.js';
import { updateInventoryFromText } from './admin.js';

dotenv.config();

// Normalize OWNER_PHONE — strip '+' if present
const OWNER_PHONE = (process.env.OWNER_PHONE || '').replace(/^\+/, '');
console.log(`👤 Owner phone: ${OWNER_PHONE || '(not set)'}`);

// Auto-resume all paused customers on boot
const resumed = resumeAllBots();
if (resumed > 0) console.log(`▶️ Auto-resumed ${resumed} paused customer(s) from previous session`);

// --- Clean up stale Chromium lock files from Docker volume ---
function cleanStaleLocks(dir) {
    if (!existsSync(dir)) return;
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            const fullPath = join(dir, entry);
            if (entry === 'SingletonLock' || entry === 'SingletonSocket' || entry === 'SingletonCookie') {
                unlinkSync(fullPath);
                console.log(`🧹 Removed stale lock: ${fullPath}`);
            }
            try {
                if (statSync(fullPath).isDirectory()) cleanStaleLocks(fullPath);
            } catch { /* skip */ }
        }
    } catch (err) {
        console.error('⚠️ Lock cleanup error:', err.message);
    }
}

cleanStaleLocks('data/session');
console.log('🔓 Stale Chromium locks cleared');

// --- WhatsApp Client Initialization ---
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: 'data/session' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--single-process',
        ],
    },
});

// --- QR Code for Authentication ---
client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code to link PatanaBot:\n');
    qrcode.generate(qr, { small: true });
});

// --- Ready Event ---
client.on('ready', () => {
    console.log(`\n🚀 PatanaBot Enterprise is LIVE for "${shopName}"!`);
    console.log('━'.repeat(50));
    console.log('💼 B2B Sales Negotiator Active');
    console.log('🤖 AI Engine: Gemini 2.0 Flash (Multimodal)');
    console.log('📦 Mode: Master Closer + Smart Escalation');
    console.log('🛡️ Anti-Spam: 5s cooldown per customer');
    console.log('📊 Daily Reports: 20:00 EAT');
    console.log('📋 Admin: STOO | UPDATE | ZIMA | WASHA | RATE');
    console.log('━'.repeat(50));
});

client.on('auth_failure', (msg) => console.error('❌ Auth failed:', msg));
client.on('disconnected', (reason) => { console.log('🔌 Disconnected:', reason); client.initialize(); });

// --- Tag Regex Patterns ---
const ORDER_TAG_REGEX = /\[ORDER_CLOSED:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\]/;
const ALERT_TAG_REGEX = /\[ALERT:\s*(.+?)\s*\]/;
const OOS_TAG_REGEX = /\[OUT_OF_STOCK:\s*(.+?)\s*\]/;
const CHECK_STOCK_TAG_REGEX = /\[CHECK_STOCK:\s*(.+?)\s*\]/;
const TROLL_TAG_REGEX = /\[TROLL\]/;

// --- Anti-Spam: Rate Limiter (per customer) ---
const COOLDOWN_MS = 5000;
const lastMessageTime = new Map();

// --- Anti-Troll: Auto-ignore time-wasters ---
const trollCooldown = new Map(); // phone → expiry timestamp
const TROLL_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// --- Escalation Relay: Active escalations (multi-customer) ---
const MAX_ESCALATIONS_PER_CUSTOMER = 5;
const activeEscalations = new Map(); // customerPhone → { summary, timestamp }

// --- Stock Check Queue: Owner has 9 min (3 reminders × 3 min) to reply ---
const stockCheckQueue = new Map(); // customerPhone → { item, reminders, timer, chatId }
const STOCK_CHECK_REMINDER_MS = 3 * 60 * 1000; // 3 minutes

function startStockCheck(customerPhone, item, chatId) {
    // Clear any existing check for this customer
    clearStockCheck(customerPhone);

    let reminders = 0;
    const sendReminder = async () => {
        const check = stockCheckQueue.get(customerPhone);
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
                if (stockCheckQueue.has(customerPhone)) {
                    // Owner didn't reply — tell customer OOS via AI
                    const oosResponse = await generateResponse(
                        customerPhone,
                        `❌ BIDHAA HAINA: ${item}. Pendekeza mbadala bora kwa mteja.`
                    );
                    let cleanResponse = oosResponse.replace(OOS_TAG_REGEX, '').replace(CHECK_STOCK_TAG_REGEX, '').trim();
                    await client.sendMessage(chatId, cleanResponse);
                    saveMissedOpportunity(item);
                    console.log(`📉 [OOS AUTO] "${item}" — owner didn't reply, sent alternatives to ${customerPhone}`);
                    clearStockCheck(customerPhone);
                }
            }, STOCK_CHECK_REMINDER_MS);
        } else {
            check.timer = setTimeout(sendReminder, STOCK_CHECK_REMINDER_MS);
        }
    };

    stockCheckQueue.set(customerPhone, { item, reminders: 0, timer: setTimeout(sendReminder, 0), chatId });
}

function clearStockCheck(phone) {
    const check = stockCheckQueue.get(phone);
    if (check) {
        clearTimeout(check.timer);
        stockCheckQueue.delete(phone);
    }
}

// ============================================================
// MAIN MESSAGE HANDLER (Incoming Messages)
// ============================================================
client.on('message', async (message) => {
    try {
        if (message.from.includes('@g.us')) return;

        // ============================================================
        // OWNER ADMIN PANEL
        // ============================================================
        const isOwner = (message.from === OWNER_PHONE);

        if (isOwner) {
            if (message.hasMedia) {
                const media = await message.downloadMedia();

                const isExcel =
                    (media.mimetype && (
                        media.mimetype.includes('spreadsheetml') ||
                        media.mimetype.includes('excel') ||
                        media.mimetype.includes('vnd.ms-excel')
                    )) ||
                    (media.filename && media.filename.endsWith('.xlsx'));

                if (isExcel) {
                    await message.reply('⏳ Boss, naipokea listi yako mpya ya bidhaa...');
                    try {
                        const count = updateInventoryFromExcel(media.data);
                        await message.reply(`✅ TAYARI! Bidhaa ${count} zimesasishwa! 📦🔥`);
                    } catch (err) {
                        console.error('❌ Excel error:', err.message);
                        await message.reply(`❌ Excel error: ${err.message}`);
                    }
                }
            } else {
                const text = message.body.trim();
                const upper = text.toUpperCase();

                // --- BIDHAA: List inventory ---
                if (upper === 'BIDHAA' || upper === 'STOO' || upper === 'LIST') {
                    await message.reply(getInventoryList());

                    // --- STOO / UPDATE: Inventory management ---
                } else if (upper.startsWith('STOO:') || upper.startsWith('UPDATE:')) {
                    await message.reply('⏳ Nasasisha stoo...');
                    try {
                        const newCount = await updateInventoryFromText(text);
                        await message.reply(`✅ TAYARI! Bidhaa ${newCount} kichwani. 📦🔥`);
                    } catch (error) {
                        console.error('❌ Text inventory error:', error.message);
                        await message.reply('❌ Sikuelewa maelekezo. Jaribu tena.');
                    }

                    // --- ZIMA: Pause bot for customer ---
                } else if (upper.startsWith('ZIMA:')) {
                    const target = text.substring(5).trim();
                    if (target) {
                        pauseBot(target);
                        await message.reply(`⏸️ Bot imezimwa kwa mteja ${target}. Unaongea naye mwenyewe.`);
                    } else {
                        await message.reply('❌ Mfano: _ZIMA: 255743726397_');
                    }

                    // --- WASHA: Resume bot ---
                } else if (upper.startsWith('WASHA:')) {
                    const target = text.substring(6).trim();
                    if (!target || target.toUpperCase() === 'WOTE' || target.toUpperCase() === 'ALL') {
                        const count = resumeAllBots();
                        await message.reply(`▶️ Bot imewashwa kwa wateja WOTE (${count}). Nipo kazini!`);
                    } else {
                        resumeBot(target);
                        await message.reply(`▶️ Bot imewashwa kwa mteja ${target}.`);
                    }

                    // --- RATE: Rate a customer (1-5 stars) ---
                } else if (upper.startsWith('RATE:')) {
                    const parts = text.substring(5).trim().split(/\s+/);
                    const phone = parts[0];
                    const rating = parseInt(parts[1]);
                    if (phone && rating >= 1 && rating <= 5) {
                        setCustomerRating(phone, rating);
                        const profile = getCustomerProfile(phone);
                        await message.reply(`⭐ Mteja ${phone} ameratiwa: ${'⭐'.repeat(rating)}\nStatus: ${profile.label}\nEscalations: ${profile.escalations}`);
                    } else {
                        await message.reply('❌ Mfano: _RATE: 255743726397 4_\n(1=Hatari, 2=Mgumu, 3=Kawaida, 4=Mzuri, 5=VIP)');
                    }

                    // --- PROFILE: View customer profile ---
                } else if (upper.startsWith('PROFILE:')) {
                    const phone = text.substring(8).trim();
                    if (phone) {
                        const profile = getCustomerProfile(phone);
                        await message.reply(
                            `👤 *Profaili ya Mteja ${phone}*\n\n` +
                            `⭐ Rating: ${'⭐'.repeat(profile.rating)} (${profile.rating}/5)\n` +
                            `📊 Status: ${profile.label}\n` +
                            `🚨 Escalations: ${profile.escalations}`
                        );
                    } else {
                        await message.reply('❌ Mfano: _PROFILE: 255743726397_');
                    }

                    // --- Owner reply: NDIYO/HAPANA for stock check ---
                } else if (stockCheckQueue.size > 0 && (upper === 'NDIYO' || upper === 'HAPANA')) {
                    // Try to extract customer from quoted message or use most recent
                    let targetPhone = null;
                    if (message.hasQuotedMsg) {
                        try {
                            const quoted = await message.getQuotedMessage();
                            const phoneMatch = quoted.body.match(/\+(\d{12})/);
                            if (phoneMatch) targetPhone = phoneMatch[1];
                        } catch { }
                    }
                    if (!targetPhone) targetPhone = [...stockCheckQueue.keys()].pop();

                    const check = stockCheckQueue.get(targetPhone);
                    if (!check) {
                        await message.reply('❌ Hakuna stock check inayosubiri.');
                        return;
                    }

                    if (upper === 'NDIYO') {
                        clearStockCheck(targetPhone);
                        const confirmResponse = await generateResponse(
                            targetPhone,
                            `🔑 MAELEKEZO YA BOSS: Tumeiconfirm bidhaa "${check.item}" ipo! Mwambie mteja tuna na mpe bei.`
                        );
                        let clean = confirmResponse.replace(ALERT_TAG_REGEX, '').replace(CHECK_STOCK_TAG_REGEX, '').trim();
                        await client.sendMessage(`${targetPhone}@c.us`, clean);
                        await message.reply(`✅ Mteja ${targetPhone} — "${check.item}" confirmed!`);
                    } else {
                        clearStockCheck(targetPhone);
                        const oosResponse = await generateResponse(
                            targetPhone,
                            `❌ BIDHAA HAINA: ${check.item}. Pendekeza mbadala bora kwa mteja.`
                        );
                        let clean = oosResponse.replace(OOS_TAG_REGEX, '').replace(CHECK_STOCK_TAG_REGEX, '').trim();
                        await client.sendMessage(`${targetPhone}@c.us`, clean);
                        saveMissedOpportunity(check.item);
                        await message.reply(`📉 Mteja ${targetPhone} — alternatives kwa "${check.item}" zimetumwa.`);
                    }

                    // --- Owner reply: route guidance to customer via quote-reply ---
                } else {
                    // Try to extract customer phone from quoted alert message
                    let targetPhone = null;
                    if (message.hasQuotedMsg) {
                        try {
                            const quoted = await message.getQuotedMessage();
                            const phoneMatch = quoted.body.match(/\+(\d{12})/);
                            if (phoneMatch) targetPhone = phoneMatch[1];
                        } catch { }
                    }

                    // Fall back to most recent active escalation
                    if (!targetPhone && activeEscalations.size > 0) {
                        targetPhone = [...activeEscalations.keys()].pop();
                    }

                    if (targetPhone && (activeEscalations.has(targetPhone) || stockCheckQueue.has(targetPhone))) {
                        const guidance = `🔑 MAELEKEZO YA BOSS: ${text}`;
                        const aiResponse = await generateResponse(targetPhone, guidance);

                        let cleanResponse = aiResponse
                            .replace(ALERT_TAG_REGEX, '')
                            .replace(CHECK_STOCK_TAG_REGEX, '')
                            .replace(OOS_TAG_REGEX, '')
                            .trim();

                        await client.sendMessage(`${targetPhone}@c.us`, cleanResponse);
                        await message.reply(`✅ Mteja ${targetPhone}:\n\n"${cleanResponse.substring(0, 150)}..."`);
                        activeEscalations.delete(targetPhone);
                        console.log(`🔑 [BOSS → ${targetPhone}] "${text.substring(0, 50)}"`);
                    } else {
                        // No active escalation — show help
                        await message.reply(
                            '🫡 *PatanaBot Admin Panel*\n\n' +
                            '*Amri:*\n' +
                            '📦 *BIDHAA* — _Angalia stoo_\n' +
                            '📦 *STOO:* _Ongeza/badili bidhaa_\n' +
                            '📦 *UPDATE:* _Sasisha bei_\n' +
                            '⏸️ *ZIMA:* _Zima bot kwa mteja_\n' +
                            '▶️ *WASHA:* _Washa bot (WOTE/namba)_\n' +
                            '⭐ *RATE:* _Ratia mteja (1-5)_\n' +
                            '👤 *PROFILE:* _Profaili ya mteja_\n\n' +
                            '💡 *Reply:* Bonyeza alert/stock check → jibu nayo!\n' +
                            '_NDIYO/HAPANA_ kujibu stock check\n\n' +
                            'Mfano:\n' +
                            '_STOO: Futa Nokia 235_\n' +
                            '_UPDATE: Samsung S24 bei mpya 1.3M mwisho 1.1M_'
                        );
                    }
                }
            }

            return; // Owner is NEVER treated as a customer
        }

        // ============================================================
        // CUSTOMER MESSAGE HANDLING
        // ============================================================

        const contact = await message.getContact();
        const userPhone = contact.number;

        // Check pause status
        if (!isBotActive(userPhone)) {
            console.log(`⏸️ [PAUSED] Ignoring ${userPhone} — owner handling`);
            return;
        }

        // Anti-spam rate limiter
        const now = Date.now();
        const lastTime = lastMessageTime.get(userPhone) || 0;
        if (now - lastTime < COOLDOWN_MS) {
            console.log(`🛡️ [RATE LIMIT] ${userPhone} (too fast)`);
            return;
        }
        lastMessageTime.set(userPhone, now);

        // Anti-troll: check if customer is in cooldown
        const trollExpiry = trollCooldown.get(userPhone);
        if (trollExpiry && now < trollExpiry) {
            console.log(`🚫 [TROLL COOLDOWN] ${userPhone} — ignored (${Math.round((trollExpiry - now) / 60000)}m left)`);
            return;
        }
        if (trollExpiry && now >= trollExpiry) {
            trollCooldown.delete(userPhone);
        }

        const text = message.body.trim();

        // Download media if present
        let media = null;
        if (message.hasMedia) {
            try {
                media = await message.downloadMedia();
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

        // --- SMART ALERT Interceptor (escalation without pausing) ---
        const alertMatch = aiResponse.match(ALERT_TAG_REGEX);
        if (alertMatch) {
            const [fullTag, summary] = alertMatch;
            aiResponse = aiResponse.replace(fullTag, '').trim();

            const escCount = incrementEscalation(userPhone);

            if (escCount <= MAX_ESCALATIONS_PER_CUSTOMER && OWNER_PHONE) {
                activeEscalations.set(userPhone, { summary, timestamp: Date.now() });

                await client.sendMessage(
                    OWNER_PHONE,
                    `🚨 *ALERT #${escCount}/5 — Mteja +${userPhone}*\n${profile.label}\n\n` +
                    `📋 *Tatizo:* ${summary}\n` +
                    `💬 *Meseji:* "${text || '[Media]'}"\n\n` +
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
            startStockCheck(userPhone, item.trim(), message.from);
            console.log(`📦 [CHECK STOCK] "${item}" — owner pinged, waiting for reply`);

            // Send the "checking..." message to customer and stop here
            await message.reply(aiResponse);
            console.log(`🤖 [PatanaBot → ${userPhone}]: ${aiResponse.substring(0, 80)}...`);
            return;
        }

        // --- ORDER CLOSED Interceptor ---
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

        // --- OUT OF STOCK Interceptor ---
        const oosMatch = aiResponse.match(OOS_TAG_REGEX);
        if (oosMatch) {
            const [fullTag, item] = oosMatch;
            saveMissedOpportunity(item.trim());
            aiResponse = aiResponse.replace(fullTag, '').trim();
            console.log(`📉 [OUT OF STOCK] "${item}" — logged`);
        }

        // --- TROLL Interceptor (auto-cooldown time-wasters) ---
        const trollMatch = aiResponse.match(TROLL_TAG_REGEX);
        if (trollMatch) {
            aiResponse = aiResponse.replace(TROLL_TAG_REGEX, '').trim();

            // Put customer in 30-minute cooldown
            trollCooldown.set(userPhone, Date.now() + TROLL_COOLDOWN_MS);

            // Downrate customer
            const currentRating = getCustomerRating(userPhone);
            if (currentRating > 1) setCustomerRating(userPhone, Math.max(1, currentRating - 1));

            // Alert owner
            if (OWNER_PHONE) {
                const profile2 = getCustomerProfile(userPhone);
                await client.sendMessage(
                    OWNER_PHONE,
                    `🚫 *TROLL DETECTED:* +${userPhone}\n${profile2.label}\nAmepigwa cooldown ya dakika 30.`
                );
            }

            // Schedule follow-up after cooldown
            setTimeout(async () => {
                try {
                    await client.sendMessage(
                        message.from,
                        'Habari Boss! 👋 Natumaini uko salama. Kama unahitaji bidhaa yoyote leo, nipo hapa kukusaidia! 🔥'
                    );
                    console.log(`🔄 [FOLLOW-UP] ${userPhone} — re-engagement sent`);
                } catch { /* ignore if send fails */ }
            }, TROLL_COOLDOWN_MS);

            console.log(`🚫 [TROLL] ${userPhone} — 30min cooldown + follow-up scheduled`);
        }

        // Reply to customer
        await message.reply(aiResponse);
        console.log(`🤖 [PatanaBot → ${userPhone}]: ${aiResponse.substring(0, 80)}...`);
    } catch (error) {
        console.error('❌ Message handler error:', error.message);
    }
});

// ============================================================
// DAILY INTELLIGENCE REPORT (8:00 PM EAT)
// ============================================================
cron.schedule('0 20 * * *', async () => {
    try {
        if (!OWNER_PHONE) return;

        const summary = getDailySummary();
        const report =
            `📊 *RIPOTI YA LEO* 📊\n\n` +
            `✅ Oda: ${summary.orderCount}\n` +
            `💰 Mapato: TZS ${summary.totalRevenue.toLocaleString()}\n` +
            `📉 Bidhaa Zinazotafutwa: ${summary.missedItems}\n\n` +
            `Pumzika boss, nipo zamu! 🤖💼`;

        await client.sendMessage(OWNER_PHONE, report);
        console.log('📊 [DAILY REPORT] Sent');
    } catch (error) {
        console.error('❌ Daily report error:', error.message);
    }
}, { timezone: 'Africa/Dar_es_Salaam' });

// --- Initialize ---
console.log('\n🔄 Initializing PatanaBot Enterprise...');
client.initialize();
