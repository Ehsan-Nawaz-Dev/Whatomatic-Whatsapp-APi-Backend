import { Router } from "express";
import { whatsappCloudService } from "../services/whatsappCloudService.js";
import { Merchant } from "../models/Merchant.js";
import { WhatsAppSession } from "../models/WhatsAppSession.js";
import { Plan } from "../models/Plan.js";
import { checkAndResetBillingCycle } from "../services/billingService.js";

const router = Router();

// Helper to get shop domain
const getShopDomain = (req) => {
    if (req.shopifyShop) return req.shopifyShop;
    const shop = req.query.shop || req.headers["x-shop-domain"];
    if (!shop) return null;
    return shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
};

// GET /api/whatsapp/config - Get dynamic Meta App ID configuration
router.get("/config", (req, res) => {
    res.json({
        metaAppId: process.env.META_APP_ID || process.env.VITE_META_APP_ID || "",
        metaConfigId: process.env.META_CONFIG_ID || process.env.VITE_META_CONFIG_ID || ""
    });
});

// GET /api/whatsapp/status - Get connection status
router.get("/status", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const merchant = await Merchant.findOne({ shopDomain });
        const session = await WhatsAppSession.findOne({ shopDomain });

        if (!merchant || !merchant.metaPhoneNumberId || !merchant.metaAccessToken) {
            return res.json({
                connected: false,
                phoneNumber: "",
                deviceName: "Meta Cloud API",
                status: "disconnected",
                dailyUsage: merchant?.dailyUsage || 0,
                dailyLimit: merchant?.dailyLimit || 1000
            });
        }

        // Verify credentials with Meta live
        const verifyRes = await whatsappCloudService.verifyCredentials(
            merchant.metaPhoneNumberId,
            merchant.metaAccessToken
        );

        if (verifyRes.success) {
            const displayPhone = verifyRes.data.display_phone_number || merchant.metaPhoneDisplay || merchant.whatsappNumber;
            const qualityRating = verifyRes.data.quality_rating;

            // Update session record
            await WhatsAppSession.findOneAndUpdate(
                { shopDomain },
                {
                    shopDomain,
                    metaPhoneNumberId: merchant.metaPhoneNumberId,
                    metaWabaId: merchant.metaWabaId,
                    phoneNumber: displayPhone,
                    displayPhoneNumber: displayPhone,
                    qualityRating: qualityRating,
                    isConnected: true,
                    status: "connected",
                    lastVerifiedAt: new Date(),
                    errorMessage: null
                },
                { upsert: true, new: true }
            );

            return res.json({
                connected: true,
                phoneNumber: displayPhone,
                deviceName: "Meta Cloud API",
                status: "connected",
                qualityRating: qualityRating,
                dailyUsage: merchant.dailyUsage || 0,
                dailyLimit: merchant.dailyLimit || 1000
            });
        } else {
            return res.json({
                connected: false,
                phoneNumber: merchant.metaPhoneDisplay || "",
                deviceName: "Meta Cloud API",
                status: "error",
                errorMessage: verifyRes.error,
                dailyUsage: merchant.dailyUsage || 0,
                dailyLimit: merchant.dailyLimit || 1000
            });
        }
    } catch (err) {
        console.error("Error fetching Meta WhatsApp status", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /api/whatsapp/credentials - Save Meta credentials for merchant
router.post("/credentials", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const { metaPhoneNumberId, metaWabaId, metaAccessToken, metaWebhookVerifyToken } = req.body;

        if (!metaPhoneNumberId || !metaAccessToken) {
            return res.status(400).json({ error: "metaPhoneNumberId and metaAccessToken are required" });
        }

        // Verify credentials with Meta API before saving
        const verifyRes = await whatsappCloudService.verifyCredentials(metaPhoneNumberId, metaAccessToken);
        if (!verifyRes.success) {
            return res.status(400).json({
                success: false,
                error: `Meta Verification Failed: ${verifyRes.error}`
            });
        }

        const displayPhone = verifyRes.data.display_phone_number;

        // Save to Merchant DB
        const updatedMerchant = await Merchant.findOneAndUpdate(
            { shopDomain },
            {
                $set: {
                    metaPhoneNumberId,
                    metaWabaId,
                    metaAccessToken,
                    metaWebhookVerifyToken: metaWebhookVerifyToken || process.env.WHATSAPP_VERIFY_TOKEN || "whatflow_secure_token",
                    metaPhoneDisplay: displayPhone,
                    whatsappNumber: displayPhone,
                    whatsappProvider: "cloud"
                }
            },
            { new: true, upsert: true }
        );

        // Update WhatsAppSession
        await WhatsAppSession.findOneAndUpdate(
            { shopDomain },
            {
                shopDomain,
                metaPhoneNumberId,
                metaWabaId,
                phoneNumber: displayPhone,
                displayPhoneNumber: displayPhone,
                qualityRating: verifyRes.data.quality_rating,
                isConnected: true,
                status: "connected",
                lastVerifiedAt: new Date()
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: "Meta WhatsApp Cloud API credentials saved & verified successfully!",
            displayPhoneNumber: displayPhone,
            merchant: updatedMerchant
        });
    } catch (err) {
        console.error("Error saving Meta credentials", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});

// POST /api/whatsapp/embedded-signup - 1-Click Meta Embedded Signup callback
router.post("/embedded-signup", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const { code, wabaId, phoneNumberId, accessToken: directAccessToken } = req.body;

        let activeAccessToken = directAccessToken;

        if (code && !activeAccessToken) {
            const tokenRes = await whatsappCloudService.exchangeEmbeddedCode(code);
            if (tokenRes.success) {
                activeAccessToken = tokenRes.accessToken;
            } else {
                console.warn("[Embedded Signup] Token exchange fallback:", tokenRes.error);
                activeAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
            }
        }

        if (!activeAccessToken) {
            return res.status(400).json({ error: "Failed to resolve Meta access token from signup flow" });
        }

        const resolvedPhoneId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
        const verifyRes = await whatsappCloudService.verifyCredentials(resolvedPhoneId, activeAccessToken);

        const displayPhone = verifyRes.data?.display_phone_number || "Connected Meta Phone";

        const resolvedWabaId = wabaId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        if (resolvedWabaId) {
            await whatsappCloudService.subscribeWabaWebhooks(resolvedWabaId, activeAccessToken);
        }

        const updatedMerchant = await Merchant.findOneAndUpdate(
            { shopDomain },
            {
                $set: {
                    metaPhoneNumberId: resolvedPhoneId,
                    metaWabaId: resolvedWabaId,
                    metaAccessToken: activeAccessToken,
                    metaWebhookVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "whatflow_secure_token",
                    metaPhoneDisplay: displayPhone,
                    whatsappNumber: displayPhone,
                    whatsappProvider: "cloud"
                }
            },
            { new: true, upsert: true }
        );

        await WhatsAppSession.findOneAndUpdate(
            { shopDomain },
            {
                shopDomain,
                metaPhoneNumberId: resolvedPhoneId,
                metaWabaId: resolvedWabaId,
                phoneNumber: displayPhone,
                displayPhoneNumber: displayPhone,
                qualityRating: verifyRes.data?.quality_rating || "GREEN",
                isConnected: true,
                status: "connected",
                lastVerifiedAt: new Date()
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: "1-Click Meta WhatsApp Business Account connected successfully!",
            displayPhoneNumber: displayPhone,
            merchant: updatedMerchant
        });
    } catch (err) {
        console.error("Error in Embedded Signup callback", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});

// POST /api/whatsapp/disconnect - Disconnect / Remove Meta credentials
router.post("/disconnect", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        await Merchant.findOneAndUpdate(
            { shopDomain },
            {
                $unset: {
                    metaPhoneNumberId: "",
                    metaWabaId: "",
                    metaAccessToken: "",
                    metaWebhookVerifyToken: "",
                    metaPhoneDisplay: ""
                }
            }
        );

        await WhatsAppSession.findOneAndUpdate(
            { shopDomain },
            {
                isConnected: false,
                status: "disconnected",
                errorMessage: "Disconnected by user"
            }
        );

        res.json({
            success: true,
            message: "Meta WhatsApp API credentials removed successfully"
        });
    } catch (err) {
        console.error("Error disconnecting WhatsApp", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /api/whatsapp/send - Send a message via Meta Cloud API
router.post("/send", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const { phoneNumber, message, isPoll, pollOptions, templateName, languageCode, components } = req.body;

        if (!phoneNumber || (!message && !templateName)) {
            return res.status(400).json({ error: "Missing phoneNumber and message/templateName" });
        }

        let merchant = await Merchant.findOne({ shopDomain });
        if (merchant) {
            merchant = await checkAndResetBillingCycle(merchant);
            if (merchant.plan === 'trial') {
                if (merchant.trialUsage >= (merchant.trialLimit || 10)) {
                    return res.status(403).json({
                        success: false,
                        error: "Trial limit reached (10 messages max). Please upgrade to a paid plan."
                    });
                }
            } else {
                const planConfig = await Plan.findOne({ id: merchant.plan || 'free' });
                const baseLimit = planConfig ? planConfig.messageLimit : 10;
                const currentLimit = baseLimit + Math.max(0, (merchant.trialLimit || 10) - 10);
                const currentUsage = merchant.usage || 0;
                if (currentUsage >= currentLimit) {
                    if (merchant.shopifyUsageLineItemId && merchant.plan !== 'professional') {
                        console.log(`[WhatsApp] Auto-upgrade allowance for ${shopDomain}. Limit was ${currentLimit}.`);
                    } else {
                        return res.status(403).json({
                            success: false,
                            error: `Plan limit reached (${currentLimit} messages max). Please upgrade to a paid plan.`
                        });
                    }
                }
            }
        }

        let result;
        if (templateName) {
            result = await whatsappCloudService.sendTemplateMessage(shopDomain, phoneNumber, templateName, languageCode || "en", components || []);
        } else if (isPoll && pollOptions?.length > 0) {
            const buttons = pollOptions.map((opt, idx) => ({ id: `opt_${idx}`, title: opt }));
            result = await whatsappCloudService.sendInteractiveButtonsMessage(shopDomain, phoneNumber, message, buttons);
        } else {
            result = await whatsappCloudService.sendTextMessage(shopDomain, phoneNumber, message);
        }

        if (result.success) {
            if (merchant) {
                if (merchant.plan === 'trial') {
                    await Merchant.findOneAndUpdate({ shopDomain }, { $inc: { trialUsage: 1 } });
                } else {
                    const updatedMerchant = await Merchant.findOneAndUpdate({ shopDomain }, { $inc: { usage: 1 } }, { new: true });
                    import('../services/billingService.js').then(({ checkAndChargeUsage }) => {
                        checkAndChargeUsage(updatedMerchant);
                    }).catch(err => console.error("Billing service error:", err));
                }
            }

            res.json({
                success: true,
                messageId: result.messageId,
                message: "Message sent successfully via Meta Cloud API"
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                details: result.details
            });
        }
    } catch (err) {
        console.error("Error sending WhatsApp message", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
