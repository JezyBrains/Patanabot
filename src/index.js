import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import { generateResponse } from './ai.js';
import { saveOrder } from './db.js';
import { shopName } from './shop.js';

dotenv.config();

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
    console.log(`\n🚀 PatanaBot is LIVE for "${shopName}"!`);
    console.log('━'.repeat(50));
    console.log('💼 B2B Sales Negotiator Active');
    console.log('🤖 AI Engine: Gemini 1.5 Flash');
    console.log('📦 Mode: Kupatana Bei (Price Negotiation)');
    console.log('━'.repeat(50));
});

// --- Authentication Failure ---
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
});

// --- Disconnected ---
client.on('disconnected', (reason) => {
    console.log('🔌 Client disconnected:', reason);
    // Auto-reconnect
    client.initialize();
});

// --- Order Tag Regex ---
const ORDER_TAG_REGEX = /\[ORDER_CLOSED:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\]/;

// --- Message Handler ---
client.on('message', async (message) => {
    try {
        // Ignore group messages — B2B bot is for DMs only
        if (message.from.includes('@g.us')) return;

        // Extract the real phone number
        const contact = await message.getContact();
        const userPhone = contact.number;
        const text = message.body.trim();

        // Skip empty messages
        if (!text) return;

        console.log(`\n📩 [${userPhone}]: ${text}`);

        // --- DEMO HOOK ---
        if (text.toUpperCase() === 'DEMO') {
            const demoReply = `Habari Boss! 👋 Mimi ni PatanaBot. Ninajibu meseji hii sekunde hii hii huku mmiliki wangu akiwa amelala. Nimepewa uwezo wa kupatana bei na wateja bila kuingiza duka hasara. Tuigize: Uliza bei ya AirPods uone ninavyofanya biashara!`;
            await message.reply(demoReply);
            console.log(`🎯 [DEMO] → ${userPhone}`);
            return;
        }

        // --- AI Response ---
        let aiResponse = await generateResponse(userPhone, text);

        // --- Order Interceptor ---
        const orderMatch = aiResponse.match(ORDER_TAG_REGEX);
        if (orderMatch) {
            const [fullTag, item, price, location] = orderMatch;

            // Save the order to the database
            saveOrder(userPhone, item.trim(), price.trim(), location.trim());

            // Strip the tag from the response — customer should never see it
            aiResponse = aiResponse.replace(fullTag, '').trim();

            console.log(`✅ [ORDER CLOSED] ${item} @ ${price} → ${location}`);
        }

        // Reply to the customer
        await message.reply(aiResponse);
        console.log(`🤖 [PatanaBot → ${userPhone}]: ${aiResponse.substring(0, 80)}...`);
    } catch (error) {
        console.error('❌ Message handling error:', error.message);
    }
});

// --- Initialize Client ---
console.log('\n🔄 Initializing PatanaBot...');
client.initialize();
