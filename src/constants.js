import dotenv from 'dotenv';
dotenv.config();

// Normalize OWNER_PHONE — strip '+' if present
export const OWNER_PHONE = (process.env.OWNER_PHONE || '').replace(/^\+/, '');

// --- Tag Regex Patterns ---
export const ORDER_TAG_REGEX = /\[ORDER_CLOSED:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\]/;
export const PENDING_PAYMENT_TAG_REGEX = /\[PENDING_PAYMENT:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\]/;
export const RECEIPT_TAG_REGEX = /\[RECEIPT_UPLOADED\]/;
export const SEND_IMAGE_TAG_REGEX = /\[SEND_IMAGE:\s*([^\]]+)\]/;
export const ALERT_TAG_REGEX = /\[ALERT:\s*(.+?)\s*\]/;
export const OOS_TAG_REGEX = /\[OUT_OF_STOCK:\s*(.+?)\s*\]/;
export const CHECK_STOCK_TAG_REGEX = /\[CHECK_STOCK:\s*(.+?)\s*\]/;
export const TROLL_TAG_REGEX = /\[TROLL\]/;

// --- Anti-Spam: Rate Limiter (per customer) ---
export const COOLDOWN_MS = 5000;

// --- Anti-Troll: Auto-ignore time-wasters ---
export const TROLL_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// --- Escalation Relay: Active escalations (multi-customer) ---
export const MAX_ESCALATIONS_PER_CUSTOMER = 5;

// --- Stock Check Queue: Owner has 9 min (3 reminders × 3 min) to reply ---
export const STOCK_CHECK_REMINDER_MS = 3 * 60 * 1000; // 3 minutes
