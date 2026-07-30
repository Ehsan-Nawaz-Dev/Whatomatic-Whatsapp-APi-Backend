import { Router } from "express";
import { whatsappCloudService } from "../services/whatsappCloudService.js";
import { Merchant } from "../models/Merchant.js";
import { WhatsAppSession } from "../models/WhatsAppSession.js";
import { Plan } from "../models/Plan.js";
import { checkAndResetBillingCycle } from "../services/billingService.js";

const router = Router();

// Helper to get shop domain
const getShopDomain = (req) => {
    if (req.shopifyShop) return req.shopifyShop;
    const shop = req.query.shop || req.headers["x-shop-domain"];
    if (!shop) return null;
    return shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
};

// GET /api/whatsapp/config - Meta App configuration for the Embedded Signup widget.
// Served from configuration only; hardcoded IDs meant a misconfigured deploy pointed
// merchants at a different Meta app instead of surfacing the problem.
router.get("/config", (req, res) => {
    const { appId, configId } = whatsappCloudService.getAppConfig();

    if (!appId || !configId) {
        console.error("[WhatsApp Config] META_APP_ID / META_CONFIG_ID are not configured.");
        return res.status(503).json({
            metaAppId: "",
            metaConfigId: "",
            error: "WhatsApp signup is not configured on this server. Please contact support."
        });
    }

    res.json({ metaAppId: appId, metaConfigId: configId });
});

