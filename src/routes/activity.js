import { Router } from "express";
import { ActivityLog } from "../models/ActivityLog.js";
import { Merchant } from "../models/Merchant.js";

import { GlobalNotification } from "../models/GlobalNotification.js";

const router = Router();

// GET /activity — Returns recent activity logs filtered by shop
router.get("/", async (req, res) => {
  try {
    const shop = req.shopifyShop || req.query.shop;
    console.log(`[Activity] Fetching for shop: ${shop}`);

    if (!shop) {
      return res.status(400).json({ error: "Missing shop parameter" });
    }

    const merchant = await Merchant.findOne({
      shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
    });

    if (!merchant) {
      return res.json([]);
    }

    // 1. Fetch Merchant Specific Logs
    const logs = await ActivityLog.find({ merchant: merchant._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // 2. Fetch Global Broadcasts
    const broadcasts = await GlobalNotification.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // 3. Merge and format broadcasts to match log structure for display
    const broadcastLogs = broadcasts.map(b => ({
      ...b,
      isBroadcast: true,
      type: b.type || 'info',
      message: b.message,
      customerName: "System",
      createdAt: b.createdAt
    }));

    const combined = [...logs, ...broadcastLogs]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);

    res.json(combined);
  } catch (err) {
    console.error("Error fetching activity logs", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
