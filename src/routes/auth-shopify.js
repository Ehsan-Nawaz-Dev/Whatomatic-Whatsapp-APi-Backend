import { Router } from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import { Merchant } from "../models/Merchant.js";
import { Template } from "../models/Template.js";
import { AutomationSetting } from "../models/AutomationSetting.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { Contact } from "../models/Contact.js";
import { NotificationSettings } from "../models/NotificationSettings.js";
import { WhatsAppSession } from "../models/WhatsAppSession.js";
import { AutomationStat } from "../models/AutomationStat.js";
import { Campaign } from "../models/Campaign.js";
import { ChatButtonSettings } from "../models/ChatButtonSettings.js";
import { PollMessage } from "../models/PollMessage.js";


dotenv.config();

const router = Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || "read_checkouts,read_customers,read_fulfillments,read_orders,write_orders,read_billing,write_billing";
console.log(`[OAuth] Active Scopes: ${SHOPIFY_SCOPES}`);
const SHOPIFY_APP_URL = (process.env.SHOPIFY_APP_URL || "http://localhost:5000").replace(/\/$/, "");
const FRONTEND_APP_URL = process.env.FRONTEND_APP_URL || "http://localhost:5173/dashboard";

// Step 1: Redirect merchant to Shopify OAuth
// GET /api/auth/shopify?shop={shop}.myshopify.com
router.get("/", async (req, res) => {
  const { shop, hmac, timestamp, host } = req.query;

  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return res.status(500).send("Shopify API credentials are not configured on the server");
  }

  // 1. SMART CHECK: Do we already have a valid token?
  try {
    const merchant = await Merchant.findOne({
      shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
    });

    if (merchant && merchant.shopifyAccessToken) {
      try {
        // Validate token by fetching shop info (very fast)
        await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
          headers: { "X-Shopify-Access-Token": merchant.shopifyAccessToken }
        });

        console.log(`[SmartAuth] Skip OAuth: Token is VALID for ${shop}. Redirecting...`);
        const targetUrl = new URL(FRONTEND_APP_URL);
        targetUrl.searchParams.set("shop", shop);
        if (host) targetUrl.searchParams.set("host", host);
        return res.redirect(targetUrl.toString());
      } catch (tokenErr) {
        console.warn(`[SmartAuth] Token found but INVALID for ${shop}: ${tokenErr.message}. Forcing OAuth.`);
      }
    }
  } catch (err) {
    console.error(`[SmartAuth] Error during check: ${err.message}`);
  }

  // 2. OAUTH FLOW: If no token, proceed to Shopify
  // NOTE: Shopify redirect URIs are CASE SENSITIVE. 
  // We MUST use /Api/ as whitelisted in your Partner Dashboard.
  const redirectUri = `${SHOPIFY_APP_URL}/Api/auth/shopify/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  console.log(`[OAuth] [START] Initiating flow for ${shop}. Redirecting to: ${installUrl}`);
  res.redirect(installUrl);
});

// Step 2: Handle OAuth callback - FULLY AUTOMATIC SETUP
// GET /api/auth/shopify/callback?shop=...&code=...&hmac=...
router.get("/callback", async (req, res) => {
  const { shop, code, hmac } = req.query;
  console.log(`[OAuth] [CALLBACK] Hit for shop: ${shop}. Code present: ${!!code}. HMAC: ${hmac}`);

  if (!shop || !code) {
    console.warn(`[OAuth] [CALLBACK] Missing shop or code. Redirecting to auth start.`);
    return res.redirect(`/Api/auth/shopify?shop=${shop}`);
  }

  // Verify HMAC (if provided) for security
  if (hmac && SHOPIFY_API_SECRET) {
    const queryParams = { ...req.query };
    delete queryParams.hmac;
    delete queryParams.signature; // Also remove signature if present

    const message = Object.keys(queryParams)
      .sort()
      .map(key => `${key}=${queryParams[key]}`)
      .join("&");

    const generatedHmac = crypto
      .createHmac("sha256", SHOPIFY_API_SECRET)
      .update(message)
      .digest("hex");

    if (generatedHmac !== hmac) {
      console.error("[OAuth] HMAC validation failed");
      return res.status(401).send("HMAC validation failed");
    }
    console.log("[OAuth] HMAC validated successfully");
  }

  let accessToken;
  let expires_in;
  let refresh_token;
  let refresh_token_expires_in;

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code
    });
    accessToken = tokenResponse.data.access_token;
    expires_in = tokenResponse.data.expires_in;
    refresh_token = tokenResponse.data.refresh_token;
    refresh_token_expires_in = tokenResponse.data.refresh_token_expires_in;
    console.log(`[OAuth] [TOKEN] Successfully exchanged code for ${shop}`);
  } catch (tokenError) {
    // Handle "authorization code was not found or was already used"
    console.error(`[OAuth] [TOKEN_ERROR] Failed to exchange token for ${shop}: ${tokenError.response?.data?.error_description || tokenError.message}`);

    // Check if we already have a valid merchant token from the FIRST request
    const existing = await Merchant.findOne({
      shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
    });

    if (existing && existing.shopifyAccessToken) {
      console.log(`[OAuth] RECOVERY: Merchant ${shop} already has a token. Treating simply as re-auth/duplicate request.`);
      accessToken = existing.shopifyAccessToken;
      refresh_token = existing.shopifyRefreshToken;
      expires_in = existing.shopifyTokenExpiresAt ? Math.round((new Date(existing.shopifyTokenExpiresAt).getTime() - Date.now()) / 1000) : null;
      refresh_token_expires_in = existing.shopifyRefreshTokenExpiresAt ? Math.round((new Date(existing.shopifyRefreshTokenExpiresAt).getTime() - Date.now()) / 1000) : null;
    } else {
      // Genuine error - no token exists
      console.error("[OAuth] FATAL: Code invalid and no existing token.");
      return res.status(500).send("Authentication failed. Please try installing again via the App Store.");
    }
  }

  // Proceed with setup (now using accessToken, whether new or recovered)

  // ===== AUTOMATIC SETUP STARTS HERE =====

  try {
    // 1. Fetch Shop Details
    let shopData = null;
    try {
      const shopResponse = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
        headers: { "X-Shopify-Access-Token": accessToken }
      });
      shopData = shopResponse.data.shop;
      console.log(`[OAuth] Fetched shop details: ${shopData.name}`);
    } catch (shopError) {
      console.warn("[OAuth] Could not fetch shop details:", shopError.message);
    }

    // 2. Create or Update Merchant Record
    const merchantData = {
      shopDomain: shop.toLowerCase(),
      shopifyAccessToken: accessToken,
      shopifyRefreshToken: refresh_token || null,
      shopifyTokenExpiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
      shopifyRefreshTokenExpiresAt: refresh_token_expires_in ? new Date(Date.now() + refresh_token_expires_in * 1000) : null,
      storeName: shopData?.name || shop,
      contactName: shopData?.shop_owner || null,
      email: shopData?.email || null,
      phone: shopData?.phone || null,
      currency: shopData?.currency || "USD",
      timezone: shopData?.iana_timezone || null,
      country: shopData?.country_name || null,
      pendingConfirmTag: "Pending Confirmation",
      orderConfirmTag: "Order Confirmed",
      orderCancelTag: "Order Cancel By customer",
      orderConfirmReply: "Thank you! Your order has been confirmed. ✅",
      orderCancelReply: "Your order has been cancelled. ❌",
      plan: "free",
      billingStatus: "active",
      isActive: true,
      installedAt: new Date(),
      needsReauth: false,
      reauthReason: null,
      reauthDetectedAt: null
    };

    const existingMerchant = await Merchant.findOne({
      shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
    });
    let merchant;
    let isNewMerchant = !existingMerchant;

    if (existingMerchant) {
      // Update existing - preserve custom settings, just update token and shop info
      console.log(`[OAuth] Updating existing merchant ${shop}. New Token Length: ${accessToken?.length}`);
      existingMerchant.shopifyAccessToken = accessToken;
      existingMerchant.shopifyRefreshToken = refresh_token || existingMerchant.shopifyRefreshToken;
      if (expires_in) {
        existingMerchant.shopifyTokenExpiresAt = new Date(Date.now() + expires_in * 1000);
      }
      if (refresh_token_expires_in) {
        existingMerchant.shopifyRefreshTokenExpiresAt = new Date(Date.now() + refresh_token_expires_in * 1000);
      }
      existingMerchant.storeName = shopData?.name || existingMerchant.storeName;
      existingMerchant.email = shopData?.email || existingMerchant.email;
      existingMerchant.phone = shopData?.phone || existingMerchant.phone;
      existingMerchant.currency = shopData?.currency || existingMerchant.currency;
      existingMerchant.timezone = shopData?.iana_timezone || existingMerchant.timezone;
      existingMerchant.country = shopData?.country_name || existingMerchant.country;
      existingMerchant.isActive = true;
      existingMerchant.needsReauth = false;
      existingMerchant.reauthReason = null;
      existingMerchant.reauthDetectedAt = null;

      const saved = await existingMerchant.save();
      console.log(`[OAuth] Save result: ${!!saved}`);
      merchant = existingMerchant;
      console.log(`[OAuth] Merchant RE-AUTHORIZED: ${shop}`);
    } else {
      merchant = await Merchant.create(merchantData);
      console.log(`[OAuth] NEW Merchant created: ${shop}`);
    }

    // 3. Register Webhooks Automatically
    const webhooksToRegister = [
      { topic: "orders/create", address: `${SHOPIFY_APP_URL}/Api/webhooks/shopify` },
      { topic: "orders/cancelled", address: `${SHOPIFY_APP_URL}/Api/webhooks/shopify` },
      { topic: "orders/updated", address: `${SHOPIFY_APP_URL}/Api/webhooks/shopify` },
      { topic: "checkouts/create", address: `${SHOPIFY_APP_URL}/Api/webhooks/shopify` },
      { topic: "checkouts/abandoned", address: `${SHOPIFY_APP_URL}/Api/webhooks/shopify` },
      { topic: "fulfillments/create", address: `${SHOPIFY_APP_URL}/Api/webhooks/shopify` },
      { topic: "fulfillments/update", address: `${SHOPIFY_APP_URL}/Api/webhooks/shopify` },
      { topic: "app/uninstalled", address: `${SHOPIFY_APP_URL}/Api/webhooks/shopify` }
    ];

    for (const webhook of webhooksToRegister) {
      try {
        await axios.post(
          `https://${shop}/admin/api/2024-01/webhooks.json`,
          { webhook: { ...webhook, format: "json" } },
          { headers: { "X-Shopify-Access-Token": accessToken } }
        );
        console.log(`[OAuth] Registered webhook: ${webhook.topic}`);
      } catch (webhookError) {
        // Webhook might already exist (422) or other error
        const errorMsg = webhookError.response?.data?.errors || webhookError.message;
        console.log(`[OAuth] Webhook ${webhook.topic}: ${JSON.stringify(errorMsg)}`);
      }
    }

    // 4. Seeding Default Data for a consistent merchant experience
    await seedMerchantData(merchant);

    console.log(`[OAuth] ✅ Automatic setup COMPLETE for ${shop}`);

    // Redirect to Shopify Admin Embedded App
    // We redirect to the /dashboard route within the embedded app context to avoid 404s at root
    const host = req.query.host;
    const shopName = shop.replace(".myshopify.com", "");
    const adminUrl = `https://admin.shopify.com/store/${shopName}/apps/${SHOPIFY_API_KEY}/dashboard?shop=${shop}&host=${host}&installed=true`;

    console.log(`[OAuth] Redirecting to: ${adminUrl}`);
    res.redirect(adminUrl);

  } catch (error) {
    console.error("[OAuth] Error during setup:", error.response?.data || error.message);
    res.status(500).send("Installation failed. Please try again.");
  }
});

