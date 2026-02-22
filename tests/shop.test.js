import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setPaymentPolicy, getPaymentPolicy, setProfilePathForTesting } from '../src/shop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Use a unique directory to avoid conflicts
const tempDir = join(__dirname, '..', 'data', 'test_temp_' + Date.now());
const tempProfilePath = join(tempDir, 'shop_profile.json');

const initialProfile = {
    shop_name: "Test Shop",
    payment_info: "Test Info",
    delivery_policy: "Test Policy",
    inventory: [],
    payment_policy: "pay_first"
};

describe('Shop Payment Policy', () => {

    before(() => {
        // Ensure temp directory exists
        if (!existsSync(tempDir)) {
            mkdirSync(tempDir, { recursive: true });
        }

        // Point the shop module to use our temp profile
        setProfilePathForTesting(tempProfilePath);
    });

    beforeEach(() => {
        // Create a fresh profile for each test
        writeFileSync(tempProfilePath, JSON.stringify(initialProfile, null, 4), 'utf-8');
    });

    after(() => {
        // Cleanup
        try {
            if (existsSync(tempDir)) {
                rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (e) {
            console.error('Failed to cleanup temp dir:', e);
        }
    });

    test('should update payment policy to "pay_on_delivery"', () => {
        const result = setPaymentPolicy('pay_on_delivery');
        assert.strictEqual(result, true);

        // Verify via getter (which reads from file)
        const policy = getPaymentPolicy();
        assert.strictEqual(policy, 'pay_on_delivery');
    });

    test('should update payment policy to "pay_first"', () => {
        // First set to something else to ensure change happens
        setPaymentPolicy('pay_on_delivery');

        const result = setPaymentPolicy('pay_first');
        assert.strictEqual(result, true);

        const policy = getPaymentPolicy();
        assert.strictEqual(policy, 'pay_first');
    });

    test('should verify persistence to file', () => {
        setPaymentPolicy('pay_on_delivery');

        // Read file manually to verify
        const content = readFileSync(tempProfilePath, 'utf-8');
        const profile = JSON.parse(content);
        assert.strictEqual(profile.payment_policy, 'pay_on_delivery');
    });
});
