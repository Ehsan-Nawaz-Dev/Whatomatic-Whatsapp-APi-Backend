import { Router } from "express";
import { Merchant } from "../models/Merchant.js";
import { ChatButtonSettings } from "../models/ChatButtonSettings.js";
import { normalizePhoneNumber } from "../utils/phoneNormalizer.js";

const router = Router();

// Helper to resolve merchant by shop domain (for now via query param)
const getShopDomain = (req) => {
  if (req.shopifyShop) return req.shopifyShop;
  const shop = req.query.shop || req.headers["x-shop-domain"];
  if (!shop) return null;
  return shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
};

// GET /api/settings/auth-status
router.get("/auth-status", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    const merchant = await Merchant.findOne({ shopDomain });
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });

    const appUrl = (process.env.SHOPIFY_APP_URL || "https://api.whatomatic.com").replace(/\/$/, "");

    // Determine the API prefix (case-sensitive support)
    const apiPrefix = req.originalUrl.includes("/Api") ? "/Api" : "/api";
    const reauthUrl = `${appUrl}${apiPrefix}/auth/shopify?shop=${shopDomain}`;

    res.json({
      authenticated: !!merchant.shopifyAccessToken && !merchant.needsReauth,
      needsReauth: merchant.needsReauth || false,
      reason: merchant.reauthReason || null,
      detectedAt: merchant.reauthDetectedAt || null,
      reauthUrl
    });
  } catch (err) {
    console.error("Error fetching auth status", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/settings
router.get("/", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    let merchant = await Merchant.findOne({ shopDomain });
    if (!merchant) return res.json(null);

    // Auto-fetch Shopify data if storeName is missing
    if (!merchant.storeName && merchant.shopifyAccessToken) {
      try {
        const axios = (await import("axios")).default;
        const shopResponse = await axios.get(`https://${shopDomain}/admin/api/2023-10/shop.json`, {
          headers: { "X-Shopify-Access-Token": merchant.shopifyAccessToken }
        });
        const shopData = shopResponse.data.shop;

        // Update merchant with fresh Shopify data
        merchant.storeName = shopData?.name || shopDomain;
        merchant.phone = merchant.phone || shopData?.phone || null;
        merchant.email = merchant.email || shopData?.email || null;
        merchant.country = merchant.country || shopData?.country_name || null;
        merchant.currency = merchant.currency || shopData?.currency || "USD";
        await merchant.save();

        console.log(`[Settings] Auto-fetched Shopify store name: ${merchant.storeName}`);
      } catch (shopifyErr) {
        console.warn("[Settings] Could not auto-fetch Shopify data:", shopifyErr.message);
      }
    }

    res.json(merchant);
  } catch (err) {
    console.error("Error fetching settings", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/settings
router.put("/", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    let defaultCountry = req.body.defaultCountry;
    if (!defaultCountry) {
      const existingMerchant = await Merchant.findOne({ shopDomain });
      defaultCountry = existingMerchant?.defaultCountry || "PK";
    }

    let adminPhone = req.body.adminPhoneNumber;
    if (adminPhone) {
      adminPhone = normalizePhoneNumber(adminPhone, defaultCountry);
    }

    const update = {
      storeName: req.body.storeName,
      whatsappNumber: req.body.whatsappNumber,
      adminPhoneNumber: adminPhone,
      defaultCountry: req.body.defaultCountry,
      language: req.body.language,
      orderConfirmTag: req.body.orderConfirmTag,
      orderCancelTag: req.body.orderCancelTag,
      pendingConfirmTag: req.body.pendingConfirmTag,
      adminNotifiedTag: req.body.adminNotifiedTag,
      noWhatsappTag: req.body.noWhatsappTag,
      orderConfirmReply: req.body.orderConfirmReply,
      orderCancelReply: req.body.orderCancelReply,
    };

    const merchant = await Merchant.findOneAndUpdate(
      { shopDomain },
      { $set: update, $setOnInsert: { shopDomain } },
      { new: true, upsert: true },
    );

    res.json(merchant);
  } catch (err) {
    console.error("Error updating settings", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/settings/chat-button
router.get("/chat-button", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    let settings = await ChatButtonSettings.findOne({ shopDomain });
    if (!settings) {
      // Return defaults if not found
      settings = {
        shopDomain,
        buttonText: "Chat with us",
        position: "right",
        color: "#25D366",
        enabled: true
      };
    }

    res.json(settings);
  } catch (err) {
    console.error("Error fetching chat button settings", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/settings/chat-button
router.post("/chat-button", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    const update = {
      phoneNumber: req.body.phoneNumber,
      buttonText: req.body.buttonText,
      position: req.body.position,
      color: req.body.color,
      enabled: req.body.enabled,
    };

    const settings = await ChatButtonSettings.findOneAndUpdate(
      { shopDomain },
      { $set: update },
      { new: true, upsert: true }
    );

    // ScriptTags are strictly prohibited by newest Shopify App Store rules.
    // Therefore, the Chat Button API injection has been disabled permanently.
    console.log(`[ScriptTag] Disabled. Shopify no longer supports ScriptTags for new apps.`);

    res.json(settings);
  } catch (err) {
    console.error("Error updating chat button settings", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
