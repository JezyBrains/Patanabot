import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { generateResponse } from './ai.js';
import { saveOrder, pauseBot, isBotActive, resumeBot, resumeAllBots, saveMissedOpportunity, getDailySummary } from './db.js';
import { shopName } from './shop.js';
import { updateInventoryFromExcel } from './inventory.js';
import { updateInventoryFromText } from './admin.js';

dotenv.config();

// Normalize OWNER_PHONE — strip '+' if present (WhatsApp uses 255xxx@c.us, not +255xxx@c.us)
const OWNER_PHONE = (process.env.OWNER_PHONE || '').replace(/^\+/, '');
console.log(`👤 Owner phone: ${OWNER_PHONE || '(not set)'}`);

// Auto-resume all paused customers on boot (clear stale pauses from previous sessions)
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
                if (statSync(fullPath).isDirectory()) {
                    cleanStaleLocks(fullPath);
                }
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
    console.log('🤖 AI Engine: Gemini 1.5 Flash (Multimodal)');
    console.log('📦 Mode: Master Closer (Sales Psychology)');
    console.log('👤 Human Override: ENABLED');
    console.log('📊 Daily Reports: 20:00 EAT');
    console.log('📋 Inventory: Excel + Natural Language (STOO:/UPDATE:)');
    console.log('━'.repeat(50));
});

// --- Authentication Failure ---
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
});

// --- Disconnected ---
client.on('disconnected', (reason) => {
    console.log('🔌 Client disconnected:', reason);
    client.initialize();
});

// --- Tag Regex Patterns ---
const ORDER_TAG_REGEX = /\[ORDER_CLOSED:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\]/;
const ESCALATE_TAG_REGEX = /\[ESCALATE\]/;
const OOS_TAG_REGEX = /\[OUT_OF_STOCK:\s*(.+?)\s*\]/;

