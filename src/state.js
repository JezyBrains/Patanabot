export class State {
    constructor() {
        // --- Pending Payments: Awaiting M-Pesa receipts ---
        // phone → { itemId, price, location, timestamp }
        this.pendingPayments = new Map();

        // --- Last product owner interacted with (for captionless photo attach) ---
        this.lastOwnerProduct = null;

        // --- Stock Check Queue: Owner has 9 min (3 reminders × 3 min) to reply ---
        // customerPhone → { item, reminders, timer, chatId }
        this.stockCheckQueue = new Map();

        // --- Escalation Relay: Active escalations (multi-customer) ---
        // customerPhone → { summary, timestamp }
        this.activeEscalations = new Map();

        // --- Anti-Spam: Rate Limiter (per customer) ---
        this.recentMessageIds = new Set();
        this.lastMessageTime = new Map();

        // --- Anti-Troll: Auto-ignore time-wasters ---
        // phone → expiry timestamp
        this.trollCooldown = new Map();
    }
}

export const state = new State();
