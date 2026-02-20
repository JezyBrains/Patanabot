import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { generateResponse } from './ai.js';
import { saveOrder, pauseBot, isBotActive, saveMissedOpportunity, getDailySummary } from './db.js';
import { shopName } from './shop.js';
import { updateInventoryFromExcel } from './inventory.js';

dotenv.config();

const OWNER_PHONE = process.env.OWNER_PHONE || '';

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
    console.log('📋 Excel Inventory Upload: ENABLED');
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

// ============================================================
// HUMAN OVERRIDE: Owner replies → bot steps aside permanently
// ============================================================
client.on('message_create', async (message) => {
    try {
        if (!message.fromMe) return;
        if (message.to.includes('@g.us')) return;

        const customerChatId = message.to;
        const customerPhone = customerChatId.replace('@c.us', '');

        pauseBot(customerPhone);
        console.log(`👤 [OWNER TAKEOVER] Bot paused for ${customerPhone} — owner is handling directly`);
    } catch (error) {
        console.error('❌ Human override error:', error.message);
    }
});

// ============================================================
// MAIN MESSAGE HANDLER (Incoming Messages)
// ============================================================
client.on('message', async (message) => {
    try {
        // Ignore group messages
        if (message.from.includes('@g.us')) return;

        // --- OWNER ADMIN: Excel Inventory Upload (checked FIRST) ---
        const isOwner = (message.from === OWNER_PHONE);

        if (isOwner && message.hasMedia) {
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

                return; // CRITICAL: Don't send Excel to AI
            }
        }

        // Extract the real phone number
        const contact = await message.getContact();
        const userPhone = contact.number;

        // --- Check Human Override: is the bot paused for this customer? ---
        if (!isBotActive(userPhone)) {
            console.log(`⏸️ [PAUSED] Ignoring message from ${userPhone} — owner is handling`);
            return;
        }

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
            const demoReply = `Habari Boss! 👋 Mimi ni PatanaBot Enterprise — Muuzaji wa AI anayefanya kazi 24/7.\n\n🧠 Ninajua kupatana bei (negotiate)\n📸 Ninapokea picha za bidhaa\n🎤 Ninaelewa voice notes\n📋 Mmiliki anaweza kutuma Excel kubadili bei\n💰 Ninafunga oda automatically\n\nTuigize: Tuma picha ya simu au uliza bei ya AirPods uone ninavyofanya biashara!`;
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
