import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia, Location } = pkg;
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateResponse } from './ai.js';
import { textToVoiceNote, isVoiceEnabled } from './tts.js';
import { parseMpesaText, verifyReceiptImage, validateReceipt, isMpesaText } from './receipt.js';
import { loadProfile } from './shop.js';
import {
    saveOrder, pauseBot, isBotActive, resumeBot, resumeAllBots,
    saveMissedOpportunity, getDailySummary,
    getEscalationCount, incrementEscalation, resetEscalation,
    getCustomerRating, setCustomerRating, getCustomerProfile,
    addDriver, getDriverByName, listDrivers, removeDriver,
    createDelivery, getActiveDeliveryByCustomer, getActiveDeliveryByDriver,
    updateDeliveryStatus, getRecentOrderByPhone, getTokenUsageSummary,
} from './db.js';
import { shopName, getInventoryList, deductStock, restoreStock, getItemById, getInventoryIds, updatePaymentInfo, setPaymentPolicy, getPaymentPolicy, addQuickProduct, addProductImage, findItemByName } from './shop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { updateInventoryFromExcel, generateExcelTemplate, bulkImportFromText } from './inventory.js';
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
const PENDING_PAYMENT_TAG_REGEX = /\[PENDING_PAYMENT:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\]/;
const RECEIPT_TAG_REGEX = /\[RECEIPT_UPLOADED\]/;
const SEND_IMAGE_TAG_REGEX = /\[SEND_IMAGE:\s*([^\]]+)\]/;
const ALERT_TAG_REGEX = /\[ALERT:\s*(.+?)\s*\]/;
const OOS_TAG_REGEX = /\[OUT_OF_STOCK:\s*(.+?)\s*\]/;
const CHECK_STOCK_TAG_REGEX = /\[CHECK_STOCK:\s*(.+?)\s*\]/;
const TROLL_TAG_REGEX = /\[TROLL\]/;
const DRIVER_STATUS_TAG_REGEX = /\[DRIVER_STATUS\]/;

// --- Pending Payments: Awaiting M-Pesa receipts ---
// phone → { itemId, price, location, timestamp }
const pendingPayments = new Map();

// --- Driver live locations ---
// driverPhone → { lat, lng, timestamp, customerPhone }
const driverLocations = new Map();

// --- Last product owner interacted with (for captionless photo attach) ---
let lastOwnerProduct = null;

