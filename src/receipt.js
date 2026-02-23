/**
 * M-Pesa Receipt Verification Module
 * 
 * LOGIC:
 * - Receipt RECIPIENT = shop name (customer paid TO the shop)
 * - AUTO-DENY: wrong recipient name, old receipt (>24h)
 * - FORWARD TO OWNER: name ✓ + time ✓ (amount match or mismatch for review)
 * - INSTANT FEEDBACK: customer is notified immediately
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// M-Pesa text receipt patterns (both English and Swahili)
const MPESA_PATTERNS = [
    /([A-Z0-9]{10,13})\s*(?:Confirmed|Imethibitishwa).*?(?:Tsh|TSh|TZS)\s*([\d,]+(?:\.\d+)?)/i,
    /(?:Tsh|TSh|TZS)\s*([\d,]+(?:\.\d+)?)\s*(?:imetumwa|sent)/i,
    /([A-Z0-9]{10,13}).*?(?:received|imetumwa|sent).*?(?:Tsh|TSh|TZS)\s*([\d,]+(?:\.\d+)?)/i,
];

// Who RECEIVED the money (this should match the shop name)
const RECIPIENT_PATTERNS = [
    /(?:has\s+received|imetumwa\s+kwa|sent\s+to|paid\s+to)\s+([A-Z][A-Za-z\s\-\.]+?)(?:\s+(?:on|kwenye|tarehe|has|Tsh|TZS))/i,
    /(?:kwa|to)\s+([A-Z][A-Za-z\s\-\.]+?)(?:\s+(?:kwenye|on|akaunti))/i,
    /(?:received\s+by|aliyepokea)\s+([A-Z][A-Za-z\s\-\.]+)/i,
];

const DATE_PATTERNS = [
    /(?:on|tarehe)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i,
    /tarehe\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+saa\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
];

/**
 * Parse M-Pesa text receipt
 */
export function parseMpesaText(text) {
    if (!text) return null;

    const isMpesa = /(?:M-Pesa|Tsh|TSh|TZS|Confirmed|Imethibitishwa|imetumwa|muamala|Salio)/i.test(text);
    if (!isMpesa) return null;

    let transactionId = null, amount = null, recipient = null, date = null;

    const txMatch = text.match(/\b([A-Z0-9]{10,13})\b/);
    if (txMatch) transactionId = txMatch[1];

    for (const pattern of MPESA_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            for (let i = 1; i < match.length; i++) {
                const val = match[i]?.replace(/,/g, '');
                const num = parseFloat(val);
                if (!isNaN(num) && num > 0 && num < 100000000) { amount = num; break; }
            }
            if (amount) break;
        }
    }

    for (const pattern of RECIPIENT_PATTERNS) {
        const match = text.match(pattern);
        if (match) { recipient = match[1].trim(); break; }
    }

    for (const pattern of DATE_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            date = match[1];
            if (match[2]) date += ' ' + match[2];
            break;
        }
    }

    if (!amount && !transactionId) return null;
    return { transactionId, amount, recipient, date, raw: text };
}

/**
 * Verify receipt screenshot using Gemini Vision
 */
export async function verifyReceiptImage(mediaData, mimeType) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType: mimeType || 'image/jpeg', data: mediaData } },
                    {
                        text: `Hii ni picha. Kama ni receipt/muamala wa M-Pesa au malipo, toa habari hizi:

1. Transaction ID (namba ya muamala)
2. Amount (kiasi kilicholipwa, NAMBARI tu)
3. Recipient (JINA la mtu/biashara aliyePOKEA pesa — SI aliyetuma!)
4. Date (tarehe na saa)
5. Is this a payment receipt? (true/false)

JIBU JSON TU:
{"transactionId": "...", "amount": 50000, "recipient": "...", "date": "...", "isReceipt": true}

Kama SI receipt (ni picha ya bidhaa, selfie, math, meme, au kitu kingine):
{"isReceipt": false}` }
                ]
            }],
        });

        const responseText = result.response.text().trim();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.isReceipt) return null;

        return {
            transactionId: parsed.transactionId !== 'null' ? parsed.transactionId : null,
            amount: typeof parsed.amount === 'number' ? parsed.amount : parseFloat(String(parsed.amount || '0').replace(/,/g, '')),
            recipient: parsed.recipient !== 'null' ? parsed.recipient : null,
            date: parsed.date !== 'null' ? parsed.date : null,
        };
    } catch (err) {
        console.error(`❌ [RECEIPT VISION] Error: ${err.message}`);
        return null;
    }
}

/**
 * Extract shop name from payment_info string
 */
