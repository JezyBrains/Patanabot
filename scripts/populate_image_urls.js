#!/usr/bin/env node
/**
 * One-shot script to populate image_url fields for all products.
 * Uses real product image URLs from manufacturer/retailer CDNs.
 * Run: node scripts/populate_image_urls.js
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');

// Real product image URLs (high-quality, direct-link images)
const IMAGE_URLS = {
    // PHONES
    samsung_s24: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/2401/gallery/africa-en-galaxy-s24-s928-sm-s924bzkdafa-thumb-539573125',
    samsung_s23: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/2302/gallery/africa-en-galaxy-s23-s911-sm-s911bzkdafa-thumb-534863401',
    samsung_zflip4: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/2208/gallery/africa-en-galaxy-z-flip4-f721-sm-f721bzkdafa-thumb-533567234',
    samsung_s21ultra: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/galaxy-s21-ultra-5g/gallery/africa-en-galaxy-s21-ultra-5g-g988-sm-g998bzkdxef-thumb-368338883',
    samsung_a54: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/2302/gallery/africa-en-galaxy-a54-5g-sm-a546ezdcafa-thumb-534844218',
    iphone15: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-15-finish-select-202309-6-1inch-black?wid=400&hei=400&fmt=jpeg',
    iphone14pro: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-14-pro-finish-select-202209-6-1inch-deeppurple?wid=400&hei=400&fmt=jpeg',
    iphone14: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-14-finish-select-202209-6-1inch-blue?wid=400&hei=400&fmt=jpeg',
    iphone13promax: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-13-pro-max-graphite-select?wid=400&hei=400&fmt=jpeg',
    iphone11: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-11-green-select-2019?wid=400&hei=400&fmt=jpeg',
    pixel9: 'https://lh3.googleusercontent.com/P2n1Y3J2s8Xsc4mPdkXdqR-MKhR0X_VRtJqm4h7VfRtf2GFrJ5VDLRrmQnW0rDJMcw=w400',
    pixel9pro: 'https://lh3.googleusercontent.com/W1H7cPkXlXKrYe0ZtA_lB0GRJjDIEaVHiprXvR_czQq-RW2Gg6b6Dqj8n3cF9p0YW-s=w400',
    nokia235: 'https://fdn2.gsmarena.com/vv/bigpic/nokia-235-4g-2024.jpg',
    tecno_spark20: 'https://fdn2.gsmarena.com/vv/bigpic/tecno-spark-20-pro-plus.jpg',

    // TABLETS
    tab_a11: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/feature/164036912/africa-en-feature--531820972',
    tab_s10ultra: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/2410/gallery/africa-en-galaxy-tab-s10-ultra-wifi-sm-x920nzadafa-thumb-542418143',
    modio_m39: 'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/73/2158001/1.jpg',
    modio_m128: 'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/50/5530091/1.jpg',
    atouch_x19: 'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/57/1896961/1.jpg',
    ipad10: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/ipad-10th-gen-finish-select-202210-blue-wifi?wid=400&hei=400&fmt=jpeg',

    // EARPHONES
    airpods_pro2: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MQD83?wid=400&hei=400&fmt=jpeg',
    airpods_max: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/airpods-max-select-silver-202011?wid=400&hei=400&fmt=jpeg',
    galaxy_buds: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/2301/gallery/africa-en-galaxy-buds-fe-sm-r400nzaaxfa-thumb-537157614',
    jbl_s25: 'https://www.jbl.com/dw/image/v2/AAUJ_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw76eb1b01/JBL_TUNE_BEAM_Product_Image_Hero_Blue.png?sw=400',
    jbl_770nc: 'https://www.jbl.com/dw/image/v2/AAUJ_PRD/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw46d28f36/JBL_LIVE_770NC_Product_Image_Hero_Blue.png?sw=400',
    oraimo_buds: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/65/0791542/1.jpg',
    sony_wf1000: 'https://m.media-amazon.com/images/I/61S6Mhb-PNL._AC_SX679_.jpg',
    anker_r60i: 'https://m.media-amazon.com/images/I/61JnvqCqURL._AC_SX679_.jpg',

    // POWER BANKS
    oraimo_pb10: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/07/5113431/1.jpg',
    oraimo_pb20: 'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/39/1988001/1.jpg',
    anker_pb26: 'https://m.media-amazon.com/images/I/51Vp-XOEL-L._AC_SX679_.jpg',
    samsung_pb10: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/eb-u1200csegww/gallery/africa-en-wireless-battery-pack-10-000-mah-eb-u1200csegww-Silver-191428165',

    // CHARGERS/CABLES
    samsung_charger45: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/ep-t4510xbegeu/gallery/africa-en-45w-power-adapter-ep-t4510xbegeu-thumb-537217949',
    apple_charger20: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MHJA3?wid=400&hei=400&fmt=jpeg',
    cable_lightning: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MM0A3?wid=400&hei=400&fmt=jpeg',
    cable_usbc: 'https://m.media-amazon.com/images/I/61nPUPMDgzL._AC_SX679_.jpg',

    // SMART WATCHES
    apple_watch9: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/watch-s9-702-702-aluminum-midnight-sport-band-midnight?wid=400&hei=400&fmt=jpeg',
    galaxy_watch6: 'https://images.samsung.com/is/image/samsung/p6pim/africa_en/2307/gallery/africa-en-galaxy-watch6-sm-l945fzkaxfa-thumb-537016629',
    modio_mw09: 'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/89/5449541/1.jpg',

    // LAPTOPS
    macbook_air_m2: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/macbook-air-midnight-select-20220606?wid=400&hei=400&fmt=jpeg',
    macbook_pro_m3: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/mbp-14-spacegray-select-202310?wid=400&hei=400&fmt=jpeg',
    hp_15s: 'https://m.media-amazon.com/images/I/71jG+e7roXL._AC_SX679_.jpg',
};

// Read profile
const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
let updated = 0;

for (const item of profile.inventory) {
    if (IMAGE_URLS[item.id]) {
        item.image_url = IMAGE_URLS[item.id];
        updated++;
        console.log(`✅ ${item.id} → image_url set`);
    } else {
        console.log(`⚠️ ${item.id} → no URL mapped`);
    }
}

writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');
console.log(`\n📸 Done! ${updated}/${profile.inventory.length} products now have image_url`);
