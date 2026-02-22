#!/usr/bin/env node
/**
 * Download 3+ real product images per product from manufacturer CDNs.
 * Saves to data/images/ and updates shop_profile.json images array.
 * Run: node scripts/populate_image_urls.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');
const imagesDir = join(__dirname, '..', 'data', 'images');

mkdirSync(imagesDir, { recursive: true });

// 3 real image URLs per product from different angles/sources
const PRODUCT_IMAGES = {
    samsung_s24: [
        'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-s24.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/24/samsung-galaxy-s24/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/24/samsung-galaxy-s24/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    samsung_s23: [
        'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-s23-.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/23/samsung-galaxy-s23/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/23/samsung-galaxy-s23/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    samsung_zflip4: [
        'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-z-flip4-5g.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/22/samsung-galaxy-z-flip4/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/22/samsung-galaxy-z-flip4/lifestyle/-1024w2/gsmarena_005.jpg',
    ],
    samsung_s21ultra: [
        'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-s21-ultra-5g.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/21/samsung-galaxy-s21-ultra/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/21/samsung-galaxy-s21-ultra/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    samsung_a54: [
        'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-a54.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/23/samsung-galaxy-a54/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/23/samsung-galaxy-a54/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    iphone15: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-iphone-15.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/23/apple-iphone-15/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/23/apple-iphone-15/lifestyle/-1024w2/gsmarena_004.jpg',
    ],
    iphone14pro: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-iphone-14-pro.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/22/apple-iphone-14-pro/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/22/apple-iphone-14-pro/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    iphone14: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-iphone-14.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/22/apple-iphone-14/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/22/apple-iphone-14/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    iphone13promax: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-iphone-13-pro-max.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/21/apple-iphone-13-pro-max/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/21/apple-iphone-13-pro-max/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    iphone11: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-iphone-11-.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/19/apple-iphone-11/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/19/apple-iphone-11/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    pixel9: [
        'https://fdn2.gsmarena.com/vv/bigpic/google-pixel9.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/24/google-pixel-9/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/24/google-pixel-9/lifestyle/-1024w2/gsmarena_004.jpg',
    ],
    pixel9pro: [
        'https://fdn2.gsmarena.com/vv/bigpic/google-pixel9-pro.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/24/google-pixel-9-pro/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/24/google-pixel-9-pro/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    nokia235: [
        'https://fdn2.gsmarena.com/vv/bigpic/nokia-235-4g-2024.jpg',
        'https://fdn.gsmarena.com/imgroot/news/24/04/nokia-235-4g-2024/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/news/24/04/nokia-235-4g-2024/-1024w2/gsmarena_002.jpg',
    ],
    tecno_spark20: [
        'https://fdn2.gsmarena.com/vv/bigpic/tecno-spark-20-pro-plus.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/24/tecno-spark-20-pro-plus/lifestyle/-1024w2/gsmarena_001.jpg',
        'https://fdn.gsmarena.com/imgroot/reviews/24/tecno-spark-20-pro-plus/lifestyle/-1024w2/gsmarena_003.jpg',
    ],
    tab_a11: [
        'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-tab-a9.jpg',
        'https://m.media-amazon.com/images/I/61b5GfZmYFL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71NJJCpXwOL._AC_SX679_.jpg',
    ],
    tab_s10ultra: [
        'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-tab-s10-ultra.jpg',
        'https://m.media-amazon.com/images/I/71WO50VKkXL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61ER-oUVHrL._AC_SX679_.jpg',
    ],
    modio_m39: [
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/73/2158001/1.jpg',
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/73/2158001/2.jpg',
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/73/2158001/3.jpg',
    ],
    modio_m128: [
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/50/5530091/1.jpg',
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/50/5530091/2.jpg',
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/50/5530091/3.jpg',
    ],
    atouch_x19: [
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/57/1896961/1.jpg',
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/57/1896961/2.jpg',
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/57/1896961/3.jpg',
    ],
    ipad10: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-ipad-10th-gen.jpg',
        'https://m.media-amazon.com/images/I/61NGnpjoRDL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61aHqKzGj8L._AC_SX679_.jpg',
    ],
    airpods_pro2: [
        'https://m.media-amazon.com/images/I/61SUj2aKoEL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71zny7BTRlL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71bhWgQK-cL._AC_SX679_.jpg',
    ],
    airpods_max: [
        'https://m.media-amazon.com/images/I/81jCILGsxiL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/81J+OF9LQoL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/719WQWKT0+L._AC_SX679_.jpg',
    ],
    galaxy_buds: [
        'https://m.media-amazon.com/images/I/51c1dShHLdL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61jKjQVn6gL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61ydajdGRPL._AC_SX679_.jpg',
    ],
    jbl_s25: [
        'https://m.media-amazon.com/images/I/51UbQgDqYHL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61cW2sZvJDL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61EMlzHdKwL._AC_SX679_.jpg',
    ],
    jbl_770nc: [
        'https://m.media-amazon.com/images/I/51aw5nzNjjL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61K9kc0HaqL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61qkDxqH+rL._AC_SX679_.jpg',
    ],
    oraimo_buds: [
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/65/0791542/1.jpg',
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/65/0791542/2.jpg',
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/65/0791542/3.jpg',
    ],
    sony_wf1000: [
        'https://m.media-amazon.com/images/I/61S6Mhb-PNL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61fy85UTHFL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71gISOPjq7L._AC_SX679_.jpg',
    ],
    anker_r60i: [
        'https://m.media-amazon.com/images/I/61JnvqCqURL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71DcKwfF+XL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71oBZqfPFxL._AC_SX679_.jpg',
    ],
    oraimo_pb10: [
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/07/5113431/1.jpg',
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/07/5113431/2.jpg',
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/07/5113431/3.jpg',
    ],
    oraimo_pb20: [
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/39/1988001/1.jpg',
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/39/1988001/2.jpg',
        'https://ng.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/39/1988001/3.jpg',
    ],
    anker_pb26: [
        'https://m.media-amazon.com/images/I/51Vp-XOEL-L._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61pBj6BhDYL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/51T2EY9s5fL._AC_SX679_.jpg',
    ],
    samsung_pb10: [
        'https://m.media-amazon.com/images/I/51JxEqfV0tL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61hJ6ey8oHL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71OYM2Q14TL._AC_SX679_.jpg',
    ],
    samsung_charger45: [
        'https://m.media-amazon.com/images/I/51bBqY2onsL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/51LpVIeP8dL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/51+s5M-SJFL._AC_SX679_.jpg',
    ],
    apple_charger20: [
        'https://m.media-amazon.com/images/I/619qqPQ+gOL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61aRjPBqzxL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/51+zO6ALOCL._AC_SX679_.jpg',
    ],
    cable_lightning: [
        'https://m.media-amazon.com/images/I/71JEfLndyNL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61DaJMX3VnL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/710FGVHnSSL._AC_SX679_.jpg',
    ],
    cable_usbc: [
        'https://m.media-amazon.com/images/I/61nPUPMDgzL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61rFc2RMCOL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61wKK4EKryL._AC_SX679_.jpg',
    ],
    apple_watch9: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-watch-series-9.jpg',
        'https://m.media-amazon.com/images/I/71lmET66WoL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/81q4b1V3JWT._AC_SX679_.jpg',
    ],
    galaxy_watch6: [
        'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-watch-6-44mm.jpg',
        'https://m.media-amazon.com/images/I/61+RxVuuCSL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/61K42O4fRWL._AC_SX679_.jpg',
    ],
    modio_mw09: [
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/89/5449541/1.jpg',
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/89/5449541/2.jpg',
        'https://ke.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/89/5449541/3.jpg',
    ],
    macbook_air_m2: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-macbook-air-m2-2022.jpg',
        'https://m.media-amazon.com/images/I/71f5Eu5lJSL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71vFKBpKakL._AC_SX679_.jpg',
    ],
    macbook_pro_m3: [
        'https://fdn2.gsmarena.com/vv/bigpic/apple-macbook-pro-14-2023-m3.jpg',
        'https://m.media-amazon.com/images/I/61RnXSVICNL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71p-M60nvnL._AC_SX679_.jpg',
    ],
    hp_15s: [
        'https://m.media-amazon.com/images/I/71jG+e7roXL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/71S2V819ywL._AC_SX679_.jpg',
        'https://m.media-amazon.com/images/I/714qyFiuWOL._AC_SX679_.jpg',
    ],
};

/**
 * Download a file from URL to disk. Follows redirects.
 */