// --- Message Accumulator: Buffer rapid messages, then process together ---
const MESSAGE_BUFFER_MS = 3000; // Wait 3 seconds for more messages before processing
const messageBuffers = new Map(); // chatKey → { texts: [], media: null, timer, message, isVoice }
const recentMessageIds = new Set();

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
                        `❌ BIDHAA HAINA: ${item}. Boss hajajibu kwa muda.
SHERIA KALI: Kama kuna bidhaa nyingine katika CATEGORY ILE ILE (simu kwa simu, laptop kwa laptop) inayolingana na bajeti ya mteja, mpe ofa kwa heshima.
KAMA HAKUNA bidhaa kwenye category hiyo inayotosha bajeti yake, MUAGE KWA HESHIMA — "Samahani boss, kwa sasa hii haipatikani. Ukihitaji kitu kingine nipo hapa!"
ONYO KALI: USIMPE bidhaa tofauti (earphones/charger kwa mtu anayetaka simu = DHARAU!)`
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
        if (message.from.includes('@g.us')) return; // skip groups
        if (message.from.includes('@broadcast')) return; // skip broadcasts
        if (message.from === 'status@broadcast') return; // skip status updates
        if (message.isStatus) return; // skip any status messages
        if (message.fromMe) return; // skip self-sent messages
        if (message.type === 'e2e_notification' || message.type === 'notification_template') return;
        if (message.type === 'protocol') return; // skip protocol messages

        // Dedup: WhatsApp sometimes fires same message twice
        const msgId = message.id?._serialized || message.id?.id || `${message.from}_${message.timestamp}`;
        if (recentMessageIds.has(msgId)) {
            console.log(`🔁 [DEDUP] Dropped duplicate: ${msgId.slice(-12)} from ${message.from.slice(0, 6)}`);
            return;
        }
        recentMessageIds.add(msgId);
        setTimeout(() => recentMessageIds.delete(msgId), 15000);

        // Debug: log every message that passes filters
        console.log(`📨 [INTAKE] type=${message.type} from=${message.from.slice(0, 6)} hasMedia=${message.hasMedia} body="${(message.body || '').slice(0, 40)}"`);

        const senderPhone = message.from.replace(/@c\.us$/, '');

        // ============================================================
        // DRIVER LOCATION HANDLER — intercept live location from drivers
        // ============================================================
        if (message.type === 'location' || message.type === 'live_location') {
            const delivery = getActiveDeliveryByDriver(senderPhone);
            if (delivery) {
                const lat = message.location?.latitude || message.lat;
                const lng = message.location?.longitude || message.lng;
                if (lat && lng) {
                    driverLocations.set(senderPhone, {
                        lat, lng, timestamp: Date.now(), customerPhone: delivery.customer_phone,
                    });

                    // Forward location to customer
                    try {
                        const loc = new Location(lat, lng, `📍 ${delivery.driver_name} - anakuletea order yako`);
                        await client.sendMessage(`${delivery.customer_phone}@c.us`, loc);
                        console.log(`📍 [LOCATION] ${delivery.driver_name} → ${delivery.customer_phone} (${lat}, ${lng})`);
                    } catch (locErr) {
                        // Fallback: send as text if Location class not available
                        await client.sendMessage(`${delivery.customer_phone}@c.us`,
                            `📍 *Location ya driver (${delivery.driver_name}):*\nhttps://maps.google.com/maps?q=${lat},${lng}\n\n_Updated sasa hivi_`
                        );
                        console.log(`📍 [LOCATION TEXT] ${delivery.driver_name} → ${delivery.customer_phone}`);
                    }

                    // Update delivery status to in_transit
                    if (delivery.status === 'dispatched') {
                        updateDeliveryStatus(delivery.id, 'in_transit');
                    }
                    return; // Don't process location messages further
                }
            }
        }

        // Driver says "delivered" or "nimefika" — mark delivery complete
        if (/^(?:delivered|nimefika|nimewasili|imefikia)$/i.test((message.body || '').trim())) {
            const delivery = getActiveDeliveryByDriver(senderPhone);
            if (delivery) {
                updateDeliveryStatus(delivery.id, 'delivered');
                driverLocations.delete(senderPhone);

                await client.sendMessage(`${delivery.customer_phone}@c.us`,
                    `✅ *Order yako imefika!*\nDriver ${delivery.driver_name} amewasili. Karibu tena.`
                );
                await message.reply(`✅ Delivery imekamilika! Customer ${delivery.customer_phone} amefahamishwa.`);
                if (OWNER_PHONE) {
                    await client.sendMessage(OWNER_PHONE,
                        `✅ *DELIVERED:* ${delivery.item} → +${delivery.customer_phone} (Driver: ${delivery.driver_name})`
                    );
                }
                console.log(`✅ [DELIVERED] ${delivery.item} → ${delivery.customer_phone} by ${delivery.driver_name}`);
                return;
            }
        }

        // ============================================================
        // OWNER ADMIN PANEL
        // ============================================================
        const isOwner = (message.from === OWNER_PHONE);

        if (isOwner) {
            if (message.hasMedia) {
                const media = await message.downloadMedia();
                const caption = (message.body || '').trim();
                const upperCaption = caption.toUpperCase();

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
                        const result = updateInventoryFromExcel(media.data);
                        await message.reply(`✅ Excel imesomwa! 📦\n\n📥 Mpya: ${result.added}\n🔄 Zimesasishwa: ${result.updated}\n📦 Jumla: ${result.total}`);
                    } catch (err) {
                        console.error('❌ Excel error:', err.message);
                        await message.reply(`❌ ${err.message}`);
                    }

                    // --- Owner IMAGE: Quick-add OR add photo to existing ---
                } else if (media.mimetype && media.mimetype.includes('image')) {
                    const { writeFile } = await import('fs/promises');

                    if (upperCaption.startsWith('PICHA:') || upperCaption.startsWith('PICHA ')) {
                        // Add more photos to existing product — fuzzy name match
                        const query = caption.replace(/^picha[:\s]+/i, '').trim();
                        const item = findItemByName(query);
                        if (item) {
                            const existing = Array.isArray(item.images) ? item.images.length : 0;
                            const ext = media.mimetype.includes('png') ? 'png' : 'jpg';
                            const fileName = `${item.id}_${existing + 1}.${ext}`;
                            await writeFile(join(__dirname, '..', 'data', 'images', fileName), Buffer.from(media.data, 'base64'));
                            addProductImage(item.id, fileName);
                            lastOwnerProduct = item.id;
                            await message.reply(`✅ Picha #${existing + 1} ya *${item.item}* imehifadhiwa! 📸`);
                        } else {
                            await message.reply(`❌ "${query}" haipo. Jaribu jina lingine.`);
                        }

                    } else if (caption && caption.includes(',')) {
                        // Quick-add: "name, price, qty, unit"
                        const parts = caption.split(',').map(p => p.trim());
                        if (parts.length >= 3) {
                            const name = parts[0];
                            const floorPrice = parseInt(parts[1].replace(/\D/g, ''));
                            const stockQty = parseInt(parts[2]);
                            const unit = parts[3] || '';
                            if (!name || isNaN(floorPrice) || isNaN(stockQty)) {
                                await message.reply('❌ _Mfano: Maji ya Uhai, 12000, 15, carton of 12_');
                                return;
                            }
                            const { item, isNew } = addQuickProduct(name, floorPrice, stockQty, unit);
                            const ext = media.mimetype.includes('png') ? 'png' : 'jpg';
                            const existing = Array.isArray(item.images) ? item.images.length : 0;
                            const fileName = `${item.id}_${existing + 1}.${ext}`;
                            await writeFile(join(__dirname, '..', 'data', 'images', fileName), Buffer.from(media.data, 'base64'));
                            addProductImage(item.id, fileName);
                            lastOwnerProduct = item.id;
                            await message.reply(
                                `✅ *${item.item}* ${isNew ? 'imeongezwa' : 'imesasishwa'}! 📦📸\n\n` +
                                `🆔 ID: ${item.id}\n💰 Bei: TZS ${item.public_price.toLocaleString()}\n` +
                                `🔒 Floor: TZS ${item.secret_floor_price.toLocaleString()}\n📦 Stock: ${stockQty}\n` +
                                (unit ? `📏 Unit: ${unit}\n` : '') +
                                `\n_Picha zaidi? Tuma picha tu — zitaongezwa hapa._`
                            );
                        } else {
                            await message.reply('❌ _Mfano: Maji ya Uhai, 12000, 15, carton of 12_');
                        }

                    } else if (caption) {
                        // Caption with no comma and no picha: — try matching as product name for extra photo
                        const item = findItemByName(caption);
                        if (item) {
                            const existing = Array.isArray(item.images) ? item.images.length : 0;
                            const ext = media.mimetype.includes('png') ? 'png' : 'jpg';
                            const fileName = `${item.id}_${existing + 1}.${ext}`;
                            await writeFile(join(__dirname, '..', 'data', 'images', fileName), Buffer.from(media.data, 'base64'));
                            addProductImage(item.id, fileName);
                            lastOwnerProduct = item.id;
                            await message.reply(`✅ Picha #${existing + 1} ya *${item.item}* imehifadhiwa! 📸`);
                        } else {
                            await message.reply(
                                `📸 *Ongeza bidhaa:* Picha + caption:\n` +
                                `_Samsung S24, 1200000, 3, Brand New 256GB_\n\n` +
                                `*Picha zaidi:* Picha + jina la bidhaa\n\n` +
                                `Format: _jina, bei ya kununua, stock, maelezo_`
                            );
                        }
                    } else {
                        // No caption — auto-attach to last product
                        if (lastOwnerProduct) {
                            const item = getItemById(lastOwnerProduct);
                            if (item) {
                                const existing = Array.isArray(item.images) ? item.images.length : 0;
                                const ext = media.mimetype.includes('png') ? 'png' : 'jpg';
                                const fileName = `${item.id}_${existing + 1}.${ext}`;
                                await writeFile(join(__dirname, '..', 'data', 'images', fileName), Buffer.from(media.data, 'base64'));
                                addProductImage(item.id, fileName);
                                await message.reply(`✅ Picha #${existing + 1} ya *${item.item}* imeongezwa! 📸\n_Endelea kutuma picha au andika jina jipya._`);
                                return;
                            }
                        }
                        await message.reply(
                            `📸 *Ongeza bidhaa:* Picha + caption:\n` +
                            `_Samsung S24, 1200000, 3, Brand New 256GB_\n\n` +
                            `*Picha zaidi:* Tuma picha tu bila caption`
                        );
                    }
                }
            } else {
                const text = message.body.trim();
                const upper = text.toUpperCase();

                // --- BIDHAA: List inventory ---
                if (upper === 'BIDHAA' || upper === 'STOO' || upper === 'LIST') {
                    await message.reply(getInventoryList());

                    // --- TEMPLATE: Send Excel template ---
                } else if (upper === 'TEMPLATE' || upper === 'FOMU') {
                    const templateBuf = generateExcelTemplate();
                    const media = new MessageMedia('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', templateBuf.toString('base64'), 'PatanaBot_Bidhaa_Template.xlsx');
                    await client.sendMessage(message.from, media, {
                        caption: `📋 *Excel Template ya Bidhaa*\n\nJaza na utume hapa. Columns:\n• *Bidhaa* — Jina la bidhaa\n• *Brand* — Samsung, Apple, JBL...\n• *Tier* — Premium, Mid-Range, Budget\n• *Hali* — Brand New, Used, 128GB...\n• *Bei_Kununua* — Bei yako ya kununua\n• *Bei_Kuuza* — Bei ya kuuzia mteja\n• *Stock* — Kiasi kilichopo\n• *Features* — Sifa (kamera, betri...)\n\n_Futa mifano na weka bidhaa zako!_`
                    });

                    // --- ONGEZA: Bulk text import ---
                } else if (upper.startsWith('ONGEZA:')) {
                    const body = text.substring(7).trim();
                    if (!body) {
                        await message.reply(
                            `📝 *Ongeza bidhaa nyingi:*\n\n` +
                            `Andika kila bidhaa mstari wake:\n` +
                            `_ongeza:_\n` +
                            `_Samsung A54, 480000, 5, Brand New 128GB_\n` +
                            `_iPhone 11, 300000, 1, Used 64GB_\n` +
                            `_Oraimo Earbuds, 25000, 10, Brand New_\n\n` +
                            `Format: _jina, bei ya kununua, stock, hali_`
                        );
                        return;
                    }
                    try {
                        const result = bulkImportFromText(body);
                        await message.reply(`✅ Bidhaa zimesasishwa! 📦\n\n📥 Mpya: ${result.added}\n🔄 Zimesasishwa: ${result.updated}\n📦 Jumla: ${result.total}`);
                    } catch (err) {
                        console.error('❌ Bulk import error:', err.message);
                        await message.reply(`❌ ${err.message}`);
                    }

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

                    // --- MALIPO: Set payment info ---
                } else if (upper.startsWith('MALIPO:')) {
                    const info = text.substring(7).trim();
                    if (info) {
                        updatePaymentInfo(info);
                        await message.reply(`✅ Payment info imesasishwa!\n\n💰 *Malipo Mapya:*\n${info}`);
                    } else {
                        await message.reply('❌ Mfano: _malipo: M-Pesa 0686479877 (Jina: Duka Langu). Pia tunapokea Tigo Pesa._');
                    }

                    // --- SERA: Set payment policy ---
                } else if (upper.startsWith('SERA:') || upper === 'SERA') {
                    const policy = text.substring(text.indexOf(':') + 1).trim().toLowerCase();
                    if (policy === 'kwanza' || policy === 'pay first' || policy === 'lipa kwanza') {
                        setPaymentPolicy('pay_first');
                        await message.reply('✅ Sera: Mteja ANALIPA KWANZA kabla ya kupokea mzigo.\n_Bot itamuomba screenshot ya muamala._');
                    } else if (policy === 'baadaye' || policy === 'cod' || policy === 'lipa baadaye') {
                        setPaymentPolicy('pay_on_delivery');
                        await message.reply('✅ Sera: Mteja ANALIPA BAADA ya kupokea na kukagua mzigo.\n_Bot itakamata order bila kusubiri receipt._');
                    } else {
                        const current = getPaymentPolicy() === 'pay_first' ? 'Lipa Kwanza' : 'Lipa Baadaye (COD)';
                        await message.reply(`📋 *Sera ya Malipo Sasa:* ${current}\n\nBadilisha:\n_sera: kwanza_ — Mteja analipa kabla\n_sera: baadaye_ — Mteja analipa akipokea`);
                    }

                    // --- MSAADA: Help menu ---
                } else if (upper === 'MSAADA' || upper === 'HELP') {
                    await message.reply(
                        `📋 *AMRI ZA BOSS*\n${'━'.repeat(30)}\n\n` +
                        `📦 *bidhaa* — Ona stoo yote\n` +
                        `📝 *stoo:* ongeza/futa bidhaa\n` +
                        `📥 *ongeza:* Ongeza bidhaa nyingi (text)\n` +
                        `📋 *template* — Pata Excel template\n` +
                        `💰 *malipo:* Weka M-Pesa/bank\n` +
                        `📋 *sera:* Lipa kwanza/baadaye\n` +
                        `📸 Tuma picha + jina,bei,stock,hali\n` +
                        `⏸️ *zima:* Simamisha bot kwa mteja\n` +
                        `▶️ *washa:* Rudisha bot\n` +
                        `⭐ *rate:* Pima mteja (1-5)\n` +
                        `👤 *profile:* Tazama mteja\n` +
                        `✅ *thibitisha* — Malipo OK\n` +
                        `❌ *kataa* — Malipo hayajaingia\n` +
                        `✅ *ndiyo* — Stock check ipo\n` +
                        `❌ *hapana* — Stock check haipo`
                    );

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

                    // --- Owner reply: THIBITISHA/KATAA for payment verification ---
                } else if (pendingPayments.size > 0 && (upper === 'THIBITISHA' || upper === 'KATAA')) {
                    let targetPhone = null;
                    if (message.hasQuotedMsg) {
                        try {
                            const quoted = await message.getQuotedMessage();
                            const phoneMatch = quoted.body.match(/\+(\d{12})/);
                            if (phoneMatch) targetPhone = phoneMatch[1];
                        } catch { }
                    }
                    if (!targetPhone) targetPhone = [...pendingPayments.keys()].pop();

                    const pending = pendingPayments.get(targetPhone);
                    if (!pending) {
                        await message.reply('❌ Hakuna malipo yanayosubiri.');
                        return;
                    }

                    if (upper === 'THIBITISHA') {
                        pendingPayments.delete(targetPhone);
                        const item = getItemById(pending.itemId);
                        const itemName = item ? item.item : pending.itemId;
                        saveOrder(targetPhone, itemName, pending.price, pending.location);

                        // Boost customer rating
                        const currentRating = getCustomerRating(targetPhone);
                        if (currentRating < 5) setCustomerRating(targetPhone, Math.min(5, currentRating + 1));

                        // Confirm to customer + upsell
                        const confirmMsg = await generateResponse(
                            targetPhone,
                            `🔑 MAELEKEZO YA BOSS: Malipo ya "${itemName}" yamethibitishwa! Mwambie mteja "Asante boss, malipo yameingia! Mzigo wako utatoka leo." Kisha pendekeza bidhaa nyingine inayoendana na "${itemName}" kama upsell.`
                        );
                        let clean = confirmMsg.replace(PENDING_PAYMENT_TAG_REGEX, '').replace(ALERT_TAG_REGEX, '').trim();
                        await client.sendMessage(`${targetPhone}@c.us`, clean);
                        await message.reply(`✅ Order imefungwa! ${targetPhone} — "${itemName}" @ TZS ${pending.price}`);
                        console.log(`✅ [ORDER CLOSED] ${itemName} @ TZS ${pending.price} → ${pending.location}`);
                    } else {
                        // KATAA — payment rejected, restore stock
                        restoreStock(pending.itemId);
                        pendingPayments.delete(targetPhone);

                        const rejectMsg = await generateResponse(
                            targetPhone,
                            `🔑 MAELEKEZO YA BOSS: Malipo ya mteja HAYAKUINGIA. Mwambie kwa upole: "Boss, malipo bado hayajaingia. Jaribu tena au tuma screenshot mpya." Usimfukuze — mshike kwa upole.`
                        );
                        let clean = rejectMsg.replace(PENDING_PAYMENT_TAG_REGEX, '').replace(ALERT_TAG_REGEX, '').trim();
                        await client.sendMessage(`${targetPhone}@c.us`, clean);
                        await message.reply(`❌ Malipo ya ${targetPhone} yamekataliwa. Stock imerejeshwa.`);
                        console.log(`❌ [PAYMENT REJECTED] ${targetPhone} — stock restored`);
                    }

                    // --- Owner: DELIVER command → dispatch order to driver ---
                } else if (/^deliver\s+/i.test(text)) {
                    // Format: deliver 255xxx drivername  OR  deliver drivername (uses last confirmed order)
                    const deliverMatch = text.match(/^deliver\s+(\d{9,15})\s+(.+)$/i)
                        || text.match(/^deliver\s+(.+)$/i);

                    if (!deliverMatch) {
                        await message.reply('📝 Format: *deliver 255xxx jina_la_driver*\nMfano: deliver 255743726397 abduli');
                        return;
                    }

                    let customerPhone, driverName;
                    if (deliverMatch[2]) {
                        customerPhone = deliverMatch[1];
                        driverName = deliverMatch[2].trim();
                    } else {
                        // Only driver name given — use last pending payment
                        driverName = deliverMatch[1].trim();
                        customerPhone = [...pendingPayments.keys()].pop();
                        if (!customerPhone) {
                            await message.reply('❌ Hakuna order. Tumia: deliver 255xxx drivername');
                            return;
                        }
                    }

                    const driver = getDriverByName(driverName);
                    if (!driver) {
                        const allDrivers = listDrivers();
                        const driverList = allDrivers.length > 0
                            ? allDrivers.map(d => `- ${d.name} (${d.phone})`).join('\n')
                            : 'Hakuna driver. Ongeza kwanza: add driver jina namba';
                        await message.reply(`❌ Driver "${driverName}" haipo.\n\n📋 *Drivers:*\n${driverList}`);
                        return;
                    }

                    // Find order details
                    const pending = pendingPayments.get(customerPhone);
                    const recentOrder = getRecentOrderByPhone(customerPhone);
                    const item = pending ? (getItemById(pending.itemId)?.item || pending.itemId) : (recentOrder?.item_sold || 'Order');
                    const price = pending?.price || recentOrder?.agreed_price || '';
                    const location = pending?.location || recentOrder?.delivery_location || '';

                    // Create delivery record
                    createDelivery(customerPhone, driver.name, driver.phone, item, price, location, recentOrder?.id);

                    // Notify driver
                    await client.sendMessage(`${driver.phone}@c.us`,
                        `📦 *DELIVERY ASSIGNMENT:*\n` +
                        `🛍️ Bidhaa: ${item}\n` +
                        `📍 Location: ${location}\n` +
                        `👤 Customer: +${customerPhone}\n` +
                        `💰 Bei: TZS ${price}\n\n` +
                        `Tafadhali *share live location* hapa ili customer ajue uko wapi.`
                    );

                    // Notify customer
                    await client.sendMessage(`${customerPhone}@c.us`,
                        `🚗 *Order yako imetumwa!*\n\n` +
                        `📦 Bidhaa: ${item}\n` +
                        `🧑‍✈️ Driver: ${driver.name.charAt(0).toUpperCase() + driver.name.slice(1)}\n` +
                        `📞 Simu: ${driver.phone}\n\n` +
                        `Utapata location ya driver hivi karibuni.`
                    );

                    await message.reply(`✅ Dispatched! ${item} → ${driver.name} (${driver.phone}) → +${customerPhone}`);
                    console.log(`🚗 [DISPATCH] ${item} → driver: ${driver.name} → customer: ${customerPhone}`);

                    // --- Owner: ADD DRIVER ---
                } else if (/^add\s+driver\s+/i.test(text)) {
                    const driverMatch = text.match(/^add\s+driver\s+(\S+)\s+(\d{9,15})$/i);
                    if (!driverMatch) {
                        await message.reply('📝 Format: *add driver jina namba*\nMfano: add driver abduli 0712345678');
                        return;
                    }
                    addDriver(driverMatch[1], driverMatch[2]);
                    await message.reply(`✅ Driver "${driverMatch[1]}" (${driverMatch[2]}) ameongezwa.`);
                    console.log(`🚗 [DRIVER ADDED] ${driverMatch[1]} → ${driverMatch[2]}`);

                    // --- Owner: LIST DRIVERS ---
                } else if (upper === 'DRIVERS' || upper === 'MADEREVA') {
                    const allDrivers = listDrivers();
                    if (allDrivers.length === 0) {
                        await message.reply('📋 Hakuna driver. Ongeza: *add driver jina namba*');
                    } else {
                        const list = allDrivers.map((d, i) => `${i + 1}. ${d.name} — ${d.phone}`).join('\n');
                        await message.reply(`📋 *Drivers (${allDrivers.length}):*\n${list}`);
                    }

                    // --- Owner: REMOVE DRIVER ---
                } else if (/^remove\s+driver\s+/i.test(text)) {
                    const name = text.replace(/^remove\s+driver\s+/i, '').trim();
                    removeDriver(name);
                    await message.reply(`✅ Driver "${name}" ameondolewa.`);

                    // --- Owner: AI TOKEN USAGE ---
                } else if (upper === 'USAGE' || upper === 'TOKENS') {
                    const { allTime, todayUsage, totals } = getTokenUsageSummary();
                    let report = `📊 *AI TOKEN USAGE*\n\n`;
                    report += `*Jumla:* ${(totals?.total_input || 0).toLocaleString()} in / ${(totals?.total_output || 0).toLocaleString()} out (${totals?.requests || 0} requests)\n\n`;

                    if (todayUsage.length > 0) {
                        report += `*Leo:*\n`;
                        todayUsage.slice(0, 10).forEach((u, i) => {
                            report += `${i + 1}. +${u.phone} — ${u.total_input.toLocaleString()}/${u.total_output.toLocaleString()} (${u.requests} req)\n`;
                        });
                        report += `\n`;
                    }

                    if (allTime.length > 0) {
                        report += `*Top 10 (All Time):*\n`;
                        allTime.slice(0, 10).forEach((u, i) => {
                            report += `${i + 1}. +${u.phone} — ${u.total_input.toLocaleString()}/${u.total_output.toLocaleString()} (${u.requests} req)\n`;
                        });
                    }

                    // Estimate cost (Gemini 2.0 Flash pricing)
                    const totalIn = totals?.total_input || 0;
                    const totalOut = totals?.total_output || 0;
                    const estCost = ((totalIn * 0.10 / 1000000) + (totalOut * 0.40 / 1000000)).toFixed(4);
                    report += `\n💰 *Est. Cost:* ~$${estCost}`;

                    await message.reply(report);

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
                            `🔑 MAELEKEZO YA BOSS: Tumeipata "${check.item}"! Mwambie mteja habari njema — "${check.item}" ipo! Muulize kama anataka na mpe bei. MUHIMU: Zungumzia "${check.item}" TU — USITAJE bidhaa nyingine yoyote!`
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
        const chatKey = message.from; // Use message.from consistently (255xxx@c.us)

        // Check pause status
        if (!isBotActive(userPhone)) {
            console.log(`⏸️ [PAUSED] Ignoring ${userPhone} — owner handling`);
            return;
        }

        // Anti-troll: check if customer is in cooldown
        const now = Date.now();
        const trollExpiry = trollCooldown.get(userPhone);
        if (trollExpiry && now < trollExpiry) {
            console.log(`🚫 [TROLL COOLDOWN] ${userPhone} — ignored (${Math.round((trollExpiry - now) / 60000)}m left)`);
            return;
        }
        if (trollExpiry && now >= trollExpiry) {
            trollCooldown.delete(userPhone);
        }

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

        // Download media if present (with type/size validation)
        let media = null;
        const isVoiceNote = message.type === 'ptt' || message.type === 'audio';
        const ALLOWED_MEDIA_TYPES = ['image', 'ptt', 'audio', 'sticker'];
        const MAX_MEDIA_SIZE = 5 * 1024 * 1024; // 5MB

        if (message.hasMedia) {
            // Type whitelist — reject videos, documents, etc.
            if (!ALLOWED_MEDIA_TYPES.includes(message.type)) {
                console.log(`🚫 [MEDIA BLOCKED] type=${message.type} from ${userPhone} — not allowed`);
                await message.reply('Boss, ninapokea picha na voice notes tu. Video au documents siziwezi kusoma 🙏');
            } else {
                try {
                    media = await message.downloadMedia();
                    // Size check after download (WhatsApp doesn't expose size before)
                    const mediaSize = media?.data ? Buffer.byteLength(media.data, 'base64') : 0;
                    if (mediaSize > MAX_MEDIA_SIZE) {
                        console.log(`🚫 [MEDIA TOO LARGE] ${(mediaSize / 1024 / 1024).toFixed(1)}MB from ${userPhone}`);
                        media = null; // Discard — too large
                    } else {
                        console.log(`📎 [MEDIA] ${media.mimetype} ${(mediaSize / 1024).toFixed(0)}KB${isVoiceNote ? ' 🎤' : ''} from ${userPhone}`);
                    }
                } catch (err) {
                    console.error(`❌ Media download failed for ${userPhone}:`, err.message);
                }
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

        // --- Message Accumulator: Buffer rapid messages ---
        // If customer sends multiple texts quickly, collect them all before responding
        const existing = messageBuffers.get(chatKey);
        if (existing) {
            // Add to existing buffer
            if (text) existing.texts.push(text);
            if (media && !existing.media) existing.media = media;
            if (isVoiceNote) existing.isVoice = true;
            existing.message = message; // Keep latest message for reply
            clearTimeout(existing.timer);
            console.log(`📝 [BUFFER] +1 from ${userPhone} (${existing.texts.length} msgs buffered)`);
        } else {
            // Start new buffer
            messageBuffers.set(chatKey, {
                texts: text ? [text] : [],
                media: media || null,
                isVoice: isVoiceNote,
                message,
                timer: null,
            });
        }

        // Set timer — process after MESSAGE_BUFFER_MS of silence
        const buffer = messageBuffers.get(chatKey);
        buffer.timer = setTimeout(() => processBufferedMessages(chatKey), MESSAGE_BUFFER_MS);
        return; // Don't process yet — wait for buffer timeout

    } catch (error) {
        console.error('❌ Message handler error:', error.message);
    }
});

// ============================================================
// ON-DEMAND IMAGE SEARCH + DOWNLOAD (lazy caching)
// Uses DuckDuckGo → Bing → Google fallback chain
// ============================================================

/** Search DuckDuckGo Images (no API key, lenient rate limits) */
async function searchDuckDuckGo(query, count = 5) {
    // Step 1: Get vqd token
    const tokenResp = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    });
    const tokenHtml = await tokenResp.text();
    const vqdMatch = tokenHtml.match(/vqd=['"]([^'"]+)['"]/);
    if (!vqdMatch) throw new Error('No DDG token');

    // Step 2: Fetch image results
    const imgResp = await fetch(
        `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqdMatch[1]}&f=,,,,,&p=1`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Referer': 'https://duckduckgo.com/' } }
    );
    if (!imgResp.ok) throw new Error(`DDG returned ${imgResp.status}`);

    const data = await imgResp.json();
    return (data.results || [])
        .filter(r => r.image && !r.image.includes('gstatic') && r.width > 200)
        .slice(0, count)
        .map(r => r.image);
}

