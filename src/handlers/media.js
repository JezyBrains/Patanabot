import { updateInventoryFromExcel } from '../inventory.js';
import { addProductImage, findItemByName, addQuickProduct, getItemById } from '../shop.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function handleOwnerMedia(message, client, state) {
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
        return;
    }

    // --- Owner IMAGE: Quick-add OR add photo to existing ---
    if (media.mimetype && media.mimetype.includes('image')) {
        const imagesDir = join(__dirname, '..', '..', 'data', 'images');

        if (upperCaption.startsWith('PICHA:') || upperCaption.startsWith('PICHA ')) {
            // Add more photos to existing product — fuzzy name match
            const query = caption.replace(/^picha[:\s]+/i, '').trim();
            const item = findItemByName(query);
            if (item) {
                const existing = Array.isArray(item.images) ? item.images.length : 0;
                const ext = media.mimetype.includes('png') ? 'png' : 'jpg';
                const fileName = `${item.id}_${existing + 1}.${ext}`;
                writeFileSync(join(imagesDir, fileName), Buffer.from(media.data, 'base64'));
                addProductImage(item.id, fileName);
                state.lastOwnerProduct = item.id;
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
                writeFileSync(join(imagesDir, fileName), Buffer.from(media.data, 'base64'));
                addProductImage(item.id, fileName);
                state.lastOwnerProduct = item.id;
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
                writeFileSync(join(imagesDir, fileName), Buffer.from(media.data, 'base64'));
                addProductImage(item.id, fileName);
                state.lastOwnerProduct = item.id;
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
            if (state.lastOwnerProduct) {
                const item = getItemById(state.lastOwnerProduct);
                if (item) {
                    const existing = Array.isArray(item.images) ? item.images.length : 0;
                    const ext = media.mimetype.includes('png') ? 'png' : 'jpg';
                    const fileName = `${item.id}_${existing + 1}.${ext}`;
                    writeFileSync(join(imagesDir, fileName), Buffer.from(media.data, 'base64'));
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
}

export async function downloadMedia(message) {
    if (message.hasMedia) {
        return await message.downloadMedia();
    }
    return null;
}
