import { Router } from "express";
import { whatsappCloudService } from "../services/whatsappCloudService.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { Merchant } from "../models/Merchant.js";

const router = Router();

// Helper to get shop domain
const getShopDomain = (req) => {
    if (req.shopifyShop) return req.shopifyShop;
    const shop = req.query.shop || req.headers["x-shop-domain"];
    if (!shop) return null;
    return shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
};

// POST /api/whatsapp-cloud/send - Send text message
router.post("/send", async (req, res) => {
    try {
        const { to, message } = req.body;

        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: "Missing required fields: 'to' and 'message'",
            });
        }

        const shopDomain = getShopDomain(req);
        const result = await whatsappCloudService.sendTextMessage(shopDomain, to, message);

        if (result.success) {
            res.json({
                success: true,
                messageId: result.messageId,
                message: "Message sent successfully via Meta Cloud API",
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
            });
        }
    } catch (err) {
        console.error("Error in send message route:", err);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// POST /api/whatsapp-cloud/send-template - Send template message
router.post("/send-template", async (req, res) => {
    try {
        const { to, templateName, languageCode, components } = req.body;

        if (!to || !templateName) {
            return res.status(400).json({
                success: false,
                error: "Missing required fields: 'to' and 'templateName'",
            });
        }

        const shopDomain = getShopDomain(req);
        const result = await whatsappCloudService.sendTemplateMessage(shopDomain, to, templateName, languageCode || "en", components || []);

        if (result.success) {
            res.json({
                success: true,
                messageId: result.messageId,
                message: "Template message sent via Meta Cloud API",
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                details: result.details
            });
        }
    } catch (err) {
        console.error("Error in send template route:", err);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// POST /api/whatsapp-cloud/send-image - Send image message
router.post("/send-image", async (req, res) => {
    try {
        const { to, imageUrl, caption } = req.body;

        if (!to || !imageUrl) {
            return res.status(400).json({
                success: false,
                error: "Missing required fields: 'to' and 'imageUrl'",
            });
        }

        const shopDomain = getShopDomain(req);
        const result = await whatsappCloudService.sendImageMessage(shopDomain, to, imageUrl, caption || "");

        if (result.success) {
            res.json({
                success: true,
                messageId: result.messageId,
                message: "Image message sent via Meta Cloud API",
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
            });
        }
    } catch (err) {
        console.error("Error in send image route:", err);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// GET /api/whatsapp-cloud/templates - Get message templates
router.get("/templates", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        const result = await whatsappCloudService.getMessageTemplates(shopDomain);

        if (result.success) {
            res.json({
                success: true,
                templates: result.templates,
                paging: result.paging,
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
            });
        }
    } catch (err) {
        console.error("Error fetching templates:", err);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// GET /api/whatsapp-cloud/webhooks - Webhook verification for Meta Console
router.get("/webhooks", (req, res) => {
    try {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "whatflow_secure_token";

        if (mode === "subscribe" && token === VERIFY_TOKEN) {
            console.log("[Meta Webhook] Verified successfully!");
            return res.status(200).send(challenge);
        }

        console.error("[Meta Webhook] Verification failed");
        return res.status(403).json({ error: "Webhook verification failed" });
    } catch (err) {
        console.error("Error in webhook verification:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /api/whatsapp-cloud/webhooks - Central Meta webhook handler
router.post("/webhooks", async (req, res) => {
    try {
        const webhookBody = req.body;
        const result = whatsappCloudService.processIncomingWebhook(webhookBody);

        if (result.success && result.isMessage) {
            const { messageId, from, text, phoneNumberId, contactName, buttonReply } = result.data;

            // Find merchant by metaPhoneNumberId
            let merchant = await Merchant.findOne({ metaPhoneNumberId: phoneNumberId });
            if (!merchant) {
                // Fallback to single merchant if available
                merchant = await Merchant.findOne({ isActive: true });
            }

            if (merchant) {
                const shopDomain = merchant.shopDomain;
                const lowerText = (text || "").trim().toLowerCase();

                // Check for order confirmation or cancellation keywords / button IDs
                const isConfirm = lowerText.includes("confirm") || lowerText === "1" || lowerText === "yes" || buttonReply?.id === "CONFIRM_ORDER";
                const isCancel = lowerText.includes("cancel") || lowerText === "2" || lowerText === "no" || buttonReply?.id === "CANCEL_ORDER";

                if (isConfirm || isCancel) {
                    const shopifyService = (await import("../services/shopifyService.js")).shopifyService;

                    // Log activity
                    await ActivityLog.create({
                        merchant: merchant._id,
                        type: isConfirm ? "confirmed" : "cancelled",
                        customerName: contactName || from,
                        message: isConfirm ? "Order Confirmed via WhatsApp ✅" : "Order Cancelled via WhatsApp ❌",
                        channel: "whatsapp-cloud",
                        rawPayload: webhookBody
                    });

                    // Send reply to customer
                    const replyMessage = isConfirm
                        ? merchant.orderConfirmReply || "Thank you! Your order has been confirmed. ✅"
                        : merchant.orderCancelReply || "Your order has been cancelled. ❌";

                    await whatsappCloudService.sendTextMessage(shopDomain, from, replyMessage);
                }
            }

            res.status(200).json({ success: true });
        } else {
            res.status(200).json({ success: true, skipped: true });
        }
    } catch (err) {
        console.error("Error processing webhook:", err);
        res.status(200).json({ error: "Processing error" });
    }
});

export default router;
