import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock better-sqlite3 to use in-memory database
vi.mock('better-sqlite3', async (importOriginal) => {
    const ActualDatabase = await importOriginal();
    // Return a constructor function
    return {
        default: function(filename, options) {
            return new ActualDatabase.default(':memory:', options);
        }
    };
});

// Import the module under test. This will trigger the top-level DB initialization using our mock.
import db, * as dbModule from '../src/db.js';

describe('Database Module', () => {
    beforeEach(() => {
        // Clear tables to ensure test isolation
        db.exec('DELETE FROM customers');
        db.exec('DELETE FROM orders');
        db.exec('DELETE FROM missed_opportunities');
    });

    describe('saveOrder', () => {
        it('should save an order to the database', () => {
            dbModule.saveOrder('255712345678', 'Samsung A54', 600000, 'Kariakoo');

            const row = db.prepare('SELECT * FROM orders WHERE phone = ?').get('255712345678');
            expect(row).toBeDefined();
            expect(row.item_sold).toBe('Samsung A54');
            expect(row.agreed_price).toBe(600000);
            expect(row.delivery_location).toBe('Kariakoo');
        });
    });

    describe('Chat History', () => {
        it('should save and retrieve chat history', () => {
            const phone = '255712345678';
            const history = [
                { role: 'user', parts: [{ text: 'Hi' }] },
                { role: 'model', parts: [{ text: 'Hello' }] }
            ];

            dbModule.saveHistory(phone, history);

            const retrieved = dbModule.getHistory(phone);
            expect(retrieved).toHaveLength(2);
            expect(retrieved[0].parts[0].text).toBe('Hi');
        });

        it('should trim history to last 15 messages', () => {
            const phone = '255712345678';
            const history = Array.from({ length: 20 }, (_, i) => ({ role: 'user', msg: i }));

            dbModule.saveHistory(phone, history);

            const retrieved = dbModule.getHistory(phone);
            expect(retrieved).toHaveLength(15);
            // Should keep the last ones (last one is 19)
            expect(retrieved[14].msg).toBe(19);
        });
    });

    describe('Customer Profile', () => {
        it('should return default profile for new customer', () => {
            const profile = dbModule.getCustomerProfile('new_phone');
            expect(profile.rating).toBe(3);
            expect(profile.escalations).toBe(0);
            expect(profile.label).toContain('Mpya'); // Assuming implementation logic
        });

        it('should return correct profile for existing customer', () => {
            const phone = '255700000001';
            db.prepare('INSERT INTO customers (phone, customer_rating, escalation_count) VALUES (?, ?, ?)').run(phone, 5, 2);

            const profile = dbModule.getCustomerProfile(phone);
            expect(profile.rating).toBe(5);
            expect(profile.escalations).toBe(2);
            expect(profile.label).toContain('VIP');
        });
    });

    describe('Daily Summary', () => {
        it('should generate correct daily summary', () => {
            // Insert orders
            dbModule.saveOrder('1', 'Item1', 1000, 'Loc1');
            dbModule.saveOrder('2', 'Item2', 2000, 'Loc2');

            // Insert missed opportunity
            dbModule.saveMissedOpportunity('MissingItem');

            const summary = dbModule.getDailySummary();

            expect(summary.orderCount).toBe(2);
            expect(summary.totalRevenue).toBe(3000);
            expect(summary.missedItems).toContain('MissingItem');
        });
    });
});
