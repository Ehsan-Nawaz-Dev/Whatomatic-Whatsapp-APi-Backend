import { Router } from "express";
import { ActivityLog } from "../../models/ActivityLog.js";
import { automationService } from "../../services/automationService.js";
import { Merchant } from "../../models/Merchant.js";
import { AutomationSetting } from "../../models/AutomationSetting.js";
import { whatsappCloudService } from "../../services/whatsappCloudService.js";
import { Template } from "../../models/Template.js";
import { shopifyService } from "../../services/shopifyService.js";
import crypto from "crypto";
import { replacePlaceholders, buildPlaceholderMap } from "../../utils/placeholderHelper.js";
import { normalizePhoneNumber } from "../../utils/phoneNormalizer.js";
import { Plan } from "../../models/Plan.js";
import { NotificationSettings } from "../../models/NotificationSettings.js";
import { Contact } from "../../models/Contact.js";
import { WhatsAppSession } from "../../models/WhatsAppSession.js";
import { AutomationStat } from "../../models/AutomationStat.js";
import { Campaign } from "../../models/Campaign.js";
import { ChatButtonSettings } from "../../models/ChatButtonSettings.js";
import { PollMessage } from "../../models/PollMessage.js";
import { checkAndResetBillingCycle } from "../../services/billingService.js";

const router = Router();

// Bulletproof Phone & Name extraction
const getCustomerData = (order) => {
    // Try these 3 places for phone - prioritize shipping address for delivery numbers
    const phone = order.shipping_address?.phone ||
        order.customer?.phone ||
        order.billing_address?.phone ||
        order.phone;

    // Prioritize shipping/billing address name (entered at checkout) over customer account name
    // Shopify's order.customer has the ACCOUNT holder name, not necessarily the buyer's name
    const first = order.shipping_address?.first_name || order.billing_address?.first_name || order.customer?.first_name || "Customer";
    const last = order.shipping_address?.last_name || order.billing_address?.last_name || order.customer?.last_name || "";

    return {
        phone: phone ? phone.replace(/\D/g, '') : null,
        name: `${first} ${last}`.trim()
    };
};

// ... (verifyShopifyWebhook and triggerInternalAlert remains same) ...

// Middleware to verify Shopify Webhook HMAC
const verifyShopifyWebhook = (req, res, next) => {
    const hmac = req.headers["x-shopify-hmac-sha256"];
    const shop = req.headers["x-shopify-shop-domain"];
    const secret = process.env.SHOPIFY_API_SECRET;

    if (!secret) {
        console.warn("SHOPIFY_API_SECRET not set, skipping HMAC validation for development");
        return next();
    }

    if (!hmac) {
        console.error(`[ShopifyWebhook] Missing HMAC header for shop: ${shop}`);
        return res.status(401).send("No HMAC header");
    }

    // Use rawBody captured in server.js middleware for perfect HMAC matching
    // buf in express.json is a Buffer, which is ideal for crypto.update()
    const rawBodyBuffer = req.rawBody ? req.rawBody : Buffer.from(req.body ? JSON.stringify(req.body) : "");
    const generatedHash = crypto
        .createHmac("sha256", secret)
        .update(rawBodyBuffer)
        .digest("base64");

    // Timing safe comparison to satisfy security audits
    try {
        const hashBuffer = Buffer.from(generatedHash);
        const hmacBuffer = Buffer.from(hmac);

        if (hashBuffer.length === hmacBuffer.length && crypto.timingSafeEqual(hashBuffer, hmacBuffer)) {
            return next();
        }
    } catch (err) {
        console.warn(`[ShopifyWebhook] Timing safe comparison failed, falling back to direct match: ${err.message}`);
    }

    // Fallback to direct string comparison if buffers are incompatible
    if (generatedHash === hmac) {
        return next();
    }

    console.error(`[ShopifyWebhook] HMAC validation FAILED for shop: ${shop}`);
    console.error(`[ShopifyWebhook] Topic: ${req.headers["x-shopify-topic"]}`);
    console.error(`[ShopifyWebhook] Generated (base64): ${generatedHash}`);
    console.error(`[ShopifyWebhook] Received (base64): ${hmac}`);

    // Shopify mandatory checks REQUIRE a 401 response for invalid signatures
    res.status(401).send("HMAC validation failed");
};

const triggerInternalAlert = async (type, merchant, orderData) => {
    try {
        if (!merchant?.adminPhoneNumber) return;

        const settings = await NotificationSettings.findOne({ merchant: merchant._id });
        if (!settings?.whatsappAlerts) return;

        // Check if this specific event type is enabled
        if (type === 'confirmed' && !settings.notifyOnConfirm) return;
        if (type === 'cancelled' && !settings.notifyOnCancel) return;
        if (type === 'pending' && !settings.notifyOnAbandoned) return;

        // Skip internal alert for fulfillment webhooks, as they should only be sent to the customer
        // or through the new AutomationSettings flows
        if (['shipped', 'delivered', 'fulfilled'].includes(type)) return;

        const orderNumber = orderData.name || orderData.order_number || `#${orderData.id}`;
        const customerName = orderData.customer?.first_name ? `${orderData.customer.first_name} ${orderData.customer.last_name || ''}` : "Customer";

        let alertMsg = `🔔 *New Alert:* ${type.toUpperCase()}\n\n`;
        alertMsg += `*Order:* ${orderNumber}\n`;
        alertMsg += `*Customer:* ${customerName}\n`;
        alertMsg += `*Status:* ${type === 'confirmed' ? '✅ Confirmed' : (type === 'cancelled' ? '❌ Cancelled' : '🕒 Pending')}\n\n`;
        alertMsg += `Check your WhatFlow dashboard for details.`;

        await whatsappCloudService.sendTextMessage(merchant.shopDomain, merchant.adminPhoneNumber, alertMsg);
        console.log(`[InternalAlert] Sent ${type} alert to admin for ${merchant.shopDomain}`);

        // NEW: Tag the order as 'Admin Notified' in Shopify
        if (merchant.shopifyAccessToken && orderData.id) {
            const orderId = orderData.id.toString().split('/').pop();
            const adminTag = merchant.adminNotifiedTag || "📣 Admin Notified";
            await shopifyService.addOrderTag(merchant.shopDomain, merchant.shopifyAccessToken, orderId, adminTag);
            console.log(`[InternalAlert] Applied ${adminTag} to order ${orderId}`);
        }
    } catch (err) {
        console.error("[InternalAlert] Failed to send alert:", err);
    }
};

