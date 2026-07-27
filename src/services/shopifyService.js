import axios from "axios";
import { Merchant } from "../models/Merchant.js";

class ShopifyService {
    /**
     * Checks if the merchant's token is expiring and refreshes it if necessary.
     * Returns a valid access token.
     * @param {Object} merchant - The database Merchant object
     * @returns {Promise<string>} The active access token
     */
    async getValidAccessToken(merchant) {
        if (!merchant) return null;

        // If the merchant does not have expiring token fields, return current token
        if (!merchant.shopifyRefreshToken || !merchant.shopifyTokenExpiresAt) {
            return merchant.shopifyAccessToken;
        }

        const bufferTime = 10 * 60 * 1000; // 10 minutes buffer
        const expiresAt = new Date(merchant.shopifyTokenExpiresAt).getTime();
        const isExpiring = Date.now() + bufferTime >= expiresAt;

        if (!isExpiring) {
            return merchant.shopifyAccessToken;
        }

        console.log(`[ShopifyService] Access token for ${merchant.shopDomain} is expiring soon. Refreshing...`);

        try {
            const response = await axios.post(`https://${merchant.shopDomain}/admin/oauth/access_token`, {
                client_id: process.env.SHOPIFY_API_KEY,
                client_secret: process.env.SHOPIFY_API_SECRET,
                grant_type: "refresh_token",
                refresh_token: merchant.shopifyRefreshToken
            });

            const { access_token, expires_in, refresh_token } = response.data;

            merchant.shopifyAccessToken = access_token;
            merchant.shopifyTokenExpiresAt = new Date(Date.now() + expires_in * 1000);
            if (refresh_token) {
                merchant.shopifyRefreshToken = refresh_token;
            }

            await merchant.save();
            console.log(`[ShopifyService] Access token refreshed successfully for ${merchant.shopDomain}`);
            return access_token;
        } catch (err) {
            console.error(`[ShopifyService] Failed to refresh access token for ${merchant.shopDomain}:`, err.response?.data || err.message);
            // Fallback to current access token in case of network issue
            return merchant.shopifyAccessToken;
        }
    }

    /**
     * Resolves the latest valid token for a merchant.
     */
    async resolveActiveToken(shopDomain, accessToken) {
        if (!shopDomain) return accessToken;
        try {
            const merchant = await Merchant.findOne({ shopDomain: { $regex: new RegExp(`^${shopDomain}$`, "i") } });
            if (merchant) {
                return await this.getValidAccessToken(merchant);
            }
        } catch (err) {
            console.error(`[ShopifyService] Error resolving active token for ${shopDomain}:`, err.message);
        }
        return accessToken;
    }

    /**
     * Appends a tag to a Shopify order.
     */
    async addOrderTag(shopDomain, accessToken, orderId, newTag, extraTagsToRemove = []) {
        const activeToken = await this.resolveActiveToken(shopDomain, accessToken);

        console.log(`[ShopifyService] addOrderTag called with:`, {
            shopDomain,
            hasAccessToken: !!activeToken,
            accessTokenLength: activeToken?.length,
            orderId,
            orderIdType: typeof orderId,
            newTag
        });

        if (!activeToken) {
            console.error(`[ShopifyService] ERROR: No access token for ${shopDomain}, skipping tagging.`);
            return { success: false, error: "Missing access token" };
        }

        if (!orderId) {
            console.error(`[ShopifyService] ERROR: No orderId provided for tagging on ${shopDomain}.`);
            return { success: false, error: "Missing orderId" };
        }

        // Ensure orderId is a string number (not a GID)
        let numericOrderId = orderId;
        if (typeof orderId === 'string' && orderId.includes('/')) {
            numericOrderId = orderId.split('/').pop();
        }
        numericOrderId = String(numericOrderId);

        try {
            console.log(`[ShopifyService] Adding tag "${newTag}" to order ${numericOrderId} on ${shopDomain}`);

            const url = `https://${shopDomain}/admin/api/2024-01/orders/${numericOrderId}.json`;
            const getResponse = await axios.get(url, {
                headers: { "X-Shopify-Access-Token": activeToken }
            });

            if (!getResponse.data.order) {
                throw new Error(`Order ${numericOrderId} not found on ${shopDomain}`);
            }

            const currentTags = getResponse.data.order.tags || "";
            let tagArray = currentTags.split(",").map(t => t.trim()).filter(t => t);

            const defaultStatusTags = [
                "Pending Order Confirmation",
                "Order Confirmed",
                "Order Cancelled",
                "Order Rejected",
                "Pending Confirmation",
                "Confirmed",
                "Cancelled",
                "Order Cancel By customer",
                "✅ Order Confirmed",
                "❌ Order Cancelled",
                "🕒 Pending Confirmation"
            ];

            const tagsToRemove = [...new Set([...defaultStatusTags, ...extraTagsToRemove.filter(t => t)])];
            tagArray = tagArray.filter(tag => !tagsToRemove.includes(tag) || tag === newTag);

            if (!tagArray.includes(newTag)) {
                tagArray.push(newTag);
            }

            const finalTags = tagArray.join(", ");

            const putResponse = await axios.put(url, {
                order: {
                    id: numericOrderId,
                    tags: finalTags
                }
            }, {
                headers: { "X-Shopify-Access-Token": activeToken }
            });

            console.log(`[ShopifyService] SUCCESS - Tags updated for order ${numericOrderId}`);
            return { success: true, data: putResponse.data.order };
        } catch (error) {
            const errorDetails = error.response?.data || error.message;
            const status = error.response?.status;

            console.error(`[ShopifyService] ERROR adding tag to order ${numericOrderId}:`, errorDetails);

            if (status === 401 || status === 403) {
                await this.handleAuthError(shopDomain, errorDetails);
            }

            return { success: false, error: JSON.stringify(errorDetails) };
        }
    }