// --- Anti-Spam: Rate Limiter (per customer) ---
const COOLDOWN_MS = 5000; // 5 seconds between AI calls per customer
const lastMessageTime = new Map();
// ============================================================
// MAIN MESSAGE HANDLER (Incoming Messages)
// ============================================================
client.on('message', async (message) => {
    try {
        // Ignore group messages
        if (message.from.includes('@g.us')) return;

        // ============================================================
        // OWNER ADMIN: Excel Upload + Natural Language Inventory
        // (checked FIRST — owner is NEVER treated as a customer)
        // ============================================================
        const isOwner = (message.from === OWNER_PHONE);

        if (isOwner) {
            if (message.hasMedia) {
                const media = await message.downloadMedia();

                // Check if it's an Excel file
                const isExcel =
                    (media.mimetype && (
                        media.mimetype.includes('spreadsheetml') ||
                        media.mimetype.includes('excel') ||
                        media.mimetype.includes('vnd.ms-excel')
                    )) ||
                    (media.filename && media.filename.endsWith('.xlsx'));

                if (isExcel) {
                    await message.reply('⏳ Boss, naipokea listi yako mpya ya bidhaa, naisoma sasa hivi...');

                    try {
                        const count = updateInventoryFromExcel(media.data);
                        await message.reply(`✅ TAYARI BOSS! Nimefanikiwa kusoma na kukariri bidhaa ${count} mpya. Bei zimesasishwa na nipo tayari kupiga kazi! 📦🔥`);
                    } catch (err) {
                        console.error('❌ Excel parse error:', err.message);
                        await message.reply(`❌ Samahani Boss, kuna shida kwenye kusoma Excel yako. Hakikisha ina column za: Bidhaa, Hali, Bei_Kawaida, Bei_Mwisho.\n\nError: ${err.message}`);
                    }
                }
            } else {
                const text = message.body.trim();

                if (text.toUpperCase().startsWith('STOO:') || text.toUpperCase().startsWith('UPDATE:')) {
                    await message.reply('⏳ Boss, nasoma maelekezo yako. Nasasisha stoo na bei sasa hivi...');

                    try {
                        const newCount = await updateInventoryFromText(text);
                        await message.reply(`✅ TAYARI BOSS! Stoo imesasishwa kikamilifu. Sasa nina bidhaa ${newCount} kichwani. Nipo tayari kuuza! 📦🔥`);
                    } catch (error) {
                        console.error('❌ Text inventory update error:', error.message);
                        await message.reply('❌ Samahani Boss, mtandao umesumbua au sikuelewa vizuri maelekezo. Jaribu tena.');
                    }
                } else if (text.toUpperCase().startsWith('ZIMA:')) {
                    // ZIMA: Pause bot for a specific customer (owner takes over)
                    const target = text.substring(5).trim();
                    if (target) {
                        pauseBot(target);
                        await message.reply(`⏸️ TAYARI! Nimejizima kwa mteja ${target}. Sasa unaongea naye mwenyewe Boss!`);
                    } else {
                        await message.reply('❌ Tafadhali taja namba ya mteja. Mfano: _ZIMA: 255743726397_');
                    }
                } else if (text.toUpperCase().startsWith('WASHA:')) {
                    // WASHA: Unpause bot for a customer or all customers
                    const target = text.substring(6).trim();

                    if (!target || target.toUpperCase() === 'WOTE' || target.toUpperCase() === 'ALL') {
                        const count = resumeAllBots();
                        await message.reply(`▶️ TAYARI! Nimewasha bot kwa wateja WOTE (${count} wamerudishwa). Nipo kazini tena!`);
                    } else {
                        resumeBot(target);
                        await message.reply(`▶️ TAYARI! Nimewasha bot kwa mteja ${target}. Nitaanza kumjibu tena!`);
                    }
                } else {
                    // Owner texts normally without trigger word — show help
                    await message.reply(
                        '🫡 Habari Boss! Mimi ni PatanaBot.\n\n' +
                        '*Amri za Admin:*\n' +
                        '📦 *STOO:* _Ongeza/badili bidhaa_\n' +
                        '📦 *UPDATE:* _Sasisha bei_\n' +
                        '⏸️ *ZIMA:* _Zima bot kwa mteja (uchukue wewe)_\n' +
                        '▶️ *WASHA:* _Washa bot (WOTE au namba)_\n\n' +
                        'Mfano:\n' +
                        '_STOO: Ongeza TV nchi 32, bei 300K mwisho 280K_\n' +
                        '_ZIMA: 255743726397_ (uzime bot, uongee mwenyewe)\n' +
                        '_WASHA: WOTE_ (washa bot kwa wateja wote)\n\n' +
                        'Au tuma Excel file 📋'
                    );
                }
            }

            return; // CRITICAL: Stop processing so the owner isn't treated as a customer!
        }

        // ============================================================
        // CUSTOMER MESSAGE HANDLING (below this point = customers only)
        // ============================================================

        // Extract the real phone number
        const contact = await message.getContact();
        const userPhone = contact.number;

        // --- Check Human Override: is the bot paused for this customer? ---
        if (!isBotActive(userPhone)) {
            console.log(`⏸️ [PAUSED] Ignoring message from ${userPhone} — owner is handling`);
            return;
        }

        // --- Anti-Spam: Rate Limiter ---
        const now = Date.now();
        const lastTime = lastMessageTime.get(userPhone) || 0;
        if (now - lastTime < COOLDOWN_MS) {
            console.log(`🛡️ [RATE LIMIT] Ignoring rapid message from ${userPhone} (${Math.round((now - lastTime) / 1000)}s < ${COOLDOWN_MS / 1000}s)`);
            return;
        }
        lastMessageTime.set(userPhone, now);

        const text = message.body.trim();

        // --- Download media if present (images, voice notes, videos) ---
        let media = null;
        if (message.hasMedia) {
            try {
                media = await message.downloadMedia();
                console.log(`📎 [MEDIA] ${media.mimetype} received from ${userPhone}`);
            } catch (err) {
                console.error(`❌ Media download failed for ${userPhone}:`, err.message);
            }
        }

        // Skip if no text AND no media
        if (!text && !media) return;

        console.log(`\n📩 [${userPhone}]: ${text || '[Media Only]'}`);

        // --- DEMO HOOK ---
        if (text.toUpperCase() === 'DEMO') {
            const demoReply = `Habari Boss! 👋 Mimi ni PatanaBot Enterprise — Muuzaji wa AI anayefanya kazi 24/7.\n\n🧠 Ninajua kupatana bei (negotiate)\n📸 Ninapokea picha za bidhaa\n🎤 Ninaelewa voice notes\n📋 Mmiliki anaweza kutuma Excel au kuandika "STOO:" kubadili bei\n💰 Ninafunga oda automatically\n\nTuigize: Tuma picha ya simu au uliza bei ya AirPods uone ninavyofanya biashara!`;
            await message.reply(demoReply);
            console.log(`🎯 [DEMO] → ${userPhone}`);
            return;
        }

        // --- AI Response (Multimodal: text + image/audio) ---
        let aiResponse = await generateResponse(userPhone, text, media);

        // --- ESCALATION Interceptor ---
        if (ESCALATE_TAG_REGEX.test(aiResponse)) {
            aiResponse = aiResponse.replace(ESCALATE_TAG_REGEX, '').trim();

            await message.reply('Nimekuelewa boss, ngoja niongee na Meneja wangu mara moja. Nipe sekunde mbili... 🙏');

            pauseBot(userPhone);

            if (OWNER_PHONE) {
                await client.sendMessage(
                    OWNER_PHONE,
                    `⚠️ *ESCALATION ALERT*\n\nBoss, Mteja +${userPhone} anahitaji msaada wako haraka!\nNimejizima kwa mteja huyu, tafadhali chukua usukani.\n\nMeseji yake ya mwisho: "${text || '[Media]'}"`
                );
            }

            console.log(`🚨 [ESCALATED] ${userPhone} → Owner notified, bot paused`);
            return;
        }

        // --- ORDER CLOSED Interceptor ---
        const orderMatch = aiResponse.match(ORDER_TAG_REGEX);
        if (orderMatch) {
            const [fullTag, item, price, location] = orderMatch;
            saveOrder(userPhone, item.trim(), price.trim(), location.trim());
            aiResponse = aiResponse.replace(fullTag, '').trim();
            console.log(`✅ [ORDER CLOSED] ${item} @ ${price} → ${location}`);
        }

        // --- OUT OF STOCK Interceptor ---
        const oosMatch = aiResponse.match(OOS_TAG_REGEX);
        if (oosMatch) {
            const [fullTag, item] = oosMatch;
            saveMissedOpportunity(item.trim());
            aiResponse = aiResponse.replace(fullTag, '').trim();
            console.log(`📉 [OUT OF STOCK] "${item}" — logged as missed opportunity`);
        }

        // Reply to the customer
        await message.reply(aiResponse);
        console.log(`🤖 [PatanaBot → ${userPhone}]: ${aiResponse.substring(0, 80)}...`);
    } catch (error) {
        console.error('❌ Message handling error:', error.message);
    }
});

// ============================================================
// DAILY INTELLIGENCE REPORT (Cron Job — 8:00 PM EAT)
// ============================================================
cron.schedule('0 20 * * *', async () => {
    try {
        if (!OWNER_PHONE) {
            console.log('⚠️ OWNER_PHONE not set — skipping daily report');
            return;
        }

        const summary = getDailySummary();

        const report =
            `📊 *RIPOTI YA LEO YA PATANABOT* 📊\n\n` +
            `✅ Oda Zilizofungwa: ${summary.orderCount}\n` +
            `💰 Thamani ya Mauzo: TZS ${summary.totalRevenue.toLocaleString()}\n` +
            `📉 Bidhaa Zinazotafutwa (Zilete Stoo Kesho): ${summary.missedItems}\n\n` +
            `Endelea kupumzika boss, mimi nipo zamu usiku kucha! 🤖💼`;

        await client.sendMessage(OWNER_PHONE, report);
        console.log('📊 [DAILY REPORT] Sent to owner');
    } catch (error) {
        console.error('❌ Daily report error:', error.message);
    }
}, {
    timezone: 'Africa/Dar_es_Salaam',
});

// --- Initialize Client ---
console.log('\n🔄 Initializing PatanaBot Enterprise...');
client.initialize();