function extractShopName(paymentInfo) {
    if (!paymentInfo) return '';
    const match = paymentInfo.match(/(?:Jina:\s*|kwa\s+)([^).,]+)/i);
    return match ? match[1].trim() : '';
}

/**
 * Fuzzy match: does receipt recipient match the shop name?
 */
function recipientMatchesShop(receiptName, shopName) {
    if (!receiptName || !shopName) return false;
    const rWords = receiptName.toLowerCase().split(/[\s\-\.]+/).filter(w => w.length > 2);
    const sWords = shopName.toLowerCase().split(/[\s\-\.]+/).filter(w => w.length > 2);
    // At least one significant word must match
    return sWords.some(sw => rWords.some(rw => rw.includes(sw) || sw.includes(rw)));
}

/**
 * Check if receipt time is recent (within 24 hours)
 */
function isRecentReceipt(dateStr) {
    if (!dateStr) return { recent: true, hoursAgo: null }; // No date = can't check, assume OK
    try {
        const receiptDate = new Date(dateStr);
        if (isNaN(receiptDate.getTime())) return { recent: true, hoursAgo: null };
        const hoursDiff = (Date.now() - receiptDate.getTime()) / (1000 * 60 * 60);
        return { recent: hoursDiff <= 24, hoursAgo: Math.round(hoursDiff) };
    } catch {
        return { recent: true, hoursAgo: null };
    }
}

/**
 * MAIN VALIDATION — decides: auto-deny, forward to owner, or verified
 * 
 * Returns: {
 *   action: 'DENY' | 'FORWARD' | 'VERIFIED',
 *   reason: string (for customer),
 *   ownerReport: string (for owner, only if FORWARD/VERIFIED),
 *   details: {}
 * }
 */
export function validateReceipt(receipt, pending, shopPaymentInfo) {
    if (!receipt) return { action: 'DENY', reason: 'Samahani, sikuweza kusoma receipt hiyo. Tafadhali tuma tena au tuma SMS ya M-Pesa.' };

    const shopName = extractShopName(shopPaymentInfo);
    const timeCheck = isRecentReceipt(receipt.date);

    // 1. RECIPIENT NAME CHECK — must match shop name
    const nameOK = recipientMatchesShop(receipt.recipient, shopName);
    if (!nameOK && receipt.recipient) {
        return {
            action: 'DENY',
            reason: `Pole, receipt hii inaonyesha malipo kwa "${receipt.recipient}" lakini akaunti yetu ni "${shopName}". Tafadhali tuma kwa namba sahihi na itumie tena.`,
            details: { recipient: receipt.recipient, expectedShop: shopName },
        };
    }

    // 2. TIME CHECK — must be recent (within 24 hours)
    if (!timeCheck.recent) {
        return {
            action: 'DENY',
            reason: `Pole, receipt hii ni ya zamani (masaa ${timeCheck.hoursAgo}). Tafadhali tuma receipt ya malipo ya hivi karibuni.`,
            details: { hoursAgo: timeCheck.hoursAgo },
        };
    }

    // 3. AMOUNT CHECK — if pending order exists
    const expectedAmount = pending ? parseInt(String(pending.price).replace(/,/g, '').replace(/\D/g, '')) : null;
    const amountOK = expectedAmount && receipt.amount ? (receipt.amount >= expectedAmount) : null;

    // Name ✓ + Time ✓ + Amount ✓ → VERIFIED
    if (amountOK === true) {
        return {
            action: 'VERIFIED',
            reason: 'Asante, malipo yako yamethibitishwa. Tutawasiliana nawe hivi karibuni kuhusu delivery.',
            details: { amount: receipt.amount, expectedAmount, transactionId: receipt.transactionId },
        };
    }

    // Name ✓ + Time ✓ + Amount wrong/missing → FORWARD to owner for review
    return {
        action: 'FORWARD',
        reason: receipt.amount && expectedAmount && receipt.amount < expectedAmount
            ? `Nimepokea receipt yako, lakini kiasi (TZS ${receipt.amount.toLocaleString()}) ni kidogo kuliko bei iliyokubalika (TZS ${expectedAmount.toLocaleString()}). Tunawasiliana na mhudumu kukagua.`
            : 'Nimepokea receipt yako. Tunakagua malipo sasa.',
        details: { amount: receipt.amount, expectedAmount, transactionId: receipt.transactionId },
    };
}

/**
 * Check if text looks like an M-Pesa receipt
 */
export function isMpesaText(text) {
    if (!text || text.length < 20) return false;
    return /(?:M-Pesa|Confirmed|Imethibitishwa|imetumwa|muamala|Salio\s+lako)/i.test(text);
}