    /**
     * Marks a merchant as needing re-authentication
     */
    async handleAuthError(shopDomain, errorDetails) {
        console.error(`[ShopifyService] 🚨 AUTH ERROR DETECTED for ${shopDomain}`);
        try {
            await Merchant.findOneAndUpdate(
                { shopDomain: { $regex: new RegExp(`^${shopDomain}$`, "i") } },
                {
                    needsReauth: true,
                    reauthReason: typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails),
                    reauthDetectedAt: new Date()
                }
            );
            console.log(`[ShopifyService] Merchant ${shopDomain} marked for re-authorization`);
        } catch (err) {
            console.error(`[ShopifyService] Failed to mark ${shopDomain} for re-auth:`, err.message);
        }
    }

    /**
     * Fetches order details from Shopify.
     */
    async getOrder(shopDomain, accessToken, orderId) {
        try {
            const activeToken = await this.resolveActiveToken(shopDomain, accessToken);
            const url = `https://${shopDomain}/admin/api/2024-01/orders/${orderId}.json`;
            const response = await axios.get(url, {
                headers: { "X-Shopify-Access-Token": activeToken }
            });
            return response.data.order;
        } catch (error) {
            const status = error.response?.status;
            console.error(`Error fetching Shopify order ${orderId}:`, error.message);

            if (status === 401 || status === 403) {
                await this.handleAuthError(shopDomain, error.response?.data || error.message);
            }
            return null;
        }
    }

    /**
     * Registers a webhook with Shopify
     */
    async registerWebhook(shopDomain, accessToken, topic, callbackUrl) {
        try {
            const activeToken = await this.resolveActiveToken(shopDomain, accessToken);
            const url = `https://${shopDomain}/admin/api/2024-01/webhooks.json`;
            const response = await axios.post(url, {
                webhook: {
                    topic: topic,
                    address: callbackUrl,
                    format: "json"
                }
            }, {
                headers: { "X-Shopify-Access-Token": activeToken }
            });
            console.log(`[ShopifyService] Registered webhook: ${topic}`);
            return { success: true, data: response.data.webhook };
        } catch (error) {
            const status = error.response?.status;
            if (status === 422) {
                console.log(`[ShopifyService] Webhook ${topic} already exists`);
                return { success: true, existing: true };
            }

            if (status === 401 || status === 403) {
                await this.handleAuthError(shopDomain, error.response?.data || error.message);
            }

            console.error(`[ShopifyService] Error registering webhook ${topic}:`, error.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Gets shop information from Shopify
     */
    async getShopInfo(shopDomain, accessToken) {
        try {
            const activeToken = await this.resolveActiveToken(shopDomain, accessToken);
            const url = `https://${shopDomain}/admin/api/2023-10/shop.json`;
            const response = await axios.get(url, {
                headers: { "X-Shopify-Access-Token": activeToken }
            });
            return response.data.shop;
        } catch (error) {
            console.error(`[ShopifyService] Error getting shop info:`, error.message);
            return null;
        }
    }

    /**
     * Complete auto-setup for a new merchant installation
     */
    async autoSetupMerchant(shopDomain, accessToken, webhookBaseUrl) {
        console.log(`[ShopifyService] Starting auto-setup for ${shopDomain}...`);
        const activeToken = await this.resolveActiveToken(shopDomain, accessToken);

        const webhooks = [
            { topic: "orders/create", path: "/Api/webhooks/shopify" },
            { topic: "orders/cancelled", path: "/Api/webhooks/shopify" },
            { topic: "orders/updated", path: "/Api/webhooks/shopify" },
            { topic: "checkouts/create", path: "/Api/webhooks/shopify" },
            { topic: "fulfillments/create", path: "/Api/webhooks/shopify" },
            { topic: "fulfillments/update", path: "/Api/webhooks/shopify" },
            { topic: "app/uninstalled", path: "/Api/webhooks/shopify" }
        ];

        const results = [];
        for (const webhook of webhooks) {
            const callbackUrl = `${webhookBaseUrl}${webhook.path}`;
            const result = await this.registerWebhook(shopDomain, activeToken, webhook.topic, callbackUrl);
            results.push({ topic: webhook.topic, ...result });
        }

        const shopInfo = await this.getShopInfo(shopDomain, activeToken);

        console.log(`[ShopifyService] Auto-setup complete for ${shopDomain}`);
        return {
            webhooks: results,
            shopInfo: shopInfo
        };
    }
}

export const shopifyService = new ShopifyService();