/** Search Bing Images (fallback, no API key) */
async function searchBingImages(query, count = 5) {
    const resp = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&first=1`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html',
        },
    });
    if (!resp.ok) throw new Error(`Bing returned ${resp.status}`);

    const html = await resp.text();
    const urls = [];
    // Bing embeds image URLs in murl parameter
    const regex = /murl&quot;:&quot;(https?:\/\/[^&]+\.(?:jpg|jpeg|png|webp)[^&]*)&quot;/gi;
    let match;
    while ((match = regex.exec(html)) !== null && urls.length < count) {
        const url = decodeURIComponent(match[1]);
        if (url.length < 500) urls.push(url);
    }
    return urls;
}

async function searchAndDownloadImages(item, count = 3) {
    const imagesDir = join(__dirname, '..', 'data', 'images');
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(imagesDir, { recursive: true });

    const searchQuery = `${item.brand || ''} ${item.item} product photo`.trim();

    // Try search engines in order: DuckDuckGo → Bing → Google
    let urls = [];
    const engines = [
        { name: 'DuckDuckGo', fn: () => searchDuckDuckGo(searchQuery, count + 2) },
        { name: 'Bing', fn: () => searchBingImages(searchQuery, count + 2) },
    ];

    for (const engine of engines) {
        try {
            urls = await engine.fn();
            if (urls.length > 0) {
                console.log(`   🔍 ${engine.name}: found ${urls.length} images`);
                break;
            }
        } catch (err) {
            console.log(`   ⚠️ ${engine.name} failed: ${err.message}`);
        }
    }

    if (urls.length === 0) throw new Error('All search engines failed');

    const downloaded = [];
    for (let i = 0; i < Math.min(urls.length, count); i++) {
        const url = urls[i];
        const ext = url.includes('.png') ? 'png' : 'jpg';
        const fileName = `${item.id}_${i + 1}.${ext}`;
        const filePath = join(imagesDir, fileName);

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const imgResp = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
                redirect: 'follow',
            });
            clearTimeout(timeout);

            if (!imgResp.ok) continue;
            const buffer = Buffer.from(await imgResp.arrayBuffer());
            if (buffer.length < 2000) continue;

            writeFileSync(filePath, buffer);
            downloaded.push(fileName);
            console.log(`   ✅ ${fileName} (${(buffer.length / 1024).toFixed(0)}KB)`);
        } catch { /* skip failed download */ }
    }

    // Cache: update product's images array in shop_profile.json
    if (downloaded.length > 0) {
        try {
            const { saveProfile } = await import('./shop.js');
            const shopData = loadProfile();
            const product = shopData.inventory.find(p => p.id === item.id);
            if (product) {
                product.images = downloaded;
                saveProfile(shopData);
                console.log(`💾 [CACHED] ${item.id} → ${downloaded.length} images saved`);
            }
        } catch { /* save failed — images still on disk */ }
    }

    return downloaded;
}

// ============================================================
// PROCESS BUFFERED MESSAGES (with typing indicator + human delay)
// ============================================================
async function processBufferedMessages(chatKey) {
    const buffer = messageBuffers.get(chatKey);
    if (!buffer) return;
    messageBuffers.delete(chatKey);

    const { texts, media, isVoice, message } = buffer;
    const combinedText = texts.join('\n');

    if (!combinedText && !media) return;

    try {
        const contact = await message.getContact();
        const userPhone = contact.number;
        const profile = getCustomerProfile(userPhone);

        if (texts.length > 1) {
            console.log(`📦 [COMBINED] ${texts.length} msgs from ${userPhone}: "${combinedText.slice(0, 60)}"`);
        }

        // Show "typing..." indicator
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // ============================================================
        // PRE-AI RECEIPT INTERCEPTION — Check BEFORE sending to AI
        // AUTO-DENY: wrong name, old receipt → instant customer feedback
        // FORWARD: name ✓ + time ✓ but amount mismatch → send to owner
        // VERIFIED: name ✓ + time ✓ + amount ✓ → send to owner
        // ============================================================
        const pending = pendingPayments.get(userPhone);

        // Helper: handle receipt validation result
        const handleReceiptResult = async (receipt, receiptMedia) => {
            const shopData = loadProfile();
            const result = validateReceipt(receipt, pending, shopData.payment_info);

            if (result.action === 'DENY') {
                // Auto-deny: tell customer immediately, do NOT bother owner
                await chat.clearState();
                await message.reply(result.reason);
                console.log(`🧾 [DENIED] ${userPhone} → ${result.reason.slice(0, 60)}`);
                return true;
            }

            // FORWARD or VERIFIED → send to owner
            if (OWNER_PHONE) {
                let report = `🧾 *${result.action === 'VERIFIED' ? 'MALIPO YAMETHIBITISHWA' : 'MALIPO — KAGUA'}:*\n`;
                report += `👤 +${userPhone} (${profile.label})\n`;
                if (pending) {
                    const item = getItemById(pending.itemId);
                    report += `📦 Bidhaa: ${item ? item.item : pending.itemId}\n`;
                    report += `💰 Bei iliyokubalika: TZS ${pending.price}\n`;
                }
                if (receipt.transactionId) report += `🔢 TxID: ${receipt.transactionId}\n`;
                if (receipt.amount) report += `💵 Kiasi kilicholipwa: TZS ${receipt.amount.toLocaleString()}\n`;
                if (receipt.recipient) report += `👤 Aliyepokea: ${receipt.recipient}\n`;
                if (receipt.date) report += `📅 Tarehe: ${receipt.date}\n`;

                if (result.action === 'VERIFIED') {
                    report += `\n✅ *Kiasi, jina na muda vinafanana*`;
                } else {
                    report += `\n⚠️ *Angalia:* ${result.reason}`;
                }
                report += `\n\n_Jibu THIBITISHA au KATAA_`;

                if (receiptMedia) {
                    await client.sendMessage(OWNER_PHONE, receiptMedia, { caption: report });
                } else {
                    await client.sendMessage(OWNER_PHONE, report);
                }
            }

            await chat.clearState();
            await message.reply(result.reason);
            console.log(`🧾 [${result.action}] ${userPhone} → TxID: ${receipt.transactionId || 'N/A'}`);
            return true;
        };

        // 1. Text receipt (forwarded M-Pesa confirmation)
        if (isMpesaText(combinedText)) {
            console.log(`🧾 [RECEIPT TEXT] Detected M-Pesa text from ${userPhone}`);
            const parsed = parseMpesaText(combinedText);
            if (parsed) {
                await handleReceiptResult(parsed, null);
                return;
            }
        }

        // 2. Image receipt (screenshot of M-Pesa app or payment confirmation)
        if (media && media.mimetype?.includes('image')) {
            const receiptData = await verifyReceiptImage(media.data, media.mimetype);
            if (receiptData) {
                console.log(`🧾 [RECEIPT IMAGE] Detected payment screenshot from ${userPhone}`);
                const imgMedia = new MessageMedia(media.mimetype, media.data, 'receipt.jpg');
                await handleReceiptResult(receiptData, imgMedia);
                return;
            }
            // Not a receipt image — falls through to AI
        }

        // --- Input length validation (prevent token abuse / Economic DoS) ---
        const MAX_MSG_LENGTH = 1000;
        let safeText = combinedText;
        if (safeText.length > MAX_MSG_LENGTH) {
            console.log(`⚠️ [TRUNCATED] ${userPhone} sent ${safeText.length} chars → trimmed to ${MAX_MSG_LENGTH}`);
            safeText = safeText.slice(0, MAX_MSG_LENGTH);
        }

        // --- Greeting intercept (skip AI entirely — zero tokens) ---
        const GREETING_REGEX = /^(hi|hello|habari|mambo|niaje|yo|hey|salaam|shikamoo|hujambo|sasa|vipi|aje|sup|good\s*(morning|afternoon|evening)|bro|boss|mkuu)\s*[!?.]*$/i;
        if (!media && GREETING_REGEX.test(safeText.trim())) {
            console.log(`👋 [GREETING] ${userPhone} → hardcoded reply (zero tokens)`);
            await message.reply('Karibu boss');
            return;
        }

        // --- AI Response ---
        let aiResponse = await generateResponse(userPhone, safeText, media);

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
                    `💬 *Meseji:* "${combinedText || '[Media]'}"\n\n` +
                    `💡 *Reply hii meseji* na maelekezo yako!`
                );

                console.log(`🚨 [ALERT #${escCount}] ${userPhone}: ${summary}`);
            }
        }

        // --- CHECK STOCK Interceptor ---
        const checkStockMatch = aiResponse.match(CHECK_STOCK_TAG_REGEX);
        if (checkStockMatch) {
            const [fullTag, item] = checkStockMatch;
            aiResponse = aiResponse.replace(fullTag, '').trim();
            startStockCheck(userPhone, item.trim(), message.from);
            console.log(`📦 [CHECK STOCK] "${item}" — owner pinged`);
        }

        // --- DRIVER STATUS Interceptor ---
        const driverStatusMatch = aiResponse.match(DRIVER_STATUS_TAG_REGEX);
        if (driverStatusMatch) {
            aiResponse = aiResponse.replace(DRIVER_STATUS_TAG_REGEX, '').trim();
            const delivery = getActiveDeliveryByCustomer(userPhone);
            if (delivery) {
                const loc = driverLocations.get(delivery.driver_phone);
                let statusMsg = `🚗 *Delivery yako:*\n`;
                statusMsg += `📦 Bidhaa: ${delivery.item}\n`;
                statusMsg += `🧑‍✈️ Driver: ${delivery.driver_name}\n`;
                statusMsg += `📞 Simu: ${delivery.driver_phone}\n`;
                statusMsg += `📊 Status: ${delivery.status === 'in_transit' ? 'Njiani' : 'Imetumwa'}\n`;
                if (loc) {
                    const minsAgo = Math.round((Date.now() - loc.timestamp) / 60000);
                    statusMsg += `\n📍 *Location ya sasa:*\nhttps://maps.google.com/maps?q=${loc.lat},${loc.lng}\n_Dakika ${minsAgo} zilizopita_`;
                } else {
                    statusMsg += `\n_Driver bado hajashare location. Tunasubiri._`;
                }
                aiResponse = statusMsg;
            } else {
                aiResponse = 'Kwa sasa hakuna delivery inayoendelea. Kama umeagiza bidhaa, tutakufahamisha mara itakapotumwa.';
            }
            console.log(`🚗 [DRIVER STATUS] ${userPhone} asked about delivery`);
        }

        // --- PENDING PAYMENT Interceptor ---
        const pendingMatch = aiResponse.match(PENDING_PAYMENT_TAG_REGEX);
        if (pendingMatch) {
            const [fullTag, itemId, price, location] = pendingMatch;
            aiResponse = aiResponse.replace(fullTag, '').trim();

            const deducted = deductStock(itemId.trim());
            if (!deducted) console.log(`❌ [STOCK FAIL] ${itemId} — out of stock`);

            pendingPayments.set(userPhone, {
                itemId: itemId.trim(), price: price.trim(),
                location: location.trim(), timestamp: Date.now(),
            });

            if (OWNER_PHONE) {
                const item = getItemById(itemId.trim());
                const itemName = item ? item.item : itemId.trim();
                const profile2 = getCustomerProfile(userPhone);
                await client.sendMessage(OWNER_PHONE,
                    `💰 *PENDING PAYMENT:*\n+${userPhone} (${profile2.label})\nBidhaa: ${itemName}\nBei: TZS ${price.trim()}\nLocation: ${location.trim()}\n\n_Mteja anatuma muamala._`
                );
            }
            console.log(`💰 [PENDING] ${itemId} @ TZS ${price} → ${location}`);
        }

        // --- ORDER_CLOSED (backward compat) ---
        const orderMatch = aiResponse.match(ORDER_TAG_REGEX);
        if (orderMatch) {
            const [fullTag, item, price, location] = orderMatch;
            saveOrder(userPhone, item.trim(), price.trim(), location.trim());
            aiResponse = aiResponse.replace(fullTag, '').trim();
            const curRating = getCustomerRating(userPhone);
            if (curRating < 5) setCustomerRating(userPhone, Math.min(5, curRating + 1));
            resetEscalation(userPhone);
            console.log(`✅ [ORDER CLOSED] ${item} @ ${price} → ${location}`);
        }

        // --- RECEIPT UPLOADED Interceptor ---
        const receiptMatch = aiResponse.match(RECEIPT_TAG_REGEX);
        if (receiptMatch) {
            aiResponse = aiResponse.replace(RECEIPT_TAG_REGEX, '').trim();
            const pending = pendingPayments.get(userPhone);
            if (pending && OWNER_PHONE) {
                const item = getItemById(pending.itemId);
                const itemName = item ? item.item : pending.itemId;
                const profile2 = getCustomerProfile(userPhone);
                await client.sendMessage(OWNER_PHONE,
                    `🧾 *RECEIPT UPLOADED:*\n+${userPhone} (${profile2.label})\nBidhaa: ${itemName}\nBei: TZS ${pending.price}\n\n_THIBITISHA au KATAA_`
                );
                console.log(`🧾 [RECEIPT] ${userPhone} → ${itemName}`);
            }
        }

        // --- WhatsApp formatting cleanup ---
        aiResponse = aiResponse.replace(/\*\*(.+?)\*\*/g, '*$1*');
        aiResponse = aiResponse.replace(/^#+\s*/gm, '');
        aiResponse = aiResponse.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

        // --- SEND IMAGE Interceptor (Global) ---
        const imgRegexGlobal = /\[SEND_IMAGE:\s*([^\]]+)\]/gi;
        const imgMatches = [...aiResponse.matchAll(imgRegexGlobal)];
        aiResponse = aiResponse.replace(imgRegexGlobal, '').trim();

        // --- OUT OF STOCK ---
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
            trollCooldown.set(userPhone, Date.now() + TROLL_COOLDOWN_MS);
            const curRating = getCustomerRating(userPhone);
            if (curRating > 1) setCustomerRating(userPhone, Math.max(1, curRating - 1));
            if (OWNER_PHONE) {
                await client.sendMessage(OWNER_PHONE,
                    `🚫 *TROLL:* +${userPhone}\nCooldown 30 min.`
                );
            }
            setTimeout(async () => {
                try {
                    await client.sendMessage(message.from,
                        'Habari Boss! 👋 Kama unahitaji bidhaa yoyote, nipo hapa! 🔥'
                    );
                } catch { }
            }, TROLL_COOLDOWN_MS);
            console.log(`🚫 [TROLL] ${userPhone} — 30min cooldown`);
        }

        // --- Human delay: simulate reading + typing (1-4 seconds) ---
        const replyLength = aiResponse.length;
        const humanDelay = Math.min(4000, Math.max(1000, replyLength * 8));
        await new Promise(r => setTimeout(r, humanDelay));

        // Clear typing state
        await chat.clearState();

        // --- Send reply ---
        if (imgMatches.length > 0) {
            // Image response — always text + images
            if (aiResponse.length > 0) await message.reply(aiResponse);
            for (const match of imgMatches) {
                const rawId = match[1].trim();
                const item = getItemById(rawId) || findItemByName(rawId);
                if (!item) continue;

                let localImages = Array.isArray(item.images) ? item.images.filter(f => f) : [];
                if (localImages.length === 0 && item.image_file) localImages = [item.image_file];
                let sentAny = false;

                // Try local images first
                for (const imgFile of localImages) {
                    const imagePath = join(__dirname, '..', 'data', 'images', imgFile);
                    try {
                        const media2 = MessageMedia.fromFilePath(imagePath);
                        await client.sendMessage(message.from, media2);
                        sentAny = true;
                    } catch { /* file missing */ }
                }

                // On-demand: search Google Images, download, cache, then send
                if (!sentAny) {
                    console.log(`🔍 [ON-DEMAND] Searching images for "${item.item}"...`);
                    try {
                        const downloaded = await searchAndDownloadImages(item);
                        for (const imgFile of downloaded) {
                            const imagePath = join(__dirname, '..', 'data', 'images', imgFile);
                            try {
                                const media2 = MessageMedia.fromFilePath(imagePath);
                                await client.sendMessage(message.from, media2);
                                sentAny = true;
                            } catch { /* skip */ }
                        }
                    } catch (searchErr) {
                        console.error(`❌ [ON-DEMAND] Search failed for ${item.id}: ${searchErr.message}`);
                    }
                }

                if (!sentAny) {
                    console.log(`⚠️ [NO IMAGE] ${item.id} — no local file and search failed`);
                }
            }
            console.log(`🖼️ [SEND IMAGE] ${imgMatches.length} products → ${userPhone}`);
        } else if (isVoice && isVoiceEnabled()) {
            // Voice note customer → reply with voice ONLY (text as fallback)
            try {
                const audioBuffer = await textToVoiceNote(aiResponse);
                if (audioBuffer) {
                    const voiceMedia = new MessageMedia('audio/ogg; codecs=opus', audioBuffer.toString('base64'), 'voice.ogg');
                    await client.sendMessage(message.from, voiceMedia, { sendAudioAsVoice: true });
                    console.log(`🎤 [VOICE ONLY] → ${userPhone}`);
                } else {
                    // TTS returned null — send text instead
                    await message.reply(aiResponse);
                }
            } catch (ttsErr) {
                console.error(`❌ [TTS] Failed, sending text: ${ttsErr.message}`);
                await message.reply(aiResponse);
            }
        } else {
            // Regular text customer → text reply
            await message.reply(aiResponse);
        }

        console.log(`🤖 [PatanaBot → ${userPhone}]: ${aiResponse.substring(0, 80)}...`);

    } catch (error) {
        console.error('❌ [PROCESS] Error:', error.message);
    }
}

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
