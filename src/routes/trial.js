import { Router } from "express";
import { Merchant } from "../models/Merchant.js";

const router = Router();

// POST /api/trial/activate
// Activates the 10-message trial using user details
router.post("/activate", async (req, res) => {
    const shop = req.shopifyShop || req.query.shop;
    const { name, email, phone } = req.body;

    if (!shop) {
        return res.status(400).json({ error: "Shop domain is required" });
    }

    try {
        const merchant = await Merchant.findOne({ shopDomain: shop });

        if (!merchant) {
            return res.status(404).json({ error: "Merchant not found" });
        }

        if (merchant.trialActivated) {
            return res.status(400).json({ error: "Trial has already been activated for this store" });
        }

        // Update merchant details and activate trial
        merchant.storeName = name || merchant.storeName;
        merchant.email = email || merchant.email;
        merchant.phone = phone || merchant.phone;

        merchant.trialActivated = true;
        merchant.trialStartedAt = new Date();
        merchant.trialUsage = 0;
        merchant.trialLimit = 10;
        merchant.plan = 'trial';
        merchant.billingStatus = 'active'; // Mark as active for frontend gates

        await merchant.save();

        console.log(`[Trial] Activated for ${shop}. Details: ${name}, ${email}, ${phone}`);

        res.json({
            success: true,
            message: "Trial activated successfully! You can now send up to 10 order messages.",
            merchant: {
                shop: merchant.shopDomain,
                trialActivated: merchant.trialActivated,
                trialUsage: merchant.trialUsage,
                trialLimit: merchant.trialLimit
            }
        });
    } catch (err) {
        console.error("[Trial] Activation error:", err);
        res.status(500).json({ error: "Internal server error during trial activation" });
    }
});

// GET /api/trial/status
// Checks the current trial status
router.get("/status", async (req, res) => {
    const shop = req.shopifyShop || req.query.shop;

    if (!shop) {
        return res.status(400).json({ error: "Shop domain is required" });
    }

    try {
        const merchant = await Merchant.findOne({ shopDomain: shop });

        if (!merchant) {
            return res.status(404).json({ error: "Merchant not found" });
        }

        res.json({
            trialActivated: merchant.trialActivated,
            trialUsage: merchant.trialUsage,
            trialLimit: merchant.trialLimit,
            plan: merchant.plan,
            status: merchant.billingStatus
        });
    } catch (err) {
        res.status(500).json({ error: "Error fetching trial status" });
    }
});

export default router;