// GET /api/whatsapp/status - Get connection status
router.get("/status", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const merchant = await Merchant.findOne({ shopDomain });
        const session = await WhatsAppSession.findOne({ shopDomain });

        if (!merchant || !merchant.metaPhoneNumberId || !merchant.metaAccessToken) {
            return res.json({
                connected: false,
                phoneNumber: "",
                deviceName: "Meta Cloud API",
                status: "disconnected"
            });
        }

        // Verify credentials with Meta live
        const verifyRes = await whatsappCloudService.verifyCredentials(
            merchant.metaPhoneNumberId,
            merchant.metaAccessToken
        );

        if (verifyRes.success) {
            const displayPhone = verifyRes.data.display_phone_number || merchant.metaPhoneDisplay || merchant.whatsappNumber;
            const qualityRating = verifyRes.data.quality_rating;

            // Update session record
            await WhatsAppSession.findOneAndUpdate(
                { shopDomain },
                {
                    shopDomain,
                    metaPhoneNumberId: merchant.metaPhoneNumberId,
                    metaWabaId: merchant.metaWabaId,
                    phoneNumber: displayPhone,
                    displayPhoneNumber: displayPhone,
                    qualityRating: qualityRating,
                    isConnected: true,
                    status: "connected",
                    lastVerifiedAt: new Date(),
                    errorMessage: null
                },
                { upsert: true, new: true }
            );

            // platform_type CLOUD_API means the number is registered for messaging.
            // Without registration, sends fail with "(#133010) Account not registered".
            const registered = merchant.metaRegistered || verifyRes.data.platform_type === "CLOUD_API";

            return res.json({
                connected: true,
                phoneNumber: displayPhone,
                deviceName: "Meta Cloud API",
                status: "connected",
                qualityRating: qualityRating,
                registered
            });
        }

        // Verification failed. Only a genuinely dead token (expired/revoked) means the
        // merchant is disconnected — a Graph timeout or 5xx must not tear down a
        // working connection, which is what made connections "auto close" at random.
        if (!verifyRes.authError) {
            console.warn(`[WhatsApp Status] Transient Meta verification failure for ${shopDomain}: ${verifyRes.error}. Reporting last-known-good state.`);
            return res.json({
                connected: session?.isConnected !== false,
                phoneNumber: merchant.metaPhoneDisplay || session?.displayPhoneNumber || "",
                deviceName: "Meta Cloud API",
                status: session?.isConnected !== false ? "connected" : "disconnected",
                qualityRating: session?.qualityRating,
                degraded: true,
                errorMessage: null
            });
        }

        // Token really is dead — the merchant must reconnect.
        await WhatsAppSession.findOneAndUpdate(
            { shopDomain },
            { isConnected: false, status: "error", errorMessage: verifyRes.error },
            { upsert: true }
        );

        return res.json({
            connected: false,
            phoneNumber: merchant.metaPhoneDisplay || "",
            deviceName: "Meta Cloud API",
            status: "error",
            errorMessage: `${verifyRes.error} — please reconnect your WhatsApp Business account.`,
            requiresReconnect: true
        });
    } catch (err) {
        console.error("Error fetching Meta WhatsApp status", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /api/whatsapp/register - Register an already-connected number for Cloud API messaging
// Recovery path for merchants who connected before registration was wired in and are
// hitting "(#133010) Account not registered" on every send.
router.post("/register", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const merchant = await Merchant.findOne({ shopDomain });
        if (!merchant?.metaPhoneNumberId || !merchant?.metaAccessToken) {
            return res.status(400).json({ error: "No Meta WhatsApp account is connected for this shop" });
        }

        const pin = req.body?.pin || merchant.metaRegistrationPin;
        const regRes = await whatsappCloudService.registerPhoneNumber(
            merchant.metaPhoneNumberId,
            merchant.metaAccessToken,
            pin
        );

        if (!regRes.success) {
            return res.status(400).json({
                success: false,
                error: regRes.error,
                needsPin: !!regRes.needsPin
            });
        }

        await Merchant.updateOne(
            { shopDomain },
            { $set: { metaRegistered: true, metaRegisteredAt: new Date(), metaRegistrationPin: regRes.pin } }
        );

        res.json({
            success: true,
            alreadyRegistered: !!regRes.alreadyRegistered,
            message: regRes.alreadyRegistered
                ? "This number was already registered for Cloud API messaging."
                : "WhatsApp number registered for Cloud API messaging. Messages can now be sent."
        });
    } catch (err) {
        console.error("Error registering Meta phone number", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});

// POST /api/whatsapp/credentials - Save Meta credentials for merchant
router.post("/credentials", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const { metaPhoneNumberId, metaWabaId, metaAccessToken, metaWebhookVerifyToken } = req.body;

        if (!metaPhoneNumberId || !metaAccessToken) {
            return res.status(400).json({ error: "metaPhoneNumberId and metaAccessToken are required" });
        }

        // Verify credentials with Meta API before saving
        const verifyRes = await whatsappCloudService.verifyCredentials(metaPhoneNumberId, metaAccessToken);
        if (!verifyRes.success) {
            return res.status(400).json({
                success: false,
                error: `Meta Verification Failed: ${verifyRes.error}`
            });
        }

        const displayPhone = verifyRes.data.display_phone_number;

        // Register for Cloud API messaging (see embedded-signup) — without it sends
        // fail with "(#133010) Account not registered".
        const regRes = await whatsappCloudService.registerPhoneNumber(metaPhoneNumberId, metaAccessToken, req.body.registrationPin);
        if (!regRes.success) {
            console.warn(`[Credentials] Phone registration notice for ${shopDomain}: ${regRes.error}`);
        }

        // Save to Merchant DB
        const updatedMerchant = await Merchant.findOneAndUpdate(
            { shopDomain },
            {
                $set: {
                    metaPhoneNumberId,
                    metaWabaId,
                    metaAccessToken,
                    metaWebhookVerifyToken: metaWebhookVerifyToken || whatsappCloudService.generateVerifyToken(),
                    metaPhoneDisplay: displayPhone,
                    whatsappNumber: displayPhone,
                    whatsappProvider: "cloud",
                    metaRegistered: !!regRes.success,
                    metaRegisteredAt: regRes.success ? new Date() : null,
                    metaRegistrationPin: regRes.pin || null
                }
            },
            { new: true, upsert: true }
        );

        // Update WhatsAppSession
        await WhatsAppSession.findOneAndUpdate(
            { shopDomain },
            {
                shopDomain,
                metaPhoneNumberId,
                metaWabaId,
                phoneNumber: displayPhone,
                displayPhoneNumber: displayPhone,
                qualityRating: verifyRes.data.quality_rating,
                isConnected: true,
                status: "connected",
                lastVerifiedAt: new Date()
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: "Meta WhatsApp Cloud API credentials saved & verified successfully!",
            displayPhoneNumber: displayPhone,
            merchant: updatedMerchant
        });
    } catch (err) {
        console.error("Error saving Meta credentials", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});

// POST /api/whatsapp/embedded-signup - 1-Click Meta Embedded Signup callback
router.post("/embedded-signup", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const { code, wabaId, phoneNumberId, accessToken: directAccessToken, redirectUri } = req.body;

        // ALWAYS prefer exchanging the authorization code.
        //
        // The frontend sends both `code` and `accessToken`. The `accessToken` from
        // FB.login is a SHORT-LIVED browser token (~1-2h) - storing it is why merchant
        // connections "auto closed" a couple of hours after a successful signup. Only
        // the code exchange yields the long-lived business token we can keep using.
        let activeAccessToken = null;
        let tokenSource = "none";

        if (code) {
            const tokenRes = await whatsappCloudService.exchangeEmbeddedCode(code, redirectUri);
            if (tokenRes.success) {
                activeAccessToken = tokenRes.accessToken;
                tokenSource = "code_exchange";
            } else {
                console.warn("[Embedded Signup] Token exchange failed:", tokenRes.error);
            }
        }

        // Fall back to the short-lived browser token only if the exchange failed.
        // It still works right now, and the long-lived upgrade below usually rescues it.
        if (!activeAccessToken && directAccessToken) {
            console.warn("[Embedded Signup] Falling back to the short-lived FB.login token. Check META_APP_ID / META_APP_SECRET - this token will expire.");
            activeAccessToken = directAccessToken;
            tokenSource = "fb_login_short_lived";
        }

        // Deliberately no shared-env-token fallback: handing a merchant the vendor's
        // WHATSAPP_ACCESS_TOKEN makes every such merchant send through one number and
        // makes them all disconnect together when that token expires.
        if (!activeAccessToken) {
            return res.status(400).json({
                error: "Could not obtain a Meta access token from the signup flow. Please try connecting again."
            });
        }

        // Upgrade to a long-lived token (~60 days, often non-expiring for business
        // integrations) so the connection survives past the browser session.
        let tokenExpiresAt = null;
        const longLived = await whatsappCloudService.getLongLivedToken(activeAccessToken);
        if (longLived.success) {
            activeAccessToken = longLived.accessToken;
            tokenExpiresAt = longLived.expiresAt;
            tokenSource += "+long_lived";
        }

        console.log(`[Embedded Signup] Token resolved for ${shopDomain} via: ${tokenSource}`);

        let resolvedPhoneId = phoneNumberId;
        let resolvedWabaId = wabaId;

        // Auto-discover WABA & Phone Number IDs from Meta Graph API if not passed by frontend
        if (!resolvedPhoneId || !resolvedWabaId) {
            const discovered = await whatsappCloudService.autoDiscoverWabaCredentials(activeAccessToken);
            if (!resolvedPhoneId && discovered.phoneNumberId) resolvedPhoneId = discovered.phoneNumberId;
            if (!resolvedWabaId && discovered.wabaId) resolvedWabaId = discovered.wabaId;
        }

        // No environment fallback here on purpose. Attaching the vendor's own
        // WHATSAPP_PHONE_NUMBER_ID to a merchant who failed discovery would make that
        // merchant send from - and receive replies on - a number they do not own.
        if (!resolvedPhoneId || resolvedPhoneId === "undefined") {
            return res.status(400).json({
                error: "Could not locate a WhatsApp phone number on your Meta account. Please add and verify a phone number in Meta WhatsApp Manager, then connect again."
            });
        }

        const verifyRes = await whatsappCloudService.verifyCredentials(resolvedPhoneId, activeAccessToken);
        if (!verifyRes.success) {
            return res.status(400).json({
                error: `Meta Phone Number Verification Failed: ${verifyRes.error}`
            });
        }

        const displayPhone = verifyRes.data?.display_phone_number || "Connected Meta Phone";

        if (resolvedWabaId) {
            await whatsappCloudService.subscribeWabaWebhooks(resolvedWabaId, activeAccessToken);
        }

        // Register the number for Cloud API messaging. Embedded Signup attaches the
        // number to the WABA but does not register it, so without this every send
        // fails with "(#133010) Account not registered".
        const regRes = await whatsappCloudService.registerPhoneNumber(resolvedPhoneId, activeAccessToken);
        if (!regRes.success) {
            console.warn(`[Embedded Signup] Phone registration notice for ${shopDomain}: ${regRes.error}`);
        }

        const updatedMerchant = await Merchant.findOneAndUpdate(
            { shopDomain },
            {
                $set: {
                    metaPhoneNumberId: resolvedPhoneId,
                    metaWabaId: resolvedWabaId,
                    metaAccessToken: activeAccessToken,
                    metaTokenExpiresAt: tokenExpiresAt,
                    metaWebhookVerifyToken: whatsappCloudService.generateVerifyToken(),
                    metaPhoneDisplay: displayPhone,
                    whatsappNumber: displayPhone,
                    whatsappProvider: "cloud",
                    metaRegistered: !!regRes.success,
                    metaRegisteredAt: regRes.success ? new Date() : null,
                    metaRegistrationPin: regRes.pin || null
                }
            },
            { new: true, upsert: true }
        );

        await WhatsAppSession.findOneAndUpdate(
            { shopDomain },
            {
                shopDomain,
                metaPhoneNumberId: resolvedPhoneId,
                metaWabaId: resolvedWabaId,
                phoneNumber: displayPhone,
                displayPhoneNumber: displayPhone,
                qualityRating: verifyRes.data?.quality_rating || "GREEN",
                isConnected: true,
                status: "connected",
                lastVerifiedAt: new Date()
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: "1-Click Meta WhatsApp Business Account connected successfully!",
            displayPhoneNumber: displayPhone,
            merchant: updatedMerchant
        });
    } catch (err) {
        console.error("Error in Embedded Signup callback", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});

// POST /api/whatsapp/register - Register phone number with Meta for Cloud API messaging
router.post("/register", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ success: false, error: "Missing shop parameter" });

        const merchant = await Merchant.findOne({ shopDomain });
        if (!merchant || !merchant.metaPhoneNumberId || !merchant.metaAccessToken) {
            return res.status(400).json({ success: false, error: "Meta WhatsApp credentials not found" });
        }

        const pin = req.body?.pin || merchant.metaRegistrationPin;
        const regRes = await whatsappCloudService.registerPhoneNumber(merchant.metaPhoneNumberId, merchant.metaAccessToken, pin);

        if (regRes.success) {
            await Merchant.updateOne(
                { shopDomain },
                { $set: { metaRegistered: true, metaRegisteredAt: new Date(), metaRegistrationPin: regRes.pin } }
            );
            return res.json({
                success: true,
                message: "WhatsApp phone number registered successfully for Cloud API messaging!"
            });
        }

        if (regRes.error && regRes.error.includes("SMB")) {
            return res.status(400).json({
                success: false,
                error: "Your number is an SMB WhatsApp account. Open Meta WhatsApp Manager (business.facebook.com) -> Phone Numbers and click 'Verify' to receive your 6-digit SMS verification code."
            });
        }

        res.status(400).json({
            success: false,
            error: regRes.error || "Phone registration failed"
        });
    } catch (err) {
        console.error("Error registering phone number:", err);
        res.status(500).json({ success: false, error: err.message || "Internal server error" });
    }
});

