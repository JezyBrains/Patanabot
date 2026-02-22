import { test } from 'node:test';
import assert from 'node:assert';
import { sendMessageWithRetry } from '../src/ai.js';

// Mock console.warn to avoid cluttering output
const originalWarn = console.warn;
console.warn = () => {};

test('sendMessageWithRetry should retry on 429 errors', async () => {
    let callCount = 0;
    const mockChat = {
        sendMessage: async (content) => {
            callCount++;
            if (callCount < 2) { // Fail once
                const error = new Error('Too Many Requests');
                error.status = 429;
                throw error;
            }
            return { response: { text: () => 'Success' } };
        }
    };

    const start = Date.now();
    const result = await sendMessageWithRetry(mockChat, 'test', 3);
    const end = Date.now();

    assert.strictEqual(result.response.text(), 'Success');
    assert.strictEqual(callCount, 2);
    // Should have waited at least 1000ms
    assert.ok((end - start) >= 1000, 'Should wait for retry delay');
});

test('sendMessageWithRetry should retry on 503 errors', async () => {
    let callCount = 0;
    const mockChat = {
        sendMessage: async (content) => {
            callCount++;
            if (callCount < 2) { // Fail once
                const error = new Error('Service Unavailable');
                error.status = 503;
                throw error;
            }
            return { response: { text: () => 'Success' } };
        }
    };

    const result = await sendMessageWithRetry(mockChat, 'test', 3);
    assert.strictEqual(result.response.text(), 'Success');
    assert.strictEqual(callCount, 2);
});

test('sendMessageWithRetry should fail after max retries', async () => {
    let callCount = 0;
    const mockChat = {
        sendMessage: async (content) => {
            callCount++;
            const error = new Error('Too Many Requests');
            error.status = 429;
            throw error;
        }
    };

    try {
        // Use fewer retries to speed up test
        await sendMessageWithRetry(mockChat, 'test', 1);
        assert.fail('Should have thrown an error');
    } catch (error) {
        assert.strictEqual(error.status, 429);
        assert.strictEqual(callCount, 2); // Initial call + 1 retry
    }
});

// Restore console.warn
test.after(() => {
    console.warn = originalWarn;
});