function downloadFile(url, destPath, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const request = client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/*,*/*',
                'Referer': 'https://www.google.com/',
            }
        }, (response) => {
            // Follow redirects
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
                const newUrl = response.headers.location.startsWith('http')
                    ? response.headers.location
                    : new URL(response.headers.location, url).href;
                return downloadFile(newUrl, destPath, maxRedirects - 1).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                return reject(new Error(`HTTP ${response.statusCode}`));
            }

            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (buffer.length < 1000) {
                    return reject(new Error(`File too small (${buffer.length} bytes)`));
                }
                writeFileSync(destPath, buffer);
                resolve(buffer.length);
            });
            response.on('error', reject);
        });
        request.on('error', reject);
        request.setTimeout(15000, () => {
            request.destroy();
            reject(new Error('Timeout'));
        });
    });
}

async function main() {
    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    let totalDownloaded = 0;
    let totalFailed = 0;

    for (const item of profile.inventory) {
        const urls = PRODUCT_IMAGES[item.id];
        if (!urls) {
            console.log(`⚠️ ${item.id} — no image URLs mapped, skipping`);
            continue;
        }

        // Reset images array
        const downloaded = [];
        console.log(`\n📦 ${item.item} (${item.id}):`);

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const ext = url.includes('.png') ? 'png' : 'jpg';
            const fileName = `${item.id}_${i + 1}.${ext}`;
            const filePath = join(imagesDir, fileName);

            // Skip if already downloaded
            if (existsSync(filePath)) {
                console.log(`   ✅ ${fileName} (already exists)`);
                downloaded.push(fileName);
                continue;
            }

            try {
                const size = await downloadFile(url, filePath);
                console.log(`   ✅ ${fileName} (${(size / 1024).toFixed(0)}KB)`);
                downloaded.push(fileName);
                totalDownloaded++;

                // Be nice — small delay between requests
                await new Promise(r => setTimeout(r, 300));
            } catch (err) {
                console.log(`   ❌ ${fileName} — ${err.message}`);
                totalFailed++;
            }
        }

        // Update product's images array
        item.images = downloaded;
        delete item.image_file; // Clean up old field
    }

    // Save updated profile
    writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📸 DONE! Downloaded: ${totalDownloaded} | Failed: ${totalFailed}`);
    console.log(`📦 Products with images: ${profile.inventory.filter(i => i.images?.length > 0).length}/${profile.inventory.length}`);
}

main().catch(console.error);
