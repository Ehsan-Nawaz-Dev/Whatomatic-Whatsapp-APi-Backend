import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "f89bab1b3e9044eae648188ba2712eec";

/**
 * Middleware to verify Shopify Session Token (JWT)
 * Required for all embedded app requests to the backend.
 */
export const verifySessionToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        // Allow public config endpoint or requests with shop query param / header
        if (req.path === "/config" || req.path.endsWith("/config") || req.query.shop || req.headers["x-shop-domain"]) {
            if (req.query.shop) {
                req.shopifyShop = req.query.shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
            }
            return next();
        }

        if (process.env.NODE_ENV === "production") {
            console.error("[Auth] Missing Authorization header in production for path:", req.path);
            return res.status(401).json({ error: "Missing session token" });
        }

        return next();
    }

    const token = authHeader.split(" ")[1];

    try {
        // Verify JWT signature using Shopify API Secret
        const payload = jwt.verify(token, SHOPIFY_API_SECRET, {
            algorithms: ["HS256"],
        });

        // Check audience (client ID)
        if (payload.aud !== SHOPIFY_API_KEY) {
            console.error("[Auth] Token audience mismatch");
            return res.status(401).json({ error: "Invalid token audience" });
        }

        // Extract shop domain from 'dest' or 'iss'
        // dest: "https://shop.myshopify.com"
        const shop = payload.dest.replace(/^https?:\/\//, "");

        // Attach shop and session data to request
        req.shopifyShop = shop;
        req.shopifySession = payload;

        console.log(`[Auth] Verified session token for: ${shop}`);
        next();
    } catch (err) {
        console.error("[Auth] Token verification failed:", err.message);
        return res.status(401).json({ error: "Invalid session token" });
    }
};