const logEvent = async (type, req, shopDomain, customData = {}) => {
    try {
        const merchant = await Merchant.findOne({ shopDomain });
        const { phone: customerPhone, name: customerName } = getCustomerData(customData.orderForPlaceholders || req.body);
        const resolvedPhone = customData.customerPhone || customerPhone;
        const resolvedName = customData.customerName || customerName;
        const resolvedOrderId = customData.orderId || (type === "shipped" || type === "fulfilled" ? (req.body?.order_id?.toString() || req.body?.id?.toString()) : (req.body?.id?.toString() || req.body?.order_id?.toString()));

        const log = await ActivityLog.create({
            merchant: merchant?._id,
            type,
            orderId: resolvedOrderId,
            customerName: resolvedName,
            customerPhone: resolvedPhone,
            message: `Shopify webhook: ${type}`,
            rawPayload: req.body,
        });

        // Trigger Internal WhatsApp Alert if enabled
        if (merchant) {
            triggerInternalAlert(type, merchant, customData.orderForPlaceholders || req.body);
        }

        return log;
    } catch (err) {
        console.error("Error logging activity", err);
    }
};

// Universal Webhook Endpoint: POST /api/webhooks/shopify
router.post("/", verifyShopifyWebhook, async (req, res) => {
    const topic = req.headers["x-shopify-topic"];
    const shopDomain = req.headers["x-shopify-shop-domain"] || req.headers["x-shop-domain"] || req.query.shop;

    console.log(`Webhook received - Topic: ${topic}, Shop: ${shopDomain}`);

    if (!shopDomain) {
        console.warn("Webhook received without shop domain");
        return res.status(200).send("ok");
    }

    // --- MANDATORY GDPR COMPLIANCE WEBHOOKS ---
    // These are required for Shopify App Store approval
    if (topic === "customers/data_request") {
        console.log(`[GDPR] Customer Data Request received for shop: ${shopDomain}`);
        return res.status(200).send("ok");
    }

    if (topic === "customers/redact") {
        const { customer, shop_domain } = req.body;
        console.log(`[GDPR] Customer Redact requested for ${customer?.email} on ${shop_domain || shopDomain}`);
        try {
            if (customer?.phone) {
                const formattedPhone = customer.phone.replace(/\D/g, '');
                await Contact.deleteMany({ phone: { $regex: new RegExp(formattedPhone) } });
                await ActivityLog.deleteMany({ customerPhone: { $regex: new RegExp(formattedPhone) } });
            }
        } catch (err) {
            console.error(`[GDPR] Redact failed:`, err);
        }
        return res.status(200).send("ok");
    }

    if (topic === "shop/redact") {
        const { shop_domain } = req.body;
        console.log(`[GDPR] Shop Redact requested for ${shop_domain || shopDomain}`);
        try {
            await Merchant.findOneAndUpdate({ shopDomain: shop_domain || shopDomain }, { isActive: false, shopifyAccessToken: null });
        } catch (err) {
            console.error(`[GDPR] Shop Redact failed:`, err);
        }
        return res.status(200).send("ok");
    }

    let merchant = await Merchant.findOne({ shopDomain });
    if (!merchant) {
        console.warn(`No merchant found for shop: ${shopDomain}`);
        return res.status(200).send("ok");
    }

    // Reset billing cycle if 30 days have elapsed
    merchant = await checkAndResetBillingCycle(merchant);

    const body = req.body;
    const order = body.order || body; // Handle Shopify nesting

    // Determine if this is a fulfillment webhook
    const isFulfillment = topic && topic.includes('fulfill');

    // Resolve the actual Order ID (prioritize order_id for fulfillment webhooks)
    const orderId = isFulfillment
        ? (order.order_id?.toString() || order.id?.toString())
        : (order.id?.toString() || order.order_id?.toString() || (order.admin_graphql_api_id ? order.admin_graphql_api_id.split('/').pop() : null));

    // For fulfillment, pre-emptively fetch full order details if we have token and orderId
    let apiOrder = null;
    if (isFulfillment && merchant.shopifyAccessToken && orderId) {
        console.log(`[ShopifyWebhook] Fulfillment topic detected. Fetching full order details for orderId ${orderId}...`);
        try {
            apiOrder = await shopifyService.getOrder(shopDomain, merchant.shopifyAccessToken, orderId);
        } catch (err) {
            console.warn(`[ShopifyWebhook] Failed to fetch order ${orderId} for fulfillment: ${err.message}`);
        }
    }

    // Merge fulfillment details into the fetched order so placeholders resolve perfectly
    let orderForPlaceholders = order;
    if (isFulfillment && apiOrder) {
        orderForPlaceholders = {
            ...apiOrder,
            tracking_url: order.tracking_url,
            tracking_urls: order.tracking_urls,
            tracking_number: order.tracking_number,
            tracking_numbers: order.tracking_numbers,
            tracking_company: order.tracking_company,
            fulfillments: [
                {
                    tracking_url: order.tracking_url,
                    tracking_number: order.tracking_number,
                    tracking_company: order.tracking_company,
                    ...order
                }
            ]
        };
    } else {
        orderForPlaceholders = apiOrder || order;
    }

    // Resolve customer info using the full order details if available
    const { phone: customerPhoneRaw, name: customerName } = getCustomerData(orderForPlaceholders);
    const orderNumber = orderForPlaceholders.name || orderForPlaceholders.order_number || `#${orderId || 'N/A'}`;

    // Format the Customer Phone (auto-detect country from order address, fallback to merchant country)
    let customerPhoneFormatted = normalizePhoneNumber(customerPhoneRaw, orderForPlaceholders, merchant?.country || merchant?.defaultCountry);

    // --- CASE: MISSING PHONE ---
    // If phone is missing and we have an orderId, try fetching the order to get the phone (for non-fulfillment webhooks)
    if (!customerPhoneFormatted && orderId && merchant.shopifyAccessToken && !apiOrder && topic && !topic.includes("checkout")) {
        console.log(`[ShopifyWebhook] Phone missing for topic ${topic}. Attempting to fetch order ${orderId} for data...`);
        try {
            apiOrder = await shopifyService.getOrder(shopDomain, merchant.shopifyAccessToken, orderId);
            if (apiOrder) {
                const freshData = getCustomerData(apiOrder);
                if (freshData.phone) {
                    orderForPlaceholders = apiOrder;
                    customerPhoneFormatted = normalizePhoneNumber(freshData.phone, apiOrder);
                    console.log(`[ShopifyWebhook] Successfully recovered phone: ${customerPhoneFormatted}`);
                }
            }
        } catch (err) {
            console.warn(`[ShopifyWebhook] Failed to recover phone from API: ${err.message}`);
        }
    }

    const isDuplicateWebhook = async (merchantId, orderId, topic, actualType = null) => {
        try {
            const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

            // For Order notifications, we check if ANY activity (pending or processed) exists
            if (topic.includes('orders/create') || topic.includes('orders/updated')) {
                const existing = await ActivityLog.findOne({
                    merchant: merchantId,
                    orderId: orderId,
                    type: { $in: ['pending', 'confirmed', 'cancelled', 'pre-cancel', 'failed'] },
                    createdAt: { $gt: fifteenMinutesAgo }
                });
                return !!existing;
            }

            // For other topics, use specific type matches
            const type = actualType || (topic.includes('cancel') ? 'cancelled' :
                (topic.includes('abandoned') ? 'pending' :
                    (topic.includes('fulfill') ? 'shipped' : 'pending')));

            const existing = await ActivityLog.findOne({
                merchant: merchantId,
                orderId: orderId,
                type: type,
                createdAt: { $gt: fifteenMinutesAgo }
            });
            return !!existing;
        } catch (err) {
            return false;
        }
    };

    // ONLY handle orders/create — NOT orders/updated with pending status
    // Shopify fires BOTH webhooks simultaneously for new orders, causing duplicate messages
    if (topic === "orders/create") {
        // 1. Create the Activity Log as 'pending'
        console.log(`[ShopifyWebhook] Processing ${topic} for ${orderNumber} (ID: ${orderId})`);

        // Idempotency Check (standard query)
        if (orderId && await isDuplicateWebhook(merchant._id, orderId, topic)) {
            console.log(`[ShopifyWebhook] Duplicate orders/create for ${orderId}. Skipping.`);
            return res.status(200).send('ok');
        }

        // ATOMIC LOCK: Use MongoDB findOneAndUpdate with upsert to prevent race conditions
        // If two webhooks arrive simultaneously, only one will successfully create the lock
        try {
            const lockResult = await ActivityLog.findOneAndUpdate(
                {
                    merchant: merchant._id,
                    orderId: orderId,
                    createdAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) }
                },
                {
                    $setOnInsert: {
                        merchant: merchant._id,
                        type: 'pending',
                        orderId: orderId,
                        message: 'Processing Order Notification...',
                        customerName: customerName,
                        customerPhone: customerPhoneFormatted,
                        rawPayload: order
                    }
                },
                { upsert: true, new: false } // Returns null if it was a fresh insert (no prior doc)
            );

            if (lockResult) {
                // Document already existed — another webhook already claimed this order
                console.log(`[ShopifyWebhook] ATOMIC LOCK: Order ${orderId} already being processed. Skipping duplicate.`);
                return res.status(200).send('ok');
            }
            console.log(`[ShopifyWebhook] ATOMIC LOCK: Acquired lock for order ${orderId}`);
        } catch (lockErr) {
            // E11000 duplicate key error means another webhook won the race — skip
            if (lockErr.code === 11000) {
                console.log(`[ShopifyWebhook] ATOMIC LOCK: Duplicate key for order ${orderId}. Skipping.`);
                return res.status(200).send('ok');
            }
            console.error(`[ShopifyWebhook] Lock error:`, lockErr.message);
        }

        // Fetch the activity log that was just created by the atomic lock above
        const activity = await ActivityLog.findOne({
            merchant: merchant._id,
            orderId: orderId,
            type: 'pending',
            createdAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) }
        });

        // NEW: Save Customer to Contacts
        if (customerPhoneFormatted && merchant) {
            try {
                await Contact.findOneAndUpdate(
                    { merchant: merchant._id, phone: customerPhoneFormatted },
                    {
                        $set: {
                            name: customerName,
                            email: order.customer?.email,
                            lastOrderAt: new Date(),
                            source: 'shopify'
                        },
                        $inc: { totalOrders: 1 }
                    },
                    { upsert: true }
                );
                console.log(`[Contact] Saved/Updated contact ${customerName} for ${shopDomain}`);
            } catch (contactErr) {
                console.error(`[Contact] Failed to save contact:`, contactErr.message);
            }
        }

        res.status(200).send('ok'); // Tell Shopify we got it

        // Processing continues in the background
        (async () => {
            try {
                // 1. Trigger Admin Alert (admin-order-alert) when order is first received
                try {
                    const adminSetting = await AutomationSetting.findOne({ shopDomain, type: "admin-order-alert" });
                    const updatedMerchant = await Merchant.findOne({ shopDomain });
                    if (adminSetting?.enabled && updatedMerchant?.adminPhoneNumber) {
                        console.log(`[ShopifyWebhook] Admin Order Alert enabled. Preparing to send...`);
                        const adminTemplate = await Template.findOne({ merchant: updatedMerchant._id, event: "admin-order-alert" });
                        if (adminTemplate) {
                            let fullOrderData = order;
                            if (updatedMerchant.shopifyAccessToken && orderId) {
                                try {
                                    const apiOrderData = await shopifyService.getOrder(shopDomain, updatedMerchant.shopifyAccessToken, orderId);
                                    if (apiOrderData) fullOrderData = apiOrderData;
                                } catch (err) {
                                    console.warn(`[ShopifyWebhook] Admin alert: failed to fetch order from API:`, err.message);
                                }
                            }
                            let adminMsg = replacePlaceholders(adminTemplate.message, { order: fullOrderData, merchant: updatedMerchant });
                            console.log(`[ShopifyWebhook] Sending Admin Order Alert to ${updatedMerchant.adminPhoneNumber}`);
                            await whatsappCloudService.sendTextMessage(shopDomain, updatedMerchant.adminPhoneNumber, adminMsg);
                            await automationService.trackSent(shopDomain, "admin-order-alert");
                        }
                    }
                } catch (adminErr) {
                    console.error("[ShopifyWebhook] Admin order alert error:", adminErr);
                }

                // Trigger 2: Customer Confirmation (Customer is notified IMMEDIATELY)
                const orderConfirmationSetting = await AutomationSetting.findOne({ shopDomain, type: "order-confirmation" });
                const bankTransferSetting = await AutomationSetting.findOne({ shopDomain, type: "bank-transfer-confirmation" }) || orderConfirmationSetting;
                if (orderConfirmationSetting?.enabled || bankTransferSetting?.enabled) {
                    if (!customerPhoneFormatted) {
                        // If no phone, we update log and finish (don't throw error to catch-all)
                        if (activity) {
                            activity.type = 'failed';
                            activity.message = 'Skipped: No phone number found 📵';
                            await activity.save();
                        }
                        return;
                    }

                    let updatedMerchant = await Merchant.findOne({ shopDomain });
                    if (updatedMerchant) {
                        updatedMerchant = await checkAndResetBillingCycle(updatedMerchant);
                    }
                    console.log(`[ShopifyWebhook] Merchant found. Has accessToken: ${!!updatedMerchant?.shopifyAccessToken}, Token length: ${updatedMerchant?.shopifyAccessToken?.length || 0}`);

                    // Meta Cloud API sends messages directly

                    // FETCH COMPLETE ORDER FROM SHOPIFY API (webhook may have incomplete data)
                    let fullOrderData = order; // Default to webhook data
                    if (updatedMerchant?.shopifyAccessToken && orderId) {
                        console.log(`[ShopifyWebhook] Fetching complete order data from Shopify API for order ${orderId}...`);
                        try {
                            const apiOrderData = await shopifyService.getOrder(shopDomain, updatedMerchant.shopifyAccessToken, orderId);
                            if (apiOrderData) {
                                fullOrderData = apiOrderData;
                                console.log(`[ShopifyWebhook] Got complete order from API. Has shipping_address: ${!!apiOrderData.shipping_address}, Has address1: ${!!apiOrderData.shipping_address?.address1}`);
                            } else {
                                console.warn(`[ShopifyWebhook] API returned null for order ${orderId}, using webhook data`);
                            }
                        } catch (apiErr) {
                            console.warn(`[ShopifyWebhook] Failed to fetch order from API, using webhook data:`, apiErr.message);
                        }
                    } else {
                        console.warn(`[ShopifyWebhook] Skipping API fetch - accessToken: ${!!updatedMerchant?.shopifyAccessToken}, orderId: ${orderId}`);
                    }

                    // Check if payment method is bank transfer/deposit
                    const paymentGateways = (fullOrderData.payment_gateway_names || []).map(g => g.toLowerCase());
                    const gateway = (fullOrderData.gateway || "").toLowerCase();
                    const isBankTransfer = gateway.includes("bank") || 
                                           gateway.includes("transfer") || 
                                           gateway.includes("deposit") || 
                                           paymentGateways.some(g => g.includes("bank") || g.includes("transfer") || g.includes("deposit"));

                    let customerTemplate = null;
                    if (isBankTransfer) {
                        // Check if bank transfer automation is enabled
                        if (!bankTransferSetting?.enabled) {
                            console.log(`[ShopifyWebhook] Skipping bank transfer confirmation for ${orderId}: automation is disabled`);
                            if (activity) {
                                activity.type = 'confirmed';
                                activity.message = 'Skipped: Bank Transfer Automation is disabled 🛑';
                                await activity.save();
                            }
                            return;
                        }

                        console.log(`[ShopifyWebhook] Order ${orderId} detected as Bank Transfer. Checking for specific template...`);
                        customerTemplate = await Template.findOne({ 
                            merchant: updatedMerchant?._id, 
                            event: "orders/create/bank_transfer",
                            enabled: true 
                        });
                    } else {
                        // Check if order confirmation automation is enabled
                        if (!orderConfirmationSetting?.enabled) {
                            console.log(`[ShopifyWebhook] Skipping order confirmation for ${orderId}: automation is disabled`);
                            if (activity) {
                                activity.type = 'confirmed';
                                activity.message = 'Skipped: Order Confirmation Automation is disabled 🛑';
                                await activity.save();
                            }
                            return;
                        }
                    }

                    if (!customerTemplate) {
                        customerTemplate = await Template.findOne({ merchant: updatedMerchant?._id, event: "orders/create" });
                    }
                    
                    // NEW: Filter by Payment Status if configured
                    if (customerTemplate?.targetOrderStatus && customerTemplate.targetOrderStatus !== "all") {
                        const financialStatus = (fullOrderData.financial_status || "").toLowerCase();
                        
                        // Treat 'pending' or 'authorized' as pending
                        const isPending = financialStatus === "pending" || financialStatus === "authorized" || !financialStatus;
                        // Treat 'paid' or 'partially_paid' as paid
                        const isPaid = financialStatus === "paid" || financialStatus === "partially_paid";

                        const shouldSkip = (customerTemplate.targetOrderStatus === "pending" && !isPending) || 
                                           (customerTemplate.targetOrderStatus === "paid" && !isPaid);

                        if (shouldSkip) {
                            console.log(`[ShopifyWebhook] Skipping order confirmation for ${orderId}. Order status is ${financialStatus}, but template target is ${customerTemplate.targetOrderStatus}.`);
                            if (activity) {
                                activity.type = 'confirmed'; // Not an error, just intentionally skipped
                                activity.message = `Skipped: Order is ${financialStatus}, but target is ${customerTemplate.targetOrderStatus} 🛑`;
                                await activity.save();
                            }
                            return;
                        }
                    }

                    let customerMsg = customerTemplate?.message || `Hi {{customer_name}}, your order {{order_number}} has been received! We'll notify you when it ships.`;

                    // Replace Placeholders using the FULL order data from API
                    console.log(`[ShopifyWebhook] Replacing placeholders in message for order ${orderId}`);
                    customerMsg = replacePlaceholders(customerMsg, { order: fullOrderData, merchant: updatedMerchant });
                    console.log(`[ShopifyWebhook] Final message to send: ${customerMsg}`);

                    // NEW: Usage & Plan Limit Check
                    const planConfig = await Plan.findOne({ id: updatedMerchant.plan || 'free' });
                    const currentLimit = planConfig ? planConfig.messageLimit : (updatedMerchant.trialLimit || 10);
                    const currentUsage = updatedMerchant.usage || 0;

                    if (currentUsage >= currentLimit) {
                        if (updatedMerchant.shopifyUsageLineItemId && updatedMerchant.plan !== 'professional') {
                            console.log(`[ShopifyWebhook] Auto-upgrade allowance for ${shopDomain}. Limit was ${currentLimit}.`);
                        } else {
                            console.warn(`[ShopifyWebhook] Message limit reached for ${shopDomain} (Plan: ${updatedMerchant.plan}). Message blocked.`);
                            if (activity) {
                                activity.type = 'failed';
                                activity.message = `Limit Reached (${currentLimit} messages) 🛑`;
                                await activity.save();
                            }

                            if (updatedMerchant?.shopifyAccessToken) {
                                await shopifyService.addOrderTag(shopDomain, updatedMerchant.shopifyAccessToken, orderId, "⚠️ Limit Reached");
                            }
                            return;
                        }
                    }

                    let result;
                    console.log(`[ShopifyWebhook] Sending WhatsApp to ${customerPhoneFormatted} via ${updatedMerchant.whatsappProvider}...`);

                    if (customerTemplate?.sendingDelay && customerTemplate.sendingDelay > 0) {
                        console.log(`[ShopifyWebhook] Delaying message by ${customerTemplate.sendingDelay} minutes...`);
                        await new Promise(resolve => setTimeout(resolve, customerTemplate.sendingDelay * 60 * 1000));
                    }

                    result = await whatsappCloudService.sendAutomationMessage(shopDomain, customerPhoneFormatted, customerTemplate, customerMsg, buildPlaceholderMap({ order: fullOrderData, merchant: updatedMerchant }));
                    console.log(`[ShopifyWebhook] WhatsApp send result:`, result);

                    if (result && result.success) {
                        // Increment usage for all plans and check billing
                        const incMerchant = await Merchant.findOneAndUpdate({ shopDomain }, { $inc: { usage: 1, trialUsage: updatedMerchant.plan === 'trial' ? 1 : 0 } }, { new: true });
                        import('../../services/billingService.js').then(({ checkAndChargeUsage }) => {
                            checkAndChargeUsage(incMerchant);
                        }).catch(err => console.error("Billing service error:", err));

                        await automationService.trackSent(shopDomain, "order-confirmation");

                        // ADD SHOPIFY TAGS
                        console.log(`[ShopifyWebhook] Checking if we can tag order. AccessToken present: ${!!updatedMerchant?.shopifyAccessToken}`);

                        if (updatedMerchant?.shopifyAccessToken) {
                            console.log(`[ShopifyWebhook] Applying pending tag to order ${orderId}`);

                            // Helper to ensure emoji exists
                            const formatTag = (tag, defaultText, emoji) => {
                                const final = tag || defaultText;
                                if (final.includes(emoji)) return final;
                                if (/[\u{1F300}-\u{1F9FF}]/u.test(final)) return final;
                                return `${emoji} ${final}`;
                            };

                            const pendingTag = formatTag(updatedMerchant.pendingConfirmTag, "Pending Confirmation", "🕒");

                            // Tags to remove (both old defaults and potentially current config)
                            const tagsToRemove = [
                                updatedMerchant.orderConfirmTag,
                                updatedMerchant.orderCancelTag,
                                "Order Confirmed",
                                "Order Cancelled",
                                "Order Cancel By customer",
                                "✅ Order Confirmed",
                                "❌ Order Cancelled"
                            ].filter(t => t && t !== pendingTag);

                            const tagResult = await shopifyService.addOrderTag(
                                shopDomain,
                                updatedMerchant.shopifyAccessToken,
                                orderId,
                                pendingTag,
                                tagsToRemove
                            );
                            console.log(`[ShopifyWebhook] Tagging result for order ${orderId}:`, tagResult);
                        } else {
                            console.warn(`[ShopifyWebhook] SKIPPING TAGGING - No shopifyAccessToken found for ${shopDomain}. Please complete Shopify OAuth.`);
                        }

                        // 4. UPDATE DASHBOARD TO PENDING (WAITING FOR CUSTOMER)
                        if (activity) {
                            activity.type = 'pending';
                            activity.message = 'WhatsApp Message Sent ✅ (Awaiting Customer)';
                            await activity.save();
                        }
                    } else if (result?.queued && result?.messageId) {
                        // Customer's phone is offline: message sits on WhatsApp's servers (✓ only).
                        // Don't count or tag yet — when the delivery receipt (✓✓) arrives,
                        // deliveryService completes the count + tag + dashboard status automatically.
                        console.warn(`[ShopifyWebhook] Message queued (customer offline) for ${shopDomain}, order ${orderId}. Waiting for delivery receipt.`);
                        try {
                            const { DeferredDelivery } = await import("../../models/DeferredDelivery.js");
                            await DeferredDelivery.create({
                                shopDomain,
                                messageKeyId: result.messageId,
                                orderId: String(orderId),
                                activityId: activity?._id,
                                customerPhone: customerPhoneFormatted,
                                kind: "order-confirmation"
                            });
                        } catch (defErr) {
                            console.error(`[ShopifyWebhook] Failed to save deferred delivery:`, defErr.message);
                        }
                        if (activity) {
                            activity.type = 'failed';
                            activity.message = 'Not Delivered Yet (Customer Offline) ⏳';
                            activity.errorMessage = 'Message is on WhatsApp servers but has not reached the customer. The order will be tagged and counted automatically once it is delivered.';
                            await activity.save();
                        }
                    } else {
                        const errorMsg = result?.error || "Failed to send WhatsApp message (unknown error)";
                        console.warn(`[ShopifyWebhook] WhatsApp Error for ${shopDomain}: ${errorMsg}`);
                        if (activity) {
                            activity.type = 'failed';
                            activity.message = 'Failed to send WhatsApp ❌';
                            activity.errorMessage = errorMsg;
                            await activity.save();
                        }
                    }
                } else {
                    console.log(`[ShopifyWebhook] Automation DISABLED for order-confirmation. Skipping.`);
                    if (activity) {
                        // If customer setting disabled but admin alert was sent, mark as confirmed/processed
                        activity.type = 'confirmed';
                        activity.message = 'Automation Disabled (Admin Alert Sent) ✅';
                        await activity.save();
                    }
                }
            } catch (err) {
                // 5. UPDATE DASHBOARD TO RED (FAILED)
                console.error(`Webhook Background Error for ${shopDomain}:`, err);
                if (activity) {
                    activity.type = 'failed';
                    activity.message = 'Failed to send WhatsApp ❌';
                    activity.errorMessage = err.message;
                    await activity.save();
                }
            }
        })();
        return;
    } else if (topic === "orders/cancelled") {
        const orderId = order.id?.toString() || (order.admin_graphql_api_id ? order.admin_graphql_api_id.split('/').pop() : null);

        if (orderId && await isDuplicateWebhook(merchant._id, orderId, topic)) {
            console.log(`[ShopifyWebhook] Duplicate orders/cancelled for ${orderId}. Skipping.`);
            return res.status(200).send('ok');
        }

        await logEvent("cancelled", req, shopDomain);
        res.status(200).send("ok");

        (async () => {
            try {
                const cancelSetting = await AutomationSetting.findOne({ shopDomain, type: "cancellation" });
                const cancelTemplate = await Template.findOne({ merchant: merchant._id, event: "orders/cancelled" });

                if (!cancelSetting?.enabled || !cancelTemplate?.enabled) {
                    console.log(`[ShopifyWebhook] Cancellation skipped: setting=${!!cancelSetting?.enabled}, template=${!!cancelTemplate?.enabled}`);
                    return;
                }

                if (!customerPhoneFormatted) {
                    console.warn(`[ShopifyWebhook] Cannot send cancellation: No phone number for ${orderNumber}`);
                    return;
                }

                let cancelMsg = cancelTemplate.message;
                cancelMsg = replacePlaceholders(cancelMsg, { order, merchant });
                cancelMsg = cancelMsg.replace(/{{customer_name}}/g, customerName);

                if (cancelTemplate?.sendingDelay && cancelTemplate.sendingDelay > 0) {
                    console.log(`[ShopifyWebhook] Delaying cancellation message by ${cancelTemplate.sendingDelay} minutes...`);
                    await new Promise(resolve => setTimeout(resolve, cancelTemplate.sendingDelay * 60 * 1000));
                }

                let result = await whatsappCloudService.sendAutomationMessage(shopDomain, customerPhoneFormatted, cancelTemplate, cancelMsg, buildPlaceholderMap({ order, merchant }));

                if (result?.success) {
                    if (merchant?.shopifyAccessToken && orderId) {
                        await shopifyService.addOrderTag(shopDomain, merchant.shopifyAccessToken, orderId, merchant.orderCancelTag || "Order Cancelled", [merchant.pendingConfirmTag, merchant.orderConfirmTag]);
                    }
                } else {
                    console.error(`[ShopifyWebhook] Failed to send cancellation message for order ${orderId}: ${result?.error || 'Unknown error'}`);
                }
            } catch (err) {
                console.error(`[ShopifyWebhook] Error processing cancellation:`, err);
            }
        })();
        return;
    } else if (topic === "checkouts/abandoned") {
        const orderId = order.id?.toString() || order.checkout_id?.toString();

        // Idempotency Check
        if (orderId && await isDuplicateWebhook(merchant._id, orderId, topic)) {
            console.log(`[ShopifyWebhook] Duplicate checkouts/abandoned for ${orderId}. Skipping.`);
            return res.status(200).send('ok');
        }

        const activity = await logEvent("pending", req, shopDomain);
        res.status(200).send("ok");

        (async () => {
            try {
                const setting = await AutomationSetting.findOne({ shopDomain, type: "abandoned_cart" }) || await AutomationSetting.findOne({ shopDomain, type: "abandoned-cart" });
                const abandonedTemplate = await Template.findOne({ merchant: merchant._id, event: "checkouts/abandoned" });
                
                if (!setting?.enabled || !abandonedTemplate?.enabled) {
                    console.log(`[ShopifyWebhook] Abandoned Cart skipped: setting=${!!setting?.enabled}, template=${!!abandonedTemplate?.enabled}`);
                    if (activity) {
                        activity.type = 'confirmed'; // Skip as processed/ignored
                        activity.message = `Skipped: Automation is disabled 🛑`;
                        await activity.save();
                    }
                    return;
                }

                if (!customerPhoneFormatted) {
                    console.warn(`[ShopifyWebhook] Abandoned checkout skipped: No phone number found.`);
                    if (activity) {
                        activity.type = 'failed';
                        activity.message = 'Skipped: No phone number found 📵';
                        await activity.save();
                    }
                    return;
                }

                let abandonedMsg = abandonedTemplate.message;
                abandonedMsg = replacePlaceholders(abandonedMsg, { order, merchant });
                abandonedMsg = abandonedMsg.replace(/{{customer_name}}/g, customerName);

                // Usage check for abandoned cart
                const planConfig = await Plan.findOne({ id: merchant.plan || 'free' });
                const currentLimit = planConfig ? planConfig.messageLimit : (merchant.trialLimit || 10);
                if ((merchant.usage || 0) >= currentLimit) {
                    if (merchant.shopifyUsageLineItemId && merchant.plan !== 'professional') {
                        console.log(`[ShopifyWebhook] Auto-upgrade allowance for abandoned cart ${shopDomain}.`);
                    } else {
                        console.warn(`[ShopifyWebhook] Limit reached for ${shopDomain} (Abandoned Cart blocked)`);
                        if (activity) {
                            activity.type = 'failed';
                            activity.message = `Limit Reached (${currentLimit} messages) 🛑`;
                            await activity.save();
                        }
                        return;
                    }
                }

                let result;

                if (abandonedTemplate?.sendingDelay && abandonedTemplate.sendingDelay > 0) {
                    console.log(`[ShopifyWebhook] Delaying abandoned cart message by ${abandonedTemplate.sendingDelay} minutes...`);
                    await new Promise(resolve => setTimeout(resolve, abandonedTemplate.sendingDelay * 60 * 1000));
                }

                result = await whatsappCloudService.sendAutomationMessage(shopDomain, customerPhoneFormatted, abandonedTemplate, abandonedMsg, buildPlaceholderMap({ order, merchant }));

                if (result?.success) {
                    const incMerchant = await Merchant.findOneAndUpdate({ shopDomain }, { $inc: { usage: 1, trialUsage: merchant.plan === 'trial' ? 1 : 0 } }, { new: true });
                    import('../../services/billingService.js').then(({ checkAndChargeUsage }) => {
                        checkAndChargeUsage(incMerchant);
                    }).catch(err => console.error("Billing service error:", err));
                    await automationService.trackSent(shopDomain, "abandoned_cart");
                    
                    if (activity) {
                        activity.message = 'Cart Recovery Message Sent ✅';
                        await activity.save();
                    }
                } else {
                    const errorMsg = result?.error || "Failed to send WhatsApp message (unknown error)";
                    console.warn(`[ShopifyWebhook] WhatsApp Error for ${shopDomain}: ${errorMsg}`);
                    if (activity) {
                        activity.type = 'failed';
                        activity.message = 'Failed to send WhatsApp ❌';
                        activity.errorMessage = errorMsg;
                        await activity.save();
                    }
                }
            } catch (err) {
                console.error(`[ShopifyWebhook] Error processing abandoned cart for ${shopDomain}:`, err);
                if (activity) {
                    activity.type = 'failed';
                    activity.message = 'Failed to send WhatsApp ❌';
                    activity.errorMessage = err.message;
                    await activity.save();
                }
            }
        })();
        return;
    } else if (topic === "fulfillments/update" || topic === "fulfillments/create") {
        const orderId = order.order_id?.toString() || order.id?.toString();

        const isDelivered = order.shipment_status === "delivered" || orderForPlaceholders?.shipment_status === "delivered";
        const targetType = isDelivered ? "delivered" : "shipped";
        const automationType = isDelivered ? "fulfillment_delivered" : "fulfillment_update";
        const templateEvent = isDelivered ? "fulfillments/delivered" : "fulfillments/update";

        if (orderId && await isDuplicateWebhook(merchant._id, orderId, topic, targetType)) {
            console.log(`[ShopifyWebhook] Duplicate fulfillments update/create for ${orderId} as ${targetType}. Skipping.`);
            return res.status(200).send('ok');
        }

        await logEvent(targetType, req, shopDomain, { orderForPlaceholders, customerPhone: customerPhoneFormatted, customerName, orderId });
        res.status(200).send("ok");

        (async () => {
            try {
                let setting = await AutomationSetting.findOne({ shopDomain, type: automationType });
                if (!setting && !isDelivered) {
                    setting = await AutomationSetting.findOne({ shopDomain, type: "shipment-update" });
                }
                const template = await Template.findOne({ merchant: merchant._id, event: templateEvent });

                if (!setting?.enabled || !template?.enabled) {
                    console.log(`[ShopifyWebhook] Fulfillment (${targetType}) skipped: setting=${!!setting?.enabled}, template=${!!template?.enabled}`);
                    return;
                }

                if (!customerPhoneFormatted) {
                    console.warn(`[ShopifyWebhook] Cannot send fulfillment (${targetType}): No phone number for ${orderNumber}`);
                    return;
                }

                // Plan limit check
                const planConfig = await Plan.findOne({ id: merchant.plan || 'free' });
                const currentLimit = planConfig ? planConfig.messageLimit : (merchant.trialLimit || 10);
                if ((merchant.usage || 0) >= currentLimit) {
                    if (merchant.shopifyUsageLineItemId && merchant.plan !== 'professional') {
                        console.log(`[ShopifyWebhook] Auto-upgrade allowance for fulfillment ${targetType} ${shopDomain}.`);
                    } else {
                        console.warn(`[ShopifyWebhook] Limit reached for ${shopDomain} (Fulfillment ${targetType} blocked)`);
                        return;
                    }
                }

                let fulfillmentMsg = template.message;
                fulfillmentMsg = replacePlaceholders(fulfillmentMsg, { order: orderForPlaceholders, merchant });
                fulfillmentMsg = fulfillmentMsg.replace(/{{customer_name}}/g, customerName);

                if (template?.sendingDelay && template.sendingDelay > 0) {
                    console.log(`[ShopifyWebhook] Delaying fulfillment (${targetType}) message by ${template.sendingDelay} minutes...`);
                    await new Promise(resolve => setTimeout(resolve, template.sendingDelay * 60 * 1000));
                }

                const result = await whatsappCloudService.sendAutomationMessage(shopDomain, customerPhoneFormatted, template, fulfillmentMsg, buildPlaceholderMap({ order: orderForPlaceholders, merchant }));

                if (result?.success) {
                    const incMerchant = await Merchant.findOneAndUpdate({ shopDomain }, { $inc: { usage: 1, trialUsage: merchant.plan === 'trial' ? 1 : 0 } }, { new: true });
                    import('../../services/billingService.js').then(({ checkAndChargeUsage }) => {
                        checkAndChargeUsage(incMerchant);
                    }).catch(err => console.error("Billing service error:", err));
                    await automationService.trackSent(shopDomain, automationType);
                }
            } catch (err) {
                console.error(`[ShopifyWebhook] Error processing fulfillment (${targetType}):`, err);
            }
        })();
        return;
    } else if (topic === "orders/paid") {
        const revenue = parseFloat(req.body?.total_price || 0);
        await automationService.trackRecovered(shopDomain, revenue);
    } else if (topic === "app/uninstalled") {

        const merchantToDelete = await Merchant.findOne({ shopDomain });
        if (merchantToDelete) {
            await Promise.all([
                Merchant.deleteOne({ _id: merchantToDelete._id }),
                ActivityLog.deleteMany({ merchant: merchantToDelete._id }),
                AutomationSetting.deleteMany({ shopDomain }),
                Template.deleteMany({ merchant: merchantToDelete._id }),
                Contact.deleteMany({ merchant: merchantToDelete._id }),
                NotificationSettings.deleteMany({ merchant: merchantToDelete._id }),
                WhatsAppAuth.deleteMany({ shopDomain }),
                WhatsAppSession.deleteMany({ shopDomain }),
                AutomationStat.deleteMany({ shopDomain }),
                Campaign.deleteMany({ shopDomain }),
                ChatButtonSettings.deleteMany({ shopDomain }),
                PollMessage.deleteMany({ shopDomain })
            ]);
        }
        console.log(`[ShopifyWebhook] App UNINSTALLED for ${shopDomain}. All store data immediately deleted.`);
    } else if (topic === "app_subscriptions/update") {
        const { app_subscription } = req.body;
        console.log(`[ShopifyWebhook] Subscription update for ${shopDomain}:`, app_subscription?.status);

        if (app_subscription && app_subscription.status === 'ACTIVE') {
            // Find the handle (id) from the plan name or via a more robust mapping
            // In Managed Billing, the plans names are usually what we set in the dashboard.
            // We'll try to match the handle from the subscription name or metadata if available.
            // Shopify doesn't always send the 'handle' directly in the webhook payload, 
            // but the name usually contains it (e.g., "Starter Plan").

            const subscriptionName = app_subscription.name.toLowerCase();
            let matchedPlanId = 'free';
            if (subscriptionName.includes('starter')) matchedPlanId = 'starter';
            else if (subscriptionName.includes('growth')) matchedPlanId = 'growth';
            else if (subscriptionName.includes('professional')) matchedPlanId = 'professional';
            else if (subscriptionName.includes('pro')) matchedPlanId = 'professional';
            else if (subscriptionName.includes('trial')) matchedPlanId = 'trial';

            console.log(`[ShopifyWebhook] Activating plan '${matchedPlanId}' for ${shopDomain}`);

            await Merchant.findOneAndUpdate(
                { shopDomain },
                {
                    plan: matchedPlanId,
                    billingStatus: 'active',
                    shopifySubscriptionId: app_subscription.admin_graphql_api_id
                }
            );
        } else if (app_subscription && ['CANCELLED', 'DECLINED', 'EXPIRED', 'FROZEN'].includes(app_subscription.status)) {
            console.log(`[ShopifyWebhook] Subscription ${app_subscription.status} for ${shopDomain}. Reverting to free.`);
            await Merchant.findOneAndUpdate(
                { shopDomain },
                {
                    plan: 'free',
                    billingStatus: 'none',
                    shopifySubscriptionId: null
                }
            );
        }
    } else if (topic === "checkouts/create") {
        console.log(`[ShopifyWebhook] Checkout created for ${shopDomain}.`);
        // Optional: Trigger abandoned cart logic here or via checkouts/abandoned
    }

    res.status(200).send("ok");
});

