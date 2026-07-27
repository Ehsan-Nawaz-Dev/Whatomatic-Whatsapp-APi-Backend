import { Router } from "express";
import { Campaign } from "../models/Campaign.js";
import { campaignService } from "../services/campaignService.js";

const router = Router();

const getShopDomain = (req) => {
    if (req.shopifyShop) return req.shopifyShop;
    const shop = req.query.shop || req.headers["x-shop-domain"];
    if (!shop) return null;
    return shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
};

// POST /api/campaigns/send
router.post("/send", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        const { contacts, message, type } = req.body;

        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });
        if (!contacts || !Array.isArray(contacts)) return res.status(400).json({ error: "Missing or invalid contacts" });
        if (!message) return res.status(400).json({ error: "Missing message" });

        const campaign = new Campaign({
            shopDomain,
            contacts,
            message,
            type: type || "text",
            totalCount: contacts.length,
            status: "pending"
        });

        await campaign.save();

        // Start sending in background
        campaignService.sendCampaign(campaign._id).catch(err => {
            console.error(`Campaign ${campaign._id} failed in background:`, err);
        });

        res.json({
            success: true,
            message: "Campaign initiated",
            campaignId: campaign._id
        });
    } catch (err) {
        console.error("Error initiating campaign", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET /api/campaigns/status/:id
router.get("/status/:id", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const campaign = await Campaign.findOne({ _id: req.params.id, shopDomain });
        if (!campaign) return res.status(404).json({ error: "Campaign not found or unauthorized" });

        res.json({
            id: campaign._id,
            status: campaign.status,
            sentCount: campaign.sentCount,
            totalCount: campaign.totalCount,
            createdAt: campaign.createdAt
        });
    } catch (err) {
        console.error("Error fetching campaign status", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
