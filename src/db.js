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

  CREATE TABLE IF NOT EXISTS drivers (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    phone TEXT NOT NULL,
    available BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    customer_phone TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    driver_phone TEXT NOT NULL,
    item TEXT,
    price TEXT,
    delivery_location TEXT,
    status TEXT DEFAULT 'dispatched',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate: add new columns if missing (safe for existing DBs)
const migrations = [
  'ALTER TABLE customers ADD COLUMN bot_paused BOOLEAN DEFAULT 0',
  'ALTER TABLE customers ADD COLUMN customer_rating INTEGER DEFAULT 3',
  'ALTER TABLE customers ADD COLUMN escalation_count INTEGER DEFAULT 0',
];
for (const sql of migrations) {
  try { db.exec(sql); } catch { /* column already exists */ }
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

// --- Enterprise: Escalation Tracking ---

export function getEscalationCount(phone) {
  const row = db.prepare('SELECT escalation_count FROM customers WHERE phone = ?').get(phone);
  return row ? row.escalation_count : 0;
}

export function incrementEscalation(phone) {
  db.prepare(`
    INSERT INTO customers (phone, escalation_count) VALUES (?, 1)
    ON CONFLICT(phone) DO UPDATE SET escalation_count = escalation_count + 1
  `).run(phone);
  return getEscalationCount(phone);
}

export function resetEscalation(phone) {
  db.prepare('UPDATE customers SET escalation_count = 0 WHERE phone = ?').run(phone);
}

// --- Enterprise: Customer Rating (1-5 stars) ---

export function getCustomerRating(phone) {
  const row = db.prepare('SELECT customer_rating FROM customers WHERE phone = ?').get(phone);
  return row ? row.customer_rating : 3; // Default: neutral
}

export function setCustomerRating(phone, rating) {
  const clamped = Math.max(1, Math.min(5, parseInt(rating) || 3));
  db.prepare(`
    INSERT INTO customers (phone, customer_rating) VALUES (?, ?)
    ON CONFLICT(phone) DO UPDATE SET customer_rating = ?
  `).run(phone, clamped, clamped);
  console.log(`⭐ Customer ${phone} rated: ${'⭐'.repeat(clamped)}`);
}

export function getCustomerProfile(phone) {
  const row = db.prepare('SELECT customer_rating, escalation_count FROM customers WHERE phone = ?').get(phone);
  if (!row) return { rating: 3, escalations: 0, label: '🟡 Mpya' };

  const r = row.customer_rating;
  let label;
  if (r >= 5) label = '🟢 VIP Safi';
  else if (r >= 4) label = '🟢 Mteja Mzuri';
  else if (r >= 3) label = '🟡 Kawaida';
  else if (r >= 2) label = '🟠 Mgumu';
  else label = '🔴 Hatari';

  return { rating: r, escalations: row.escalation_count, label };
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

// ============================================================
// DRIVER MANAGEMENT
// ============================================================

export function addDriver(name, phone) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  db.prepare(`INSERT OR REPLACE INTO drivers (name, phone) VALUES (?, ?)`)
    .run(name.toLowerCase(), cleanPhone);
}

export function getDriverByName(name) {
  return db.prepare(`SELECT * FROM drivers WHERE name = ? COLLATE NOCASE`).get(name.toLowerCase());
}

export function listDrivers() {
  return db.prepare(`SELECT name, phone, available FROM drivers ORDER BY name`).all();
}

export function removeDriver(name) {
  db.prepare(`DELETE FROM drivers WHERE name = ? COLLATE NOCASE`).run(name.toLowerCase());
}

// ============================================================
// DELIVERY TRACKING
// ============================================================

export function createDelivery(customerPhone, driverName, driverPhone, item, price, location, orderId) {
  return db.prepare(`
        INSERT INTO deliveries (order_id, customer_phone, driver_name, driver_phone, item, price, delivery_location)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(orderId || null, customerPhone, driverName, driverPhone, item || '', price || '', location || '');
}

export function getActiveDeliveryByCustomer(customerPhone) {
  return db.prepare(`
        SELECT * FROM deliveries 
        WHERE customer_phone = ? AND status IN ('dispatched', 'in_transit')
        ORDER BY created_at DESC LIMIT 1
    `).get(customerPhone);
}

export function getActiveDeliveryByDriver(driverPhone) {
  return db.prepare(`
        SELECT * FROM deliveries 
        WHERE driver_phone = ? AND status IN ('dispatched', 'in_transit')
        ORDER BY created_at DESC LIMIT 1
    `).get(driverPhone);
}

export function updateDeliveryStatus(deliveryId, status) {
  db.prepare(`UPDATE deliveries SET status = ? WHERE id = ?`).run(status, deliveryId);
}

export function getRecentOrderByPhone(phone) {
  return db.prepare(`
        SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC LIMIT 1
    `).get(phone);
}

// ============================================================
// TOKEN USAGE TRACKING
// ============================================================

export function logTokenUsage(phone, model, inputTokens, outputTokens) {
  db.prepare(`INSERT INTO token_usage (phone, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)`)
    .run(phone, model, inputTokens || 0, outputTokens || 0);
}

/** Get usage per client (today, this week, all time) */
export function getTokenUsageSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const allTime = db.prepare(`
        SELECT phone, 
               SUM(input_tokens) as total_input,
               SUM(output_tokens) as total_output,
               COUNT(*) as requests
        FROM token_usage GROUP BY phone ORDER BY total_input DESC
    `).all();

  const todayUsage = db.prepare(`
        SELECT phone,
               SUM(input_tokens) as total_input,
               SUM(output_tokens) as total_output,
               COUNT(*) as requests
        FROM token_usage WHERE DATE(created_at) = ? GROUP BY phone ORDER BY total_input DESC
    `).all(today);

  const totals = db.prepare(`
        SELECT SUM(input_tokens) as total_input, SUM(output_tokens) as total_output, COUNT(*) as requests
        FROM token_usage
    `).get();

  return { allTime, todayUsage, totals };
}

export default db;
