import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

// Ensure data directory exists
mkdirSync('data', { recursive: true });

const db = new Database('data/patana.db');

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create tables (with enterprise upgrades)
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    phone TEXT PRIMARY KEY,
    history TEXT DEFAULT '[]',
    bot_paused BOOLEAN DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    item_sold TEXT,
    agreed_price INTEGER,
    delivery_location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS missed_opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_requested TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate: add bot_paused column if missing (safe for existing DBs)
try {
  db.exec(`ALTER TABLE customers ADD COLUMN bot_paused BOOLEAN DEFAULT 0`);
} catch {
  // Column already exists — ignore
}

console.log('✅ Database initialized at data/patana.db (Enterprise Edition)');

// --- Helper Functions ---

/**
 * Get chat history for a customer
 * @param {string} phone - Customer phone number
 * @returns {Array} Chat history array
 */
export function getHistory(phone) {
  const row = db.prepare('SELECT history FROM customers WHERE phone = ?').get(phone);
  if (!row) return [];
  try {
    return JSON.parse(row.history);
  } catch {
    return [];
  }
}

/**
 * Save chat history for a customer (max 15 messages to keep context tight)
 * @param {string} phone - Customer phone number
 * @param {Array} history - Chat history array
 */
export function saveHistory(phone, history) {
  // Keep only the last 15 messages to avoid token overflow
  const trimmed = history.slice(-15);
  const json = JSON.stringify(trimmed);

  db.prepare(`
    INSERT INTO customers (phone, history) VALUES (?, ?)
    ON CONFLICT(phone) DO UPDATE SET history = excluded.history
  `).run(phone, json);
}

/**
 * Save a closed order to the database
 * @param {string} phone - Customer phone number
 * @param {string} item - Item sold
 * @param {number|string} price - Agreed price
 * @param {string} location - Delivery location
 */
export function saveOrder(phone, item, price, location) {
  db.prepare(`
    INSERT INTO orders (phone, item_sold, agreed_price, delivery_location)
    VALUES (?, ?, ?, ?)
  `).run(phone, item, parseInt(price) || 0, location);

  console.log(`🛒 ORDER SAVED: ${item} @ TZS ${price} → ${location} (Customer: ${phone})`);
}

// --- Enterprise: Human Override ---

/**
 * Pause the bot for a specific customer (owner takes over)
 * @param {string} phone - Customer phone number
 */
export function pauseBot(phone) {
  db.prepare(`
    INSERT INTO customers (phone, bot_paused) VALUES (?, 1)
    ON CONFLICT(phone) DO UPDATE SET bot_paused = 1
  `).run(phone);

  console.log(`⏸️ BOT PAUSED for customer: ${phone} (Owner takeover)`);
}

/**
 * Check if the bot is active for a customer
 * @param {string} phone - Customer phone number
 * @returns {boolean} true if bot is active, false if paused
 */
export function isBotActive(phone) {
  const row = db.prepare('SELECT bot_paused FROM customers WHERE phone = ?').get(phone);
  if (!row) return true; // New customer — bot is active
  return row.bot_paused === 0;
}

/**
 * Resume the bot for a specific customer
 * @param {string} phone - Customer phone number
 */
export function resumeBot(phone) {
  db.prepare('UPDATE customers SET bot_paused = 0 WHERE phone = ?').run(phone);
  console.log(`▶️ BOT RESUMED for customer: ${phone}`);
}

/**
 * Resume the bot for ALL customers (unpause everyone)
 * @returns {number} Number of customers unpaused
 */
export function resumeAllBots() {
  const result = db.prepare('UPDATE customers SET bot_paused = 0 WHERE bot_paused = 1').run();
  console.log(`▶️ BOT RESUMED for ALL customers (${result.changes} unpaused)`);
  return result.changes;
}

// --- Enterprise: Missed Opportunities ---

/**
 * Log a missed sales opportunity (item not in stock)
 * @param {string} item - Item requested by customer
 */
export function saveMissedOpportunity(item) {
  db.prepare(`
    INSERT INTO missed_opportunities (item_requested) VALUES (?)
  `).run(item);

  console.log(`📉 MISSED OPPORTUNITY: "${item}" requested but not in stock`);
}

// --- Enterprise: Daily Intelligence Report ---

/**
 * Get daily business summary for the owner
 * @returns {Object} { totalRevenue, orderCount, missedItems }
 */
export function getDailySummary() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const revenueRow = db.prepare(`
    SELECT COALESCE(SUM(agreed_price), 0) as total, COUNT(*) as count
    FROM orders
    WHERE DATE(created_at) = ?
  `).get(today);

  const missedRows = db.prepare(`
    SELECT item_requested
    FROM missed_opportunities
    WHERE DATE(date) = ?
  `).all(today);

  const missedItems = missedRows.map(r => r.item_requested);

  return {
    totalRevenue: revenueRow.total,
    orderCount: revenueRow.count,
    missedItems: missedItems.length > 0 ? missedItems.join(', ') : 'Hakuna',
  };
}

export default db;
