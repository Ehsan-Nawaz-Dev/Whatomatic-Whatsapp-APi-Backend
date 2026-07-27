import { Router } from "express";
import qrcode from "qrcode";

const router = Router();

// POST /api/qrcode/generate - Generate QR code for a URL
router.post("/generate", async (req, res) => {
    try {
        const { url, format = "png" } = req.body;

        if (!url) {
            return res.status(400).json({
                error: "Missing required parameter: url"
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (e) {
            return res.status(400).json({
                error: "Invalid URL format"
            });
        }

        let qrCode;

        if (format === "svg") {
            // Generate SVG format
            qrCode = await qrcode.toString(url, {
                type: "svg",
                width: 300,
                margin: 2
            });

            res.json({
                success: true,
                url: url,
                qrCode: qrCode,
                format: "svg"
            });
        } else {
            // Generate PNG as Data URL (default)
            qrCode = await qrcode.toDataURL(url, {
                width: 300,
                margin: 2,
                color: {
                    dark: "#000000",
                    light: "#FFFFFF"
                }
            });

            res.json({
                success: true,
                url: url,
                qrCode: qrCode,
                format: "png"
            });
        }
    } catch (err) {
        console.error("Error generating QR code:", err);
        res.status(500).json({
            error: "Failed to generate QR code",
            message: err.message
        });
    }
});

// GET /api/qrcode/generate - Generate QR code via query params
router.get("/generate", async (req, res) => {
    try {
        const { url, format = "png" } = req.query;

        if (!url) {
            return res.status(400).json({
                error: "Missing required parameter: url"
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (e) {
            return res.status(400).json({
                error: "Invalid URL format"
            });
        }

        if (format === "svg") {
            // Generate and return SVG directly
            const qrCode = await qrcode.toString(url, {
                type: "svg",
                width: 300,
                margin: 2
            });

            res.setHeader("Content-Type", "image/svg+xml");
            res.send(qrCode);
        } else {
            // Generate PNG and return as image
            const buffer = await qrcode.toBuffer(url, {
                width: 300,
                margin: 2,
                color: {
                    dark: "#000000",
                    light: "#FFFFFF"
                }
            });

            res.setHeader("Content-Type", "image/png");
            res.send(buffer);
        }
    } catch (err) {
        console.error("Error generating QR code:", err);
        res.status(500).json({
            error: "Failed to generate QR code",
            message: err.message
        });
    }
});

export default router;