/**
 * MANDATORY GDPR WEBHOOKS
 * Required for Shopify App Store Compliance
 */

// 1. Customers Data Request (GDPR)
router.post("/gdpr/customers_data_request", verifyShopifyWebhook, async (req, res) => {
    console.log(`[GDPR] Customer Data Request received for shop: ${req.headers["x-shopify-shop-domain"]}`);
    // No sensitive data is stored long-term in this app outside of order logs. 
    // Usually, you respond with 200 and handle the request asynchronously if needed.
    res.status(200).send("ok");
});

// 2. Customers Redact (GDPR)
router.post("/gdpr/customers_redact", verifyShopifyWebhook, async (req, res) => {
    const { customer, shop_domain } = req.body;
    console.log(`[GDPR] Customer Redact requested for ${customer?.email} on ${shop_domain}`);

    try {
        if (customer?.phone) {
            const formattedPhone = customer.phone.replace(/\D/g, '');
            // Optional: Remove specific customer from contacts if your DB has them
            await Contact.deleteMany({ phone: { $regex: new RegExp(formattedPhone) } });
            await ActivityLog.deleteMany({ customerPhone: { $regex: new RegExp(formattedPhone) } });
            console.log(`[GDPR] Deleted data for customer: ${customer.email}`);
        }
    } catch (err) {
        console.error(`[GDPR] Redact failed:`, err);
    }

    res.status(200).send("ok");
});

