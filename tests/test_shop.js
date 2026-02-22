import { test } from 'node:test';
import assert from 'node:assert';
import { getShopContext } from '../src/shop.js';

test('getShopContext returns correct format for standard profile', (t) => {
    const dummyProfile = {
        shop_name: "Test Shop",
        payment_info: "Test Payment Info",
        delivery_policy: "Test Delivery Policy",
        payment_policy: "pay_first",
        inventory: [
            {
                id: "item1",
                item: "Item One",
                condition: "New",
                public_price: 1000,
                secret_floor_price: 800,
                stock_qty: 10,
                brand: "BrandA",
                tier: "Tier1",
                features: "Feature1, Feature2",
                images: ["img1.jpg", "img2.jpg"]
            }
        ]
    };

    const context = getShopContext(dummyProfile);

    assert.ok(context.includes("🏪 DUKA: Test Shop"));
    assert.ok(context.includes("💰 MALIPO: Test Payment Info"));
    assert.ok(context.includes("🚚 DELIVERY: Test Delivery Policy"));
    assert.ok(context.includes("📋 SERA YA MALIPO: Mteja ANALIPA KWANZA"));
    assert.ok(context.includes("• [ID: item1] Item One"));
    assert.ok(context.includes("Brand: BrandA | Tier: Tier1"));
    assert.ok(context.includes("⭐ Features: Feature1, Feature2"));
    assert.ok(context.includes("🖼️ Picha: 2 (item1)"));
    assert.ok(context.includes("📦 Stock: 10 pcs"));
});

test('getShopContext handles SOLD OUT items', (t) => {
    const dummyProfile = {
        shop_name: "Test Shop",
        payment_info: "Info",
        delivery_policy: "Delivery",
        inventory: [
            {
                id: "item2",
                item: "Item Two",
                condition: "Used",
                public_price: 500,
                secret_floor_price: 400,
                stock_qty: 0
            }
        ]
    };

    const context = getShopContext(dummyProfile);

    assert.ok(context.includes("• [ID: item2] Item Two ❌ SOLD OUT"));
    assert.ok(context.includes("📦 Stock: 0 pcs"));
});

test('getShopContext handles payment policy: pay_on_delivery', (t) => {
    const dummyProfile = {
        shop_name: "Test Shop",
        payment_info: "Info",
        delivery_policy: "Delivery",
        payment_policy: "pay_on_delivery",
        inventory: []
    };

    const context = getShopContext(dummyProfile);

    assert.ok(context.includes("📋 SERA YA MALIPO: Mteja ANALIPA BAADAYE akipokea na kukagua mzigo (COD)"));
});

test('getShopContext handles missing optional fields gracefully', (t) => {
    const dummyProfile = {
        shop_name: "Test Shop",
        payment_info: "Info",
        delivery_policy: "Delivery",
        inventory: [
            {
                id: "item3",
                item: "Item Three",
                condition: "New",
                public_price: 100,
                secret_floor_price: 80,
                stock_qty: 5
                // Missing brand, tier, features, images
            }
        ]
    };

    const context = getShopContext(dummyProfile);

    assert.ok(context.includes("• [ID: item3] Item Three"));
    // Should NOT include lines for missing fields
    assert.ok(!context.includes("Brand:"));
    assert.ok(!context.includes("Tier:"));
    assert.ok(!context.includes("⭐ Features:"));
    assert.ok(!context.includes("🖼️ Picha:"));
});
