import { Router } from "express";
import { Merchant } from "../models/Merchant.js";
import { NotificationSettings } from "../models/NotificationSettings.js";

const router = Router();

// Helper to resolve merchant by shop domain (for now via query param)
const getShopDomain = (req) => {
  if (req.shopifyShop) return req.shopifyShop;
  const shop = req.query.shop || req.headers["x-shop-domain"];
  if (!shop) return null;
  return shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
};

// Resolve merchant by shop domain, creating if needed
const resolveMerchant = async (shopDomain) => {
  if (!shopDomain) return null;
  let merchant = await Merchant.findOne({ shopDomain });
  if (!merchant) {
    merchant = await Merchant.create({ shopDomain });
  }
  return merchant;
};

// GET /api/notifications - fetch notification settings for merchant
router.get("/", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    const merchant = await resolveMerchant(shopDomain);
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });

    let settings = await NotificationSettings.findOne({ merchant: merchant._id });
    if (!settings) {
      settings = await NotificationSettings.create({ merchant: merchant._id });
    }

    res.json(settings);
  } catch (err) {
    console.error("Error fetching notification settings", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/notifications - update notification settings for merchant
router.put("/", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    const merchant = await resolveMerchant(shopDomain);
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });

    const update = {
      notifyOnConfirm: req.body.notifyOnConfirm,
      notifyOnCancel: req.body.notifyOnCancel,
      notifyOnAbandoned: req.body.notifyOnAbandoned,
      emailAlerts: req.body.emailAlerts,
      whatsappAlerts: req.body.whatsappAlerts,
      pushNotifications: req.body.pushNotifications,
    };

    const settings = await NotificationSettings.findOneAndUpdate(
      { merchant: merchant._id },
      { $set: update, $setOnInsert: { merchant: merchant._id } },
      { new: true, upsert: true },
    );

    res.json(settings);
  } catch (err) {
    console.error("Error updating notification settings", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