// 3. Shop Redact (GDPR)
router.post("/gdpr/shop_redact", verifyShopifyWebhook, async (req, res) => {
    const { shop_domain } = req.body;
    console.log(`[GDPR] Shop Redact requested for ${shop_domain}. (Wait 48h as per policy)`);

    const merchantToDelete = await Merchant.findOne({ shopDomain: shop_domain });
    if (merchantToDelete) {
        await Promise.all([
            Merchant.deleteOne({ _id: merchantToDelete._id }),
            ActivityLog.deleteMany({ merchant: merchantToDelete._id }),
            AutomationSetting.deleteMany({ shopDomain: shop_domain }),
            Template.deleteMany({ merchant: merchantToDelete._id }),
            Contact.deleteMany({ merchant: merchantToDelete._id }),
            NotificationSettings.deleteMany({ merchant: merchantToDelete._id }),
            WhatsAppAuth.deleteMany({ shopDomain: shop_domain }),
            WhatsAppSession.deleteMany({ shopDomain: shop_domain }),
            AutomationStat.deleteMany({ shopDomain: shop_domain }),
            Campaign.deleteMany({ shopDomain: shop_domain }),
            ChatButtonSettings.deleteMany({ shopDomain: shop_domain }),
            PollMessage.deleteMany({ shopDomain: shop_domain })
        ]);
    }
    res.status(200).send("ok");
});

export default router;
