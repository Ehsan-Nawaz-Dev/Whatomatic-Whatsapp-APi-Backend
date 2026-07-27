import { Router } from "express";
import { ActivityLog } from "../models/ActivityLog.js";
import { Merchant } from "../models/Merchant.js";

const router = Router();

// Basic analytics summary derived from ActivityLog — filtered by shop
router.get("/", async (req, res) => {
  try {
    const shop = req.shopifyShop || req.query.shop;
    console.log(`[Analytics] Fetching for shop: ${shop}`);
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(now.getDate() - 60);

    if (!shop) {
      return res.status(400).json({ error: "Missing shop parameter" });
    }

    let baseFilter = {};
    if (shop) {
      const merchant = await Merchant.findOne({
        shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
      });

      if (merchant) {
        baseFilter.merchant = merchant._id;
      } else {
        return res.json({
          messagesSent: 0, recoveredCarts: 0, confirmedOrders: 0,
          responseRate: 0, abandonedCheckouts: 0, delivered: 0,
          replies: 0, recoveryRate: 0, cancelled: 0, periodDays: 30,
          dailyStats: [], growth: { sent: 0, recovered: 0, confirmed: 0, responseRate: 0 }
        });
      }
    }

    const currentLogs = await ActivityLog.find({ ...baseFilter, createdAt: { $gte: thirtyDaysAgo } }).lean();
    const previousLogs = await ActivityLog.find({ ...baseFilter, createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }).lean();

    const calculateStats = (logs) => {
      const total = logs.length;
      const confirmed = logs.filter((l) => l.type === "confirmed").length;
      const recovered = logs.filter((l) => l.type === "recovered").length;
      const cancelled = logs.filter((l) => l.type === "cancelled").length;
      return { total, confirmed, recovered, cancelled };
    };

    const current = calculateStats(currentLogs);
    const previous = calculateStats(previousLogs);

    const calculateGrowth = (curr, prev) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    const abandonedCheckouts = current.recovered + current.cancelled;
    const delivered = current.total;
    const replies = current.confirmed + current.recovered;

    const responseRate = delivered > 0 ? Math.round((replies / delivered) * 100) : 0;
    const recoveryRate = abandonedCheckouts > 0 ? Math.round((current.recovered / abandonedCheckouts) * 100) : 0;

    const previousResponseRate = previous.total > 0 ? Math.round(((previous.confirmed + previous.recovered) / previous.total) * 100) : 0;

    const growth = {
      sent: calculateGrowth(current.total, previous.total),
      recovered: calculateGrowth(current.recovered, previous.recovered),
      confirmed: calculateGrowth(current.confirmed, previous.confirmed),
      responseRate: calculateGrowth(responseRate, previousResponseRate)
    };

    const dailyAggregation = await ActivityLog.aggregate([
      { $match: { ...baseFilter, createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    const dailyStats = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const stat = dailyAggregation.find(a => a._id === dateStr);
      dailyStats.push({
        date: dateStr,
        count: stat ? stat.count : 0
      });
    }

    res.json({
      messagesSent: current.total,
      recoveredCarts: current.recovered,
      confirmedOrders: current.confirmed,
      responseRate,
      abandonedCheckouts,
      delivered,
      replies,
      recoveryRate,
      cancelled: current.cancelled,
      periodDays: 30,
      dailyStats,
      growth
    });
  } catch (err) {
    console.error("Error building analytics summary", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
