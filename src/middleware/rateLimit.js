import { COOLDOWN_MS } from '../constants.js';

export function shouldIgnore(message, state) {
    const msgId = message.id?._serialized || message.id?.id || `${message.from}_${message.timestamp}`;
    if (state.recentMessageIds.has(msgId)) {
        console.log(`🔁 [DEDUP] Dropped duplicate: ${msgId.slice(-12)} from ${message.from.slice(0, 6)}`);
        return true;
    }
    state.recentMessageIds.add(msgId);
    setTimeout(() => state.recentMessageIds.delete(msgId), 15000);
    return false;
}

export function checkRateLimit(userPhone, chatKey, message, state) {
    const now = Date.now();
    const lastTime = state.lastMessageTime.get(chatKey);
    if (lastTime) {
        const elapsed = now - lastTime;
        if (elapsed < COOLDOWN_MS) {
            console.log(`🛡️ [RATE LIMIT] ${userPhone} — ${elapsed}ms since last msg (need ${COOLDOWN_MS}ms). Text: "${(message.body || '').slice(0, 30)}"`);
            return true; // limit exceeded
        }
    }
    state.lastMessageTime.set(chatKey, now);
    return false; // ok
}

export function checkTrollCooldown(userPhone, state) {
    const now = Date.now();
    const trollExpiry = state.trollCooldown.get(userPhone);
    if (trollExpiry && now < trollExpiry) {
        console.log(`🚫 [TROLL COOLDOWN] ${userPhone} — ignored (${Math.round((trollExpiry - now) / 60000)}m left)`);
        return true; // in cooldown
    }
    if (trollExpiry && now >= trollExpiry) {
        state.trollCooldown.delete(userPhone);
    }
    return false; // ok
}