/**
 * Function to seed default templates and automation settings for a merchant.
 * Ensures data is available immediately after installation.
 */
async function seedMerchantData(merchant) {
  const shopDomain = merchant.shopDomain;

  // 1. Create Default Templates
  const defaultTemplates = [
    {
      merchant: merchant._id,
      name: "Order Confirmation",
      event: "orders/create",
      message: `Hi {{customer_name}}! 👋\n\nThank you for your order from {{store_name}}!\n\n📦 *Order:* {{order_number}}\n🛒 *Items:* {{items_list}}\n💰 *Total:* {{grand_total}}\n📍 *Address:* {{address}}, {{city}}\n\nPlease confirm if these details are correct.`,
      enabled: true,
      isPoll: true,
      pollOptions: ["✅ Yes, Confirm", "❌ No, Cancel"]
    },
    {
      merchant: merchant._id,
      name: "Order Cancelled",
      event: "orders/cancelled",
      message: `Hi {{customer_name}},\n\nYour order {{order_number}} has been cancelled.\n\nIf this was a mistake, please contact us.\n\nThank you for shopping with {{store_name}}!`,
      enabled: false,
      isPoll: false
    },
    {
      merchant: merchant._id,
      name: "Shipment Update",
      event: "fulfillments/update",
      message: `Hi {{customer_name}}! 🚚\n\nGreat news! Your order {{order_number}} has been shipped via {{courier}}!\n\n📦 Tracking Number: {{tracking_number}}\n📍 Track your package: {{tracking_link}}\n\nThank you for shopping with {{store_name}}!`,
      enabled: false,
      isPoll: false
    },
    {
      merchant: merchant._id,
      name: "Delivery Update",
      event: "fulfillments/delivered",
      message: `Hi {{customer_name}}! 🚚\n\nYour order {{order_number}} has been delivered!\n\nThank you for shopping with {{store_name}}!`,
      enabled: false,
      isPoll: false
    },
    {
      merchant: merchant._id,
      name: "Order Confirmed Reply",
      event: "orders/confirmed",
      message: `Thank you {{customer_name}}! your order {{order_number}} has been confirmed. ✅ We will notify you when it ships.`,
      enabled: false,
      isPoll: false
    },
    {
      merchant: merchant._id,
      name: "Cart Recovery",
      event: "checkouts/abandoned",
      message: `Hi {{customer_name}}, you left something in your cart! 🛒\n\nClick here to finish your purchase: {{cart_link}}\n\nThank you for visiting {{store_name}}!`,
      enabled: false,
      isPoll: false
    },
    {
      merchant: merchant._id,
      name: "Admin Order Alert",
      event: "admin-order-alert",
      message: `🔔 *New Order Alert!*\n\nOrder: {{order_number}}\nCustomer: {{customer_name}}\nTotal: {{grand_total}}\nItems: {{items_list}}\nAddress: {{address}}, {{city}}`,
      enabled: false,
      isPoll: false
    },
    {
      merchant: merchant._id,
      name: "Admin Order Confirmed Alert",
      event: "admin-confirmed-alert",
      message: `🔔 *Order Confirmed by Customer!*\n\nOrder {{order_number}} has been confirmed by customer {{customer_name}}! ✅\n\n*Items:*\n{{items_list}}\n\n*Grand Total:* {{grand_total}}\n\n*Shipping Address:*\n{{address}}, {{city}}`,
      enabled: false,
      isPoll: false
    },
    {
      merchant: merchant._id,
      name: "Cancellation Verification",
      event: "orders/cancel_verify",
      message: `Are you sure you want to cancel your order? ❌\n\nThis will stop your order from being processed immediately.`,
      enabled: false,
      isPoll: true,
      pollOptions: ["🗑️ Yes, Cancel Order", "✅ No, Keep Order"]
    }
  ];

  for (const template of defaultTemplates) {
    const { enabled, ...insertData } = template;
    const updateObj = template.event === "orders/create"
      ? { $set: { enabled: true }, $setOnInsert: insertData }
      : { $setOnInsert: template };

    await Template.updateOne(
      { merchant: merchant._id, event: template.event },
      updateObj,
      { upsert: true }
    );
  }

  // 2. Create Default Automation Settings
  const defaultAutomations = [
    { shopDomain: shopDomain, type: "order-confirmation", enabled: true },
    { shopDomain: shopDomain, type: "abandoned_cart", enabled: false },
    { shopDomain: shopDomain, type: "fulfillment_update", enabled: false },
    { shopDomain: shopDomain, type: "fulfillment_delivered", enabled: false },
    { shopDomain: shopDomain, type: "cancellation", enabled: false },
    { shopDomain: shopDomain, type: "cancellation-verify", enabled: false },
    { shopDomain: shopDomain, type: "order-confirmed-reply", enabled: false },
    { shopDomain: shopDomain, type: "admin-order-alert", enabled: false },
    { shopDomain: shopDomain, type: "admin-confirmed-alert", enabled: false }
  ];

  for (const automation of defaultAutomations) {
    const { enabled, ...insertData } = automation;
    const updateObj = automation.type === "order-confirmation"
      ? { $set: { enabled: true }, $setOnInsert: insertData }
      : { $setOnInsert: automation };

    await AutomationSetting.updateOne(
      { shopDomain: shopDomain, type: automation.type },
      updateObj,
      { upsert: true }
    );
  }
}

