#!/usr/bin/env node
/**
 * Download 3 real product images per product via Google Image Search.
 * Searches each product name, extracts image URLs, downloads them.
 * Run inside Docker: node scripts/populate_image_urls.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilePath = join(__dirname, '..', 'data', 'shop_profile.json');
const imagesDir = join(__dirname, '..', 'data', 'images');

mkdirSync(imagesDir, { recursive: true });

const TARGET_IMAGES = 3;

/**
 * Search Google Images and extract image URLs
 */
async function searchGoogleImages(query, count = 5) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&ijn=0`;

    console.log(`   🔍 Searching: "${query}"`);

    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        },
    });

    if (!response.ok) {
        throw new Error(`Google search returned ${response.status}`);
    }

    const html = await response.text();

    // Extract image URLs from Google Image search results
    // Google embeds actual image URLs in the HTML in multiple formats
    const urls = [];

    // Pattern 1: Direct image URLs in data attributes and scripts
    const imgRegex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)",\d+,\d+\]/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null && urls.length < count * 2) {
        const url = match[1];
        // Skip Google's own thumbnails and tiny images
        if (!url.includes('gstatic.com') && !url.includes('google.com') && url.length < 500) {
            urls.push(url);
        }
    }

    // Pattern 2: Image src from img tags (thumbnails - base64 encoded by google, skip)
    // Pattern 3: og:image or other meta tags
    const metaRegex = /content="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
    while ((match = metaRegex.exec(html)) !== null && urls.length < count * 2) {
        const url = match[1];
        if (!url.includes('gstatic.com') && !url.includes('google.com') && url.length < 500) {
            urls.push(url);
        }
    }

    // Deduplicate
    const unique = [...new Set(urls)];
    return unique.slice(0, count);
}

/**
 * Download an image from URL to disk
 */
async function downloadImage(url, destPath) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/*,*/*',
                'Referer': 'https://www.google.com/',
            },
            redirect: 'follow',
        });

        clearTimeout(timeout);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer = Buffer.from(await response.arrayBuffer());

        if (buffer.length < 2000) throw new Error(`Too small (${buffer.length}b)`);

        writeFileSync(destPath, buffer);
        return buffer.length;
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

async function main() {
    console.log('📸 PatanaBot Image Downloader');
    console.log('═'.repeat(50));

    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    let totalDownloaded = 0;
    let totalFailed = 0;
    let productsWithImages = 0;

    for (let p = 0; p < profile.inventory.length; p++) {
        const item = profile.inventory[p];

        // Skip if already has enough local images
        const existing = Array.isArray(item.images) ? item.images.filter(f => {
            return f && existsSync(join(imagesDir, f));
        }) : [];

        if (existing.length >= TARGET_IMAGES) {
            console.log(`\n[${p + 1}/${profile.inventory.length}] ✅ ${item.item} — already has ${existing.length} images`);
            productsWithImages++;
            continue;
        }

        console.log(`\n[${p + 1}/${profile.inventory.length}] 📦 ${item.item}`);

        // Build search query
        const brand = item.brand || '';
        const searchQuery = `${brand} ${item.item} product photo official`.trim();

        try {
            // Search Google Images
            const imageUrls = await searchGoogleImages(searchQuery, TARGET_IMAGES + 2);

            if (imageUrls.length === 0) {
                console.log(`   ⚠️ No images found via search`);
                totalFailed++;
                continue;
            }

            console.log(`   📋 Found ${imageUrls.length} candidate images`);

            // Download images
            const downloaded = [...existing]; // Keep existing ones
            let imgIndex = existing.length;

            for (const url of imageUrls) {
                if (downloaded.length >= TARGET_IMAGES) break;

                imgIndex++;
                const ext = url.includes('.png') ? 'png' : 'jpg';
                const fileName = `${item.id}_${imgIndex}.${ext}`;
                const filePath = join(imagesDir, fileName);

                try {
                    const size = await downloadImage(url, filePath);
                    console.log(`   ✅ ${fileName} (${(size / 1024).toFixed(0)}KB)`);
                    downloaded.push(fileName);
                    totalDownloaded++;
                } catch (err) {
                    console.log(`   ❌ Image ${imgIndex} — ${err.message}`);
                }

                // Small delay between downloads
                await new Promise(r => setTimeout(r, 200));
            }

            // Update product
            item.images = downloaded;
            delete item.image_file;

            if (downloaded.length > 0) productsWithImages++;

            // Save progress after each product (in case of crash)
            writeFileSync(profilePath, JSON.stringify(profile, null, 4), 'utf-8');

        } catch (err) {
            console.log(`   ❌ Search failed: ${err.message}`);
            totalFailed++;
        }

        // Delay between products to avoid Google rate limiting
        await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📸 DONE!`);
    console.log(`   Downloaded: ${totalDownloaded} images`);
    console.log(`   Failed: ${totalFailed}`);
    console.log(`   Products with images: ${productsWithImages}/${profile.inventory.length}`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
});
