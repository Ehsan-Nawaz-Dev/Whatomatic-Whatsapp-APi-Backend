import { Router } from "express";
import { AutomationStat } from "../models/AutomationStat.js";
import { AutomationSetting } from "../models/AutomationSetting.js";
import { Merchant } from "../models/Merchant.js";
import { Template } from "../models/Template.js";

const router = Router();

const getShopDomain = (req) => {
    if (req.shopifyShop) return req.shopifyShop;
    const shop = req.query.shop || req.headers["x-shop-domain"];
    if (!shop) return null;
    return shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
};

// GET /api/automations/stats
router.get("/stats", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const stats = await AutomationStat.find({ shopDomain });
        const settings = await AutomationSetting.find({ shopDomain });

        const types = [
            { id: "admin-order-alert", name: "Admin Order Alert" },
            { id: "admin-confirmed-alert", name: "Admin Order Confirmed Alert" },
            { id: "order-confirmation", name: "Order Confirmation" },
            { id: "bank-transfer-confirmation", name: "Bank Transfer Confirmation" },
            { id: "order-confirmed-reply", name: "Post-Confirmation Reply" },
            { id: "abandoned_cart", name: "Abandoned Cart" },
            { id: "fulfillment_update", name: "Shipping Update" },
            { id: "fulfillment_delivered", name: "Delivery Update" },
            { id: "cancellation", name: "Order Cancellation" },
            { id: "cancellation-verify", name: "Cancellation Verification" }
        ];

        const formattedStats = types.map(t => {
            const stat = stats.find(s => s.type === t.id);
            const setting = settings.find(s => s.type === t.id);

            return {
                id: t.id,
                name: t.name,
                sent: stat ? stat.sent : 0,
                recovered: stat ? stat.recovered : 0,
                revenue: stat ? stat.revenue : 0,
                enabled: setting ? setting.enabled : false
            };
        });

        res.json(formattedStats);
    } catch (err) {
        console.error("Error fetching automation stats", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// PUT /api/automations/toggle
router.put("/toggle", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        const { id, enabled, type } = req.body;
        const automationType = id || type; // Support both for compatibility

        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });
        if (!automationType) return res.status(400).json({ error: "Missing automation identification (id or type)" });

        const setting = await AutomationSetting.findOneAndUpdate(
            { shopDomain, type: automationType },
            { enabled },
            { upsert: true, new: true }
        );

        const merchant = await Merchant.findOne({ shopDomain });
        if (merchant) {
            const eventMap = {
                "admin-order-alert": "admin-order-alert",
                "admin-confirmed-alert": "admin-confirmed-alert",
                "abandoned_cart": "checkouts/abandoned",
                "order-confirmation": "orders/create",
                "bank-transfer-confirmation": "orders/create/bank_transfer",
                "order-confirmed-reply": "orders/confirmed",
                "fulfillment_update": "fulfillments/update",
                "fulfillment_delivered": "fulfillments/delivered",
                "cancellation": "orders/cancelled",
                "cancellation-verify": "orders/cancel_verify",
            };
            const eventType = eventMap[automationType];
            if (eventType) {
                await Template.findOneAndUpdate(
                    { merchant: merchant._id, event: eventType },
                    { enabled },
                    { new: true }
                );
            }
        }

        res.json(setting);
    } catch (err) {
        console.error("Error toggling automation", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
