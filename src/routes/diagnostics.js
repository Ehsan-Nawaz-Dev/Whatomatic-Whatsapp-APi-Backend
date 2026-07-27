import { Router } from "express";
import { Merchant } from "../models/Merchant.js";
import { WhatsAppSession } from "../models/WhatsAppSession.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { AutomationStat } from "../models/AutomationStat.js";

const router = Router();

// GET /api/diagnostics
router.get("/", async (req, res) => {
    try {
        const shop = req.shopifyShop || req.query.shop;

        if (!shop) {
            return res.status(400).json({ error: "Missing shop parameter" });
        }

        const merchant = await Merchant.findOne({ shopDomain: shop });
        const whatsappSession = await WhatsAppSession.findOne({ shopDomain: shop });

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