// Handle app uninstall webhook
router.post("/uninstall", async (req, res) => {
  try {
    const shopDomain = req.get("x-shopify-shop-domain") || req.body?.domain;
    if (shopDomain) {
      console.log(`[OAuth] Uninstall webhook triggered for ${shopDomain}. Disconnecting WhatsApp client and purging all data.`);
      
      const merchantToDelete = await Merchant.findOne({ shopDomain });
      if (merchantToDelete) {
        await Promise.all([
          Merchant.deleteOne({ _id: merchantToDelete._id }),
          ActivityLog.deleteMany({ merchant: merchantToDelete._id }),
          AutomationSetting.deleteMany({ shopDomain }),
          Template.deleteMany({ merchant: merchantToDelete._id }),
          Contact.deleteMany({ merchant: merchantToDelete._id }),
          NotificationSettings.deleteMany({ merchant: merchantToDelete._id }),
          WhatsAppSession.deleteMany({ shopDomain }),
          AutomationStat.deleteMany({ shopDomain }),
          Campaign.deleteMany({ shopDomain }),
          ChatButtonSettings.deleteMany({ shopDomain }),
          PollMessage.deleteMany({ shopDomain })
        ]);
        console.log(`[OAuth] Successfully deleted all data for ${shopDomain} upon uninstall.`);
      }
    }
    res.status(200).send("OK");
  } catch (error) {
    console.error("[OAuth] Uninstall error:", error);
    res.status(200).send("OK"); // Always return 200 for webhooks
  }
});

export default router;
