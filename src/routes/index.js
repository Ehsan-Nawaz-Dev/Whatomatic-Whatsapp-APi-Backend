import { Router } from "express";
import settingsRouter from "./settings.js";
import templatesRouter from "./templates.js";
import shopifyWebhooksRouter from "./webhooks/shopify.js";
import whatsappWebhooksRouter from "./webhooks-whatsapp.js";
import activityRouter from "./activity.js";
import contactRouter from "./contact.js";
import notificationsRouter from "./notifications.js";
import analyticsRouter from "./analytics.js";
import shopifyAuthRouter from "./auth-shopify.js";
import whatsappRouter from "./whatsapp.js";
import whatsappCloudRouter from "./whatsapp-cloud.js";
import qrcodeRouter from "./qrcode.js";
import automationsRouter from "./automations.js";
import campaignsRouter from "./campaigns.js";
import diagnosticsRouter from "./diagnostics.js";
import billingRouter from "./billing.js";
import trialRouter from "./trial.js";
import adminRouter from "./admin.js";
import ticketsRouter from "./tickets.js";
// import storefrontRouter from "./storefront.js";
import { verifySessionToken } from "../middleware/auth.js";

const router = Router();

// GET /api - List all available API endpoints
router.get("/", (req, res) => {
    res.json({
        message: "WhatFlow Backend API - Available Endpoints",
        version: "1.0.0",
        baseUrl: "/api",
        endpoints: {
            settings: {
                basePath: "/api/settings",
                description: "Manage application settings and configurations",
                methods: ["GET", "POST", "PUT", "DELETE"]
            },
            templates: {
                basePath: "/api/templates",
                description: "Manage WhatsApp message templates",
                methods: ["GET", "POST", "PUT", "DELETE"]
            },
            whatsapp: {
                basePath: "/api/whatsapp",
                description: "WhatsApp Web integration endpoints",
                endpoints: [
                    { method: "GET", path: "/status", description: "Get WhatsApp connection status" },
                    { method: "POST", path: "/connect", description: "Initialize WhatsApp connection" },
                    { method: "POST", path: "/disconnect", description: "Disconnect WhatsApp" },
                    { method: "POST", path: "/send", description: "Send a WhatsApp message" },
                    { method: "GET", path: "/qr", description: "Get QR code for WhatsApp Web" }
                ]
            },
            whatsappCloud: {
                basePath: "/api/whatsapp-cloud",
                description: "WhatsApp Cloud API integration endpoints",
                endpoints: [
                    { method: "POST", path: "/send", description: "Send message via WhatsApp Cloud API" },
                    { method: "POST", path: "/send-template", description: "Send template message" },
                    { method: "GET", path: "/templates", description: "Get available message templates" },
                    { method: "POST", path: "/webhook", description: "WhatsApp Cloud API webhook" },
                    { method: "GET", path: "/webhook", description: "Verify WhatsApp webhook" }
                ]
            },
            webhooks: {
                shopify: {
                    basePath: "/api/webhooks/shopify",
                    description: "Shopify webhook handlers",
                    methods: ["POST"]
                },
                whatsapp: {
                    basePath: "/api/webhooks/whatsapp",
                    description: "WhatsApp webhook handlers",
                    methods: ["GET", "POST"]
                }
            },
            activity: {
                basePath: "/api/activity",
                description: "Track and retrieve activity logs",
                methods: ["GET", "POST"]
            },
            contact: {
                basePath: "/api/contact",
                description: "Manage contacts and customer information",
                methods: ["GET", "POST", "PUT", "DELETE"]
            },
            notifications: {
                basePath: "/api/notifications",
                description: "Manage and send notifications",
                methods: ["GET", "POST", "PUT", "DELETE"]
            },
            analytics: {
                basePath: "/api/analytics",
                description: "Analytics and reporting endpoints",
                methods: ["GET"]
            },
            auth: {
                shopify: {
                    basePath: "/api/auth/shopify",
                    description: "Shopify authentication and OAuth",
                    methods: ["GET"]
                }
            },
            qrcode: {
                basePath: "/api/qrcode",
                description: "QR code generation for URLs",
                endpoints: [
                    { method: "POST", path: "/generate", description: "Generate QR code (returns JSON with data URL)" },
                    { method: "GET", path: "/generate?url=YOUR_URL", description: "Generate QR code (returns image directly)" }
                ]
            },
            automations: {
                basePath: "/api/automations",
                description: "Manage automated message flows and stats",
                methods: ["GET", "PUT"]
            },
            campaigns: {
                basePath: "/api/campaigns",
                description: "Bulk marketing campaign management",
                methods: ["POST", "GET"]
            },
            billing: {
                basePath: "/api/billing",
                description: "Subscription and billing management with Shopify",
                methods: ["GET", "POST"]
            },
            trial: {
                basePath: "/api/trial",
                description: "Internal 10-message trial system",
                methods: ["GET", "POST"]
            }

        },
        documentation: {
            whatsappCloudAPI: "See WHATSAPP_CLOUD_API.md for WhatsApp Cloud API documentation",
            whatsappWebAPI: "See WHATSAPP_API.md for WhatsApp Web API documentation"
        }
    });
});

router.use("/settings", verifySessionToken, settingsRouter);
router.use("/templates", verifySessionToken, templatesRouter);
router.use("/webhooks/shopify", shopifyWebhooksRouter);
router.use("/webhooks/whatsapp", whatsappWebhooksRouter);
router.use("/activity", verifySessionToken, activityRouter);
router.use("/contact", verifySessionToken, contactRouter);
router.use("/notifications", verifySessionToken, notificationsRouter);
router.use("/analytics", verifySessionToken, analyticsRouter);
router.use("/auth/shopify", shopifyAuthRouter);
router.use("/whatsapp", verifySessionToken, whatsappRouter);
router.use("/whatsapp-cloud", verifySessionToken, whatsappCloudRouter);
router.use("/qrcode", verifySessionToken, qrcodeRouter);
router.use("/automations", verifySessionToken, automationsRouter);
router.use("/campaigns", verifySessionToken, campaignsRouter);
router.use("/diagnostics", verifySessionToken, diagnosticsRouter);
import planRouter from "./plans.js";

// ... previous imports

router.use("/billing", verifySessionToken, billingRouter);
router.use("/plans", planRouter); // Register here
router.use("/trial", verifySessionToken, trialRouter);
router.use("/tickets", ticketsRouter);
router.use("/admin", adminRouter);
// router.use("/storefront", storefrontRouter);

export default router;
