import { Router } from "express";

const router = Router();

router.all("*", (req, res) => {
    res.status(400).json({ error: "QR code generation endpoint disabled. Meta WhatsApp Business Cloud API is active." });
});

export default router;
