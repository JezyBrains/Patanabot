import { OWNER_PHONE, PENDING_PAYMENT_TAG_REGEX, ALERT_TAG_REGEX, CHECK_STOCK_TAG_REGEX, OOS_TAG_REGEX } from '../constants.js';
import {
    saveOrder, pauseBot, resumeBot, resumeAllBots,
    getCustomerRating, setCustomerRating, getCustomerProfile,
    saveMissedOpportunity
} from '../db.js';
import {
    getInventoryList, updatePaymentInfo, setPaymentPolicy, getPaymentPolicy,
    getItemById, restoreStock
} from '../shop.js';
import { generateExcelTemplate, bulkImportFromText } from '../inventory.js';
import { updateInventoryFromText } from '../admin.js';
import { handleOwnerMedia } from './media.js';
import { clearStockCheck } from '../middleware/tags.js';
import { generateResponse } from '../ai.js';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;

export async function handleOwnerMessage(message, client, state) {
    if (message.hasMedia) {
        await handleOwnerMedia(message, client, state);
        return;
    }

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
    } else if (state.pendingPayments.size > 0 && (upper === 'THIBITISHA' || upper === 'KATAA')) {
        let targetPhone = null;
        if (message.hasQuotedMsg) {
            try {
                const quoted = await message.getQuotedMessage();
                const phoneMatch = quoted.body.match(/\+(\d{12})/);
                if (phoneMatch) targetPhone = phoneMatch[1];
            } catch { }
        }
        if (!targetPhone) targetPhone = [...state.pendingPayments.keys()].pop();

        const pending = state.pendingPayments.get(targetPhone);
        if (!pending) {
            await message.reply('❌ Hakuna malipo yanayosubiri.');
            return;
        }

        if (upper === 'THIBITISHA') {
            state.pendingPayments.delete(targetPhone);
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
            state.pendingPayments.delete(targetPhone);

            const rejectMsg = await generateResponse(
                targetPhone,
                `🔑 MAELEKEZO YA BOSS: Malipo ya mteja HAYAKUINGIA. Mwambie kwa upole: "Boss, malipo bado hayajaingia. Jaribu tena au tuma screenshot mpya." Usimfukuze — mshike kwa upole.`
            );
            let clean = rejectMsg.replace(PENDING_PAYMENT_TAG_REGEX, '').replace(ALERT_TAG_REGEX, '').trim();
            await client.sendMessage(`${targetPhone}@c.us`, clean);
            await message.reply(`❌ Malipo ya ${targetPhone} yamekataliwa. Stock imerejeshwa.`);
            console.log(`❌ [PAYMENT REJECTED] ${targetPhone} — stock restored`);
        }

        // --- Owner reply: NDIYO/HAPANA for stock check ---
    } else if (state.stockCheckQueue.size > 0 && (upper === 'NDIYO' || upper === 'HAPANA')) {
        // Try to extract customer from quoted message or use most recent
        let targetPhone = null;
        if (message.hasQuotedMsg) {
            try {
                const quoted = await message.getQuotedMessage();
                const phoneMatch = quoted.body.match(/\+(\d{12})/);
                if (phoneMatch) targetPhone = phoneMatch[1];
            } catch { }
        }
        if (!targetPhone) targetPhone = [...state.stockCheckQueue.keys()].pop();

        const check = state.stockCheckQueue.get(targetPhone);
        if (!check) {
            await message.reply('❌ Hakuna stock check inayosubiri.');
            return;
        }

        if (upper === 'NDIYO') {
            clearStockCheck(targetPhone, state);
            const confirmResponse = await generateResponse(
                targetPhone,
                `🔑 MAELEKEZO YA BOSS: Tumeipata "${check.item}"! Mwambie mteja habari njema — "${check.item}" ipo! Muulize kama anataka na mpe bei. MUHIMU: Zungumzia "${check.item}" TU — USITAJE bidhaa nyingine yoyote!`
            );
            let clean = confirmResponse.replace(ALERT_TAG_REGEX, '').replace(CHECK_STOCK_TAG_REGEX, '').trim();
            await client.sendMessage(`${targetPhone}@c.us`, clean);
            await message.reply(`✅ Mteja ${targetPhone} — "${check.item}" confirmed!`);
        } else {
            clearStockCheck(targetPhone, state);
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
        if (!targetPhone && state.activeEscalations.size > 0) {
            targetPhone = [...state.activeEscalations.keys()].pop();
        }

        if (targetPhone && (state.activeEscalations.has(targetPhone) || state.stockCheckQueue.has(targetPhone))) {
            const guidance = `🔑 MAELEKEZO YA BOSS: ${text}`;
            const aiResponse = await generateResponse(targetPhone, guidance);

            let cleanResponse = aiResponse
                .replace(ALERT_TAG_REGEX, '')
                .replace(CHECK_STOCK_TAG_REGEX, '')
                .replace(OOS_TAG_REGEX, '')
                .trim();

            await client.sendMessage(`${targetPhone}@c.us`, cleanResponse);
            await message.reply(`✅ Mteja ${targetPhone}:\n\n"${cleanResponse.substring(0, 150)}..."`);
            state.activeEscalations.delete(targetPhone);
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
