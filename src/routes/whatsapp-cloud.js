import { Router } from "express";
import { whatsappCloudService } from "../services/whatsappCloudService.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { Merchant } from "../models/Merchant.js";
import { Template } from "../models/Template.js";

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

// POST /api/whatsapp-cloud/templates - Submit a new template to Meta for approval
router.post("/templates", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ success: false, error: "Missing shop parameter" });

        const { name, category, language, bodyText, headerText, footerText, buttons, examples, components, templateId, variables } = req.body;

        if (!name || (!bodyText && (!components || components.length === 0))) {
            return res.status(400).json({
                success: false,
                error: "Template name and body text are required"
            });
        }

        const result = await whatsappCloudService.createMessageTemplate(shopDomain, {
            name,
            category,
            language: language || "en_US",
            bodyText,
            headerText,
            footerText,
            buttons,
            examples,
            components
        });

        if (result.success) {
            // Link the Meta template back to the local automation template.
            // Without this, metaTemplateName stayed empty forever and every automation
            // fell through to a free-form message, which Meta rejects outside the
            // 24-hour customer service window.
            const merchant = await Merchant.findOne({ shopDomain });
            if (merchant) {
                const query = templateId
                    ? { _id: templateId, merchant: merchant._id }
                    : { merchant: merchant._id, name };

                const linked = await Template.findOneAndUpdate(
                    query,
                    {
                        $set: {
                            metaTemplateName: result.name,
                            metaLanguage: language || "en_US",
                            metaCategory: category || "UTILITY",
                            metaStatus: result.status || "PENDING",
                            metaTemplateId: result.id,
                            metaVariables: Array.isArray(variables) ? variables : [],
                            metaSyncedAt: new Date(),
                        },
                    },
                    { new: true }
                );

                if (!linked) {
                    console.warn(`[Meta Templates] Submitted '${result.name}' but found no local template to link for ${shopDomain}.`);
                }
            }

            res.json({
                success: true,
                message: `Template '${result.name}' submitted to Meta for approval!`,
                templateId: result.id,
                metaTemplateName: result.name,
                status: result.status
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                details: result.details
            });
        }
    } catch (err) {
        console.error("Error creating Meta template:", err);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// POST /api/whatsapp-cloud/templates/sync - Refresh Meta approval status for all
// linked templates. Meta approves asynchronously (minutes to hours), so a template
// submitted as PENDING only becomes sendable after a sync.
router.post("/templates/sync", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ success: false, error: "Missing shop parameter" });

        const merchant = await Merchant.findOne({ shopDomain });
        if (!merchant) return res.status(404).json({ success: false, error: "Merchant not found" });

        const remote = await whatsappCloudService.getMessageTemplates(shopDomain);
        if (!remote.success) {
            return res.status(400).json({ success: false, error: remote.error });
        }

        // Index Meta's templates by name+language.
        const byKey = new Map();
        for (const t of remote.templates || []) {
            byKey.set(`${t.name}::${t.language}`, t);
        }

        const allLocals = await Template.find({ merchant: merchant._id });

        let updated = 0;
        const results = [];

        for (const local of allLocals) {
            // Find match in Meta by metaTemplateName OR by normalized name match
            let match = local.metaTemplateName ?
                (byKey.get(`${local.metaTemplateName}::${local.metaLanguage}`) || (remote.templates || []).find((t) => t.name === local.metaTemplateName)) :
                null;

            if (!match) {
                // Fallback: match by normalized name (e.g. "Order Confirmation" -> "order_confirmation")
                const normalizedLocalName = local.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                match = (remote.templates || []).find(t => t.name === normalizedLocalName || t.name.includes('order_confirm'));
            }

            if (!match) {
                if (local.metaTemplateName && local.metaStatus !== "NONE") {
                    local.metaStatus = "NONE";
                    local.metaSyncedAt = new Date();
                    await local.save();
                    updated++;
                }
                if (local.metaTemplateName) {
                    results.push({ name: local.name, metaTemplateName: local.metaTemplateName, status: "NOT_FOUND_IN_META" });
                }
                continue;
            }

            // Link & update status
            const needsUpdate = local.metaTemplateName !== match.name ||
                local.metaStatus !== match.status ||
                local.metaLanguage !== match.language;

            if (needsUpdate) {
                local.metaTemplateName = match.name;
                local.metaStatus = match.status;
                local.metaLanguage = match.language;
                local.metaTemplateId = match.id;
                local.metaRejectedReason = match.rejected_reason || null;
                local.metaSyncedAt = new Date();
                await local.save();
                updated++;
            }

            results.push({
                name: local.name,
                metaTemplateName: match.name,
                status: match.status,
                rejectedReason: match.rejected_reason || null,
            });
        }

        res.json({
            success: true,
            updated,
            approved: results.filter((r) => r.status === "APPROVED").length,
            templates: results,
        });
    } catch (err) {
        console.error("Error syncing Meta template status:", err);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// DELETE /api/whatsapp-cloud/templates/:name - Delete a template from Meta
router.delete("/templates/:name", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ success: false, error: "Missing shop parameter" });

        const templateName = req.params.name;
        const result = await whatsappCloudService.deleteMessageTemplate(shopDomain, templateName);

        if (result.success) {
            res.json({
                success: true,
                message: `Template '${templateName}' deleted from Meta WABA`
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
    } catch (err) {
        console.error("Error deleting Meta template:", err);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});


// GET /api/whatsapp-cloud/webhooks - Webhook verification for Meta Console
router.get("/webhooks", (req, res) => {
    try {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        // App-level token, configuration only. A hardcoded default is public knowledge
        // and would let anyone pass Meta's webhook verification challenge.
        const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

        if (!VERIFY_TOKEN) {
            console.error("[Meta Webhook] WHATSAPP_VERIFY_TOKEN is not configured - refusing verification.");
            return res.status(500).json({ error: "Webhook verify token not configured" });
        }

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

            // Route strictly by the phone number id Meta reported. The previous
            // "fall back to any active merchant" behaviour attributed one store's
            // customer replies to an unrelated store - confirming/cancelling the
            // wrong orders and tagging the wrong Shopify shop.
            const merchant = await Merchant.findOne({ metaPhoneNumberId: phoneNumberId });
            if (!merchant) {
                console.warn(`[Meta Webhook] No merchant owns phone_number_id ${phoneNumberId}. Ignoring inbound message.`);
                return res.status(200).json({ success: true, skipped: true, reason: "unknown_phone_number_id" });
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
