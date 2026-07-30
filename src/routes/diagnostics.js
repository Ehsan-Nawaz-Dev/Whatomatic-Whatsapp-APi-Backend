import { Router } from "express";
import { Merchant } from "../models/Merchant.js";
import { WhatsAppSession } from "../models/WhatsAppSession.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { AutomationStat } from "../models/AutomationStat.js";
import { whatsappCloudService } from "../services/whatsappCloudService.js";

const router = Router();

// GET /api/diagnostics/meta - Live Meta connection health for one shop.
// Answers: is the token alive, when does it expire, is it the shared env fallback
// token, and is the phone number registered for Cloud API messaging?
router.get("/meta", async (req, res) => {
    try {
        const shop = req.shopifyShop || req.query.shop;
        if (!shop) return res.status(400).json({ error: "Missing shop parameter" });

        const merchant = await Merchant.findOne({ shopDomain: shop });
        if (!merchant) return res.status(404).json({ error: "Merchant not found" });

        const token = merchant.metaAccessToken;

        const config = {
            META_APP_ID: process.env.META_APP_ID ? "CONFIGURED" : "MISSING (using hardcoded default)",
            META_APP_SECRET: process.env.META_APP_SECRET ? "CONFIGURED" : "MISSING",
            META_CONFIG_ID: process.env.META_CONFIG_ID ? "CONFIGURED" : "MISSING (using hardcoded default)",
            WHATSAPP_ACCESS_TOKEN_fallback: process.env.WHATSAPP_ACCESS_TOKEN ? "SET" : "NOT SET",
        };

        if (!token) {
            return res.json({
                shop,
                verdict: "NO_TOKEN",
                detail: "This merchant has no Meta access token stored. They have never completed Embedded Signup.",
                config,
            });
        }

        // The single most useful signal: if the merchant's stored token IS the shared
        // env token, Embedded Signup silently fell back and the connection will die
        // whenever that env token expires.
        const usingEnvFallbackToken = !!process.env.WHATSAPP_ACCESS_TOKEN && token === process.env.WHATSAPP_ACCESS_TOKEN;

        const tokenInfo = await whatsappCloudService.debugToken(token);
        const verify = await whatsappCloudService.verifyCredentials(merchant.metaPhoneNumberId, token);

        let verdict = "HEALTHY";
        const issues = [];

        if (usingEnvFallbackToken) {
            verdict = "USING_SHARED_ENV_TOKEN";
            issues.push("Merchant is using the shared WHATSAPP_ACCESS_TOKEN from env, not their own token. Embedded Signup's code exchange failed. This token expires and will drop the connection for every merchant at once.");
        }
        if (tokenInfo.success && tokenInfo.isValid === false) {
            verdict = "TOKEN_DEAD";
            issues.push(`Meta reports this token is no longer valid: ${tokenInfo.error || "unknown reason"}`);
        }
        if (tokenInfo.success && tokenInfo.expiresAt && tokenInfo.expiresAt !== "never") {
            issues.push(`Token expires at ${tokenInfo.expiresAt}. The connection will drop then unless it is refreshed.`);
            if (verdict === "HEALTHY") verdict = "TOKEN_EXPIRES";
        }
        if (verify.success && verify.data?.platform_type && verify.data.platform_type !== "CLOUD_API") {
            issues.push(`Phone number platform_type is '${verify.data.platform_type}', not 'CLOUD_API'. Sends will fail with (#133010) Account not registered. POST /api/whatsapp/register to fix.`);
            if (verdict === "HEALTHY") verdict = "NOT_REGISTERED";
        }
        if (!verify.success) {
            issues.push(`Live verification failed: ${verify.error}${verify.authError ? " (auth error - token is dead)" : " (transient)"}`);
            if (verify.authError) verdict = "TOKEN_DEAD";
        }

        res.json({
            shop,
            verdict,
            issues,
            usingEnvFallbackToken,
            tokenPreview: `${token.slice(0, 8)}...${token.slice(-4)}`,
            tokenInfo,
            phoneNumber: {
                id: merchant.metaPhoneNumberId,
                display: merchant.metaPhoneDisplay,
                registeredFlag: merchant.metaRegistered,
                registeredAt: merchant.metaRegisteredAt,
                platformType: verify.data?.platform_type,
                codeVerificationStatus: verify.data?.code_verification_status,
                qualityRating: verify.data?.quality_rating,
            },
            wabaId: merchant.metaWabaId,
            config,
        });
    } catch (err) {
        console.error("Meta Diagnostics Error:", err);
        res.status(500).json({ error: "Internal server error", message: err.message });
    }
});

// GET /api/diagnostics
router.get("/", async (req, res) => {
    try {
        const shop = req.shopifyShop || req.query.shop;

        if (!shop) {
            return res.status(400).json({ error: "Missing shop parameter" });
        }

        const merchant = await Merchant.findOne({ shopDomain: shop });
        const whatsappSession = await WhatsAppSession.findOne({ shopDomain: shop });

        const automations = await AutomationSetting.find({ shopDomain: shop }).select('type enabled');
        const recentLogs = merchant ? await ActivityLog.find({ merchant: merchant._id }).sort({ createdAt: -1 }).limit(5).select('type orderId customerPhone message errorMessage createdAt') : [];

        res.json({
            shop,
            merchant: {
                exists: !!merchant,
                hasAccessToken: !!merchant?.shopifyAccessToken,
                pendingConfirmTag: merchant?.pendingConfirmTag,
                orderConfirmTag: merchant?.orderConfirmTag,
                orderCancelTag: merchant?.orderCancelTag,
                whatsappProvider: merchant?.whatsappProvider,
                metaPhoneNumberId: merchant?.metaPhoneNumberId,
                needsReauth: merchant?.needsReauth,
                reauthReason: merchant?.reauthReason
            },
            whatsapp: {
                sessionInDb: {
                    exists: !!whatsappSession,
                    status: whatsappSession?.status,
                    isConnected: whatsappSession?.isConnected,
                    phoneNumber: whatsappSession?.phoneNumber
                }
            },
            automations,
            recentLogs,
            counts: {
                activityLogs: await ActivityLog.countDocuments(merchant ? { merchant: merchant._id } : {}),
                automationStats: await AutomationStat.countDocuments({ shopDomain: shop })
            },
            config: {
                SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
                SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? "CONFIGURED" : "MISSING",
                SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? "CONFIGURED" : "MISSING"
            }
        });
    } catch (err) {
        console.error("Diagnostics Error:", err);
        res.status(500).json({ error: "Internal server error", message: err.message });
    }
});

export default router;
