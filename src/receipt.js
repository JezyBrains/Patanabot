/**
 * M-Pesa Receipt Verification Module
 * Parses text receipts, verifies screenshot receipts via Gemini Vision,
 * and validates amount/recipient/time against pending orders.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// M-Pesa text receipt patterns (both English and Swahili)
const MPESA_PATTERNS = [
    // "DBK5N1CCNFJ Confirmed. NAITWA SOLOMON has received Tsh 4000 on 2026-02-20 22:07:17"
    /([A-Z0-9]{10,13})\s*(?:Confirmed|Imethibitishwa).*?(?:received|imetumwa)\s*(?:Tsh|TSh|TZS)\s*([\d,]+(?:\.\d+)?)/i,
    // "Tsh4,000.00 imetumwa kwa TIPS-Mixx kwenye akaunti namba 44488141"
    /(?:Tsh|TSh|TZS)\s*([\d,]+(?:\.\d+)?)\s*(?:imetumwa|sent)\s*(?:kwa|to)\s+([A-Z][A-Za-z\s-]+)/i,
    // Generic M-Pesa pattern
    /([A-Z0-9]{10,13}).*?(?:Tsh|TSh|TZS)\s*([\d,]+(?:\.\d+)?)/i,
];

// Recipient name patterns
const RECIPIENT_PATTERNS = [
    /(?:received|imetumwa\s+kwa|sent\s+to|paid\s+to)\s+([A-Z][A-Za-z\s-]+?)(?:\s+(?:on|kwenye|tarehe|has))/i,
    /(?:kwa|to)\s+([A-Z][A-Za-z\s-]+?)(?:\s+(?:kwenye|on|akaunti))/i,
];

// Date/time patterns
const DATE_PATTERNS = [
    /(?:on|tarehe)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i,
    /tarehe\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+saa\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
    /(\d{4}-\d{2}-\d{2})/,
];

/**
 * Parse M-Pesa text receipt (forwarded text message)
 * Returns: { transactionId, amount, recipient, date, raw } or null
 */
export function parseMpesaText(text) {
    if (!text) return null;

    // Must contain M-Pesa indicators
    const isMpesa = /(?:M-Pesa|Tsh|TSh|TZS|Confirmed|Imethibitishwa|imetumwa|muamala)/i.test(text);
    if (!isMpesa) return null;

    let transactionId = null;
    let amount = null;
    let recipient = null;
    let date = null;

    // Extract transaction ID (10-13 char alphanumeric at start or standalone)
    const txMatch = text.match(/\b([A-Z0-9]{10,13})\b/);
    if (txMatch) transactionId = txMatch[1];

    // Extract amount
    for (const pattern of MPESA_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            // Find the group that looks like an amount
            for (let i = 1; i < match.length; i++) {
                const val = match[i]?.replace(/,/g, '');
                const num = parseFloat(val);
                if (!isNaN(num) && num > 0 && num < 100000000) {
                    amount = num;
                    break;
                }
            }
            if (amount) break;
        }
    }

    // Extract recipient name
    for (const pattern of RECIPIENT_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            recipient = match[1].trim();
            break;
        }
    }

    // Extract date
    for (const pattern of DATE_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            date = match[1];
            if (match[2]) date += ' ' + match[2]; // Add time if separate
            break;
        }
    }

    if (!amount && !transactionId) return null;

    return { transactionId, amount, recipient, date, raw: text };
}

/**
 * Verify receipt screenshot using Gemini Vision
 * Returns: { transactionId, amount, recipient, date } or null
 */