// POST /api/whatsapp/disconnect - Disconnect / Remove Meta credentials
router.post("/disconnect", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        await Merchant.findOneAndUpdate(
            { shopDomain },
            {
                $unset: {
                    metaPhoneNumberId: "",
                    metaWabaId: "",
                    metaAccessToken: "",
                    metaWebhookVerifyToken: "",
                    metaPhoneDisplay: ""
                }
            }
        );

        await WhatsAppSession.findOneAndUpdate(
            { shopDomain },
            {
                isConnected: false,
                status: "disconnected",
                errorMessage: "Disconnected by user"
            }
        );

        res.json({
            success: true,
            message: "Meta WhatsApp API credentials removed successfully"
        });
    } catch (err) {
        console.error("Error disconnecting WhatsApp", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /api/whatsapp/send - Send a message via Meta Cloud API
router.post("/send", async (req, res) => {
    try {
        const shopDomain = getShopDomain(req);
        if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

        const { phoneNumber, message, isPoll, pollOptions, templateName, languageCode, components } = req.body;

        if (!phoneNumber || (!message && !templateName)) {
            return res.status(400).json({ error: "Missing phoneNumber and message/templateName" });
        }

        let merchant = await Merchant.findOne({ shopDomain });
        if (merchant) {
            merchant = await checkAndResetBillingCycle(merchant);
            if (merchant.plan === 'trial') {
                if (merchant.trialUsage >= (merchant.trialLimit || 10)) {
                    return res.status(403).json({
                        success: false,
                        error: "Trial limit reached (10 messages max). Please upgrade to a paid plan."
                    });
                }
            } else {
                const planConfig = await Plan.findOne({ id: merchant.plan || 'free' });
                const baseLimit = planConfig ? planConfig.messageLimit : 10;
                const currentLimit = baseLimit + Math.max(0, (merchant.trialLimit || 10) - 10);
                const currentUsage = merchant.usage || 0;
                if (currentUsage >= currentLimit) {
                    if (merchant.shopifyUsageLineItemId && merchant.plan !== 'professional') {
                        console.log(`[WhatsApp] Auto-upgrade allowance for ${shopDomain}. Limit was ${currentLimit}.`);
                    } else {
                        return res.status(403).json({
                            success: false,
                            error: `Plan limit reached (${currentLimit} messages max). Please upgrade to a paid plan.`
                        });
                    }
                }
            }
        }

        let result;
        if (templateName) {
            result = await whatsappCloudService.sendTemplateMessage(shopDomain, phoneNumber, templateName, languageCode || "en", components || []);
        } else if (isPoll && pollOptions?.length > 0) {
            const buttons = pollOptions.map((opt, idx) => ({ id: `opt_${idx}`, title: opt }));
            result = await whatsappCloudService.sendInteractiveButtonsMessage(shopDomain, phoneNumber, message, buttons);
        } else {
            result = await whatsappCloudService.sendTextMessage(shopDomain, phoneNumber, message);
        }

        if (result.success) {
            if (merchant) {
                if (merchant.plan === 'trial') {
                    await Merchant.findOneAndUpdate({ shopDomain }, { $inc: { trialUsage: 1 } });
                } else {
                    const updatedMerchant = await Merchant.findOneAndUpdate({ shopDomain }, { $inc: { usage: 1 } }, { new: true });
                    import('../services/billingService.js').then(({ checkAndChargeUsage }) => {
                        checkAndChargeUsage(updatedMerchant);
                    }).catch(err => console.error("Billing service error:", err));
                }
            }

            res.json({
                success: true,
                messageId: result.messageId,
                message: "Message sent successfully via Meta Cloud API"
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                details: result.details
            });
        }
    } catch (err) {
        console.error("Error sending WhatsApp message", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
