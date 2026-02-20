import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

// Ensure data directory exists
mkdirSync('data', { recursive: true });

const db = new Database('data/patana.db');

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    phone TEXT PRIMARY KEY,
    history TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    item_sold TEXT,
    agreed_price INTEGER,
    delivery_location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ Database initialized at data/patana.db');

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

export default db;