export async function verifyReceiptImage(mediaData, mimeType) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType: mimeType || 'image/jpeg',
                            data: mediaData,
                        }
                    },
                    {
                        text: `Hii ni picha ya receipt/muamala wa M-Pesa au malipo mengine. 
Tafadhali toa habari hizi PEKE YAKE (weka "null" kama haipo):

1. Transaction ID (namba ya muamala, mfano: DBK5N1CCNFJ)
2. Amount (kiasi kilicholipwa, nambari tu mfano: 50000)
3. Recipient (jina la aliyepokea pesa)
4. Date (tarehe na saa ya malipo)
5. Is this a valid payment receipt? (true/false)

JIBU KWA JSON TU, hakuna maelezo mengine:
{"transactionId": "...", "amount": 50000, "recipient": "...", "date": "...", "isReceipt": true}

Kama hii SI picha ya receipt/muamala (mfano: ni picha ya bidhaa, selfie, math, au kitu kingine) jibu:
{"isReceipt": false}`
                    }
                ]
            }],
        });

        const responseText = result.response.text().trim();
        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.isReceipt) return null;

        return {
            transactionId: parsed.transactionId !== 'null' ? parsed.transactionId : null,
            amount: typeof parsed.amount === 'number' ? parsed.amount : parseFloat(String(parsed.amount).replace(/,/g, '')),
            recipient: parsed.recipient !== 'null' ? parsed.recipient : null,
            date: parsed.date !== 'null' ? parsed.date : null,
        };

    } catch (err) {
        console.error(`❌ [RECEIPT VISION] Error: ${err.message}`);
        return null;
    }
}

/**
 * Validate receipt against pending payment
 * Returns: { valid, issues[], details }
 */
export function validateReceipt(receipt, pending, shopPaymentInfo) {
    const issues = [];
    const details = {};

    if (!receipt || !pending) {
        return { valid: false, issues: ['No receipt or pending payment data'], details };
    }

    // 1. Amount check
    const expectedAmount = parseInt(String(pending.price).replace(/,/g, '').replace(/\D/g, ''));
    if (receipt.amount) {
        details.amount = receipt.amount;
        details.expectedAmount = expectedAmount;
        if (receipt.amount < expectedAmount) {
            issues.push(`Kiasi kidogo: TZS ${receipt.amount.toLocaleString()} badala ya TZS ${expectedAmount.toLocaleString()}`);
        }
    } else {
        issues.push('Kiasi hakionekani kwenye receipt');
    }

    // 2. Recipient name check (fuzzy match against shop payment info)
    if (receipt.recipient && shopPaymentInfo) {
        details.recipient = receipt.recipient;
        // Extract expected name from payment_info (e.g., "M-Pesa: 0686479877 (Jina: Kariakoo Tech Hub)")
        const nameMatch = shopPaymentInfo.match(/(?:Jina:\s*|kwa\s+)([^).,]+)/i);
        const expectedName = nameMatch ? nameMatch[1].trim() : '';

        if (expectedName) {
            details.expectedRecipient = expectedName;
            const receiptNameLower = receipt.recipient.toLowerCase();
            const expectedNameLower = expectedName.toLowerCase();
            // Check if any word matches
            const expectedWords = expectedNameLower.split(/\s+/);
            const receiptWords = receiptNameLower.split(/\s+/);
            const anyMatch = expectedWords.some(w => receiptWords.includes(w) && w.length > 2);
            if (!anyMatch) {
                issues.push(`Jina halifanani: "${receipt.recipient}" vs "${expectedName}"`);
            }
        }
    }

    // 3. Time check (must be recent — within 24 hours)
    if (receipt.date) {
        details.date = receipt.date;
        // Try to parse date and check if recent
        try {
            const receiptDate = new Date(receipt.date);
            const now = new Date();
            const hoursDiff = (now - receiptDate) / (1000 * 60 * 60);
            if (hoursDiff > 24) {
                issues.push(`Receipt ni ya zamani (${Math.round(hoursDiff)} masaa)`);
            }
            details.hoursAgo = Math.round(hoursDiff);
        } catch {
            // Date parsing failed — not critical
        }
    }

    // 4. Transaction ID
    if (receipt.transactionId) {
        details.transactionId = receipt.transactionId;
    }

    return {
        valid: issues.length === 0,
        issues,
        details,
    };
}

/**
 * Check if text looks like an M-Pesa receipt
 */
export function isMpesaText(text) {
    if (!text || text.length < 20) return false;
    return /(?:M-Pesa|Confirmed|Imethibitishwa|imetumwa|muamala|Salio\s+lako)/i.test(text);
}
