import { Router } from "express";
import { Ticket } from "../models/Ticket.js";

const router = Router();

// POST /api/tickets - Create a new support ticket
router.post("/", async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const shopDomain = req.shopifyShop || req.query.shop;

        if (!name || !email || !message) {
            return res.status(400).json({ error: "Name, email, and message are required" });
        }

        const ticket = await Ticket.create({
            name,
            email,
            message,
            shopDomain,
            status: 'open'
        });

        res.json({ success: true, ticket });
    } catch (err) {
        console.error("Error creating ticket:", err);
        res.status(500).json({ error: "Failed to submit support ticket" });
    }
});

export default router;
