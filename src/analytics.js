import db from './db.js';

/**
 * Get weekly summary (last 7 days)
 * @returns {Object} { revenue, orderCount, avgOrderValue }
 */
export function getWeeklySummary() {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(agreed_price), 0) as revenue,
      COUNT(*) as orderCount
    FROM orders
    WHERE created_at >= date('now', '-7 days')
  `).get();

  const avgOrderValue = row.orderCount > 0 ? Math.round(row.revenue / row.orderCount) : 0;

  return {
    revenue: row.revenue,
    orderCount: row.orderCount,
    avgOrderValue
  };
}

/**
 * Get top selling products
 * @param {number} days - Number of days to look back
 * @returns {Array} [{ item, qty }]
 */
export function getTopProducts(days = 7) {
  return db.prepare(`
    SELECT item_sold as item, COUNT(*) as qty
    FROM orders
    WHERE created_at >= date('now', '-' || ? || ' days')
    GROUP BY item_sold
    ORDER BY qty DESC
    LIMIT 5
  `).all(days);
}

/**
 * Get top missed opportunities
 * @param {number} days - Number of days to look back
 * @returns {Array} [{ item, qty }]
 */
export function getTopMissed(days = 7) {
  return db.prepare(`
    SELECT item_requested as item, COUNT(*) as qty
    FROM missed_opportunities
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY item_requested
    ORDER BY qty DESC
    LIMIT 5
  `).all(days);
}

/**
 * Get customer segmentation by rating
 * @returns {Array} [{ rating, count, label }]
 */
export function getCustomerSegments() {
  const segments = db.prepare(`
    SELECT customer_rating as rating, COUNT(*) as count
    FROM customers
    GROUP BY customer_rating
    ORDER BY rating DESC
  `).all();

  return segments.map(s => {
    let label;
    if (s.rating >= 5) label = 'VIP Safi';
    else if (s.rating >= 4) label = 'Mteja Mzuri';
    else if (s.rating >= 3) label = 'Kawaida';
    else if (s.rating >= 2) label = 'Mgumu';
    else label = 'Hatari';
    return { ...s, label };
  });
}

/**
 * Get conversion rate (Orders / Unique Conversations)
 * @param {number} days - Number of days to look back
 * @returns {Object} { conversionRate, uniqueConversations, totalOrders }
 */
export function getConversionRate(days = 7) {
  const uniqueConversations = db.prepare(`
    SELECT COUNT(DISTINCT phone) as count
    FROM messages
    WHERE date >= date('now', '-' || ? || ' days')
      AND direction = 'in'
  `).get(days).count;

  const totalOrders = db.prepare(`
    SELECT COUNT(*) as count
    FROM orders
    WHERE created_at >= date('now', '-' || ? || ' days')
  `).get(days).count;

  const conversionRate = uniqueConversations > 0
    ? ((totalOrders / uniqueConversations) * 100).toFixed(1) + '%'
    : '0%';

  return { conversionRate, uniqueConversations, totalOrders };
}

/**
 * Get peak hours by message volume
 * @param {number} days - Number of days to look back
 * @returns {Array} [{ hour, count }]
 */
export function getPeakHours(days = 7) {
  return db.prepare(`
    SELECT strftime('%H', date) as hour, COUNT(*) as count
    FROM messages
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY hour
    ORDER BY count DESC
    LIMIT 5
  `).all(days);
}
