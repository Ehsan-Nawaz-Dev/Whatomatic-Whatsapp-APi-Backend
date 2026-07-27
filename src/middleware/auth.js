import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;

/**
 * Middleware to verify Shopify Session Token (JWT)
 * Required for all embedded app requests to the backend.
 */
export const verifySessionToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        // FALLBACK: For now, if no auth header, we log it and check if we are in development
        // In production, this MUST fail.
        if (process.env.NODE_ENV === "production") {
            console.error("[Auth] Missing Authorization header in production");
            return res.status(401).json({ error: "Missing session token" });
        }

        // During migration/dev, we might still rely on query param
        console.warn("[Auth] No Bearer token found. Falling back to query param (insecure)");
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
