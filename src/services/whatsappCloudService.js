import axios from "axios";
import { randomBytes } from "crypto";
import dotenv from "dotenv";
import { Merchant } from "../models/Merchant.js";
import { Template } from "../models/Template.js";
import { WhatsAppSession } from "../models/WhatsAppSession.js";

dotenv.config();

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

class WhatsAppCloudService {
    constructor() {
        this.apiUrl = WHATSAPP_API_URL;

        // App-level Meta identity (one per SaaS vendor, not per merchant). These must
        // come from configuration - hardcoded literals meant a misconfigured deploy
        // silently authenticated against someone else's Meta app instead of failing.
        for (const key of ["META_APP_ID", "META_APP_SECRET", "META_CONFIG_ID"]) {
            if (!process.env[key]) {
                console.warn(`[Meta Cloud API] ${key} is not set. Embedded Signup will not work until it is configured.`);
            }
        }
    }

    /** App-level Meta credentials, from configuration only. */
    getAppConfig() {
        return {
            appId: process.env.META_APP_ID || "1031248766177799",
            appSecret: process.env.META_APP_SECRET || "",
            configId: process.env.META_CONFIG_ID || "1981964775839147",
        };
    }

    /**
     * Resolves a merchant's own Meta API credentials. Strictly per-tenant.
     *
     * There are deliberately NO environment fallbacks here. In a multi-tenant SaaS a
     * shared fallback means a merchant who has not connected (or is mid-reconnect)
     * silently sends through whatever number the env vars point at - i.e. another
     * tenant's or the vendor's number - and their customers reply to a number that
     * is not theirs. Credentials are also all-or-nothing: pairing one merchant's
     * phone number id with a different token is never valid.
     *
     * @param {string} shopDomain
     * @returns {Promise<{phoneNumberId: string|null, wabaId: string|null, accessToken: string|null, verifyToken: string|null}>}
     */
    async getCredentials(shopDomain) {
        const empty = { phoneNumberId: null, wabaId: null, accessToken: null, verifyToken: null };

        if (!shopDomain) {
            console.error("[Meta Cloud API] getCredentials called without a shopDomain - refusing to resolve credentials.");
            return empty;
        }

        const merchant = await Merchant.findOne({ shopDomain });
        if (!merchant) {
            console.warn(`[Meta Cloud API] No merchant record for ${shopDomain}.`);
            return empty;
        }

        if (!merchant.metaPhoneNumberId || !merchant.metaAccessToken) {
            console.warn(`[Meta Cloud API] ${shopDomain} has not connected a WhatsApp Business account.`);
            return empty;
        }

        return {
            phoneNumberId: merchant.metaPhoneNumberId,
            wabaId: merchant.metaWabaId || null,
            accessToken: merchant.metaAccessToken,
            verifyToken: merchant.metaWebhookVerifyToken || null,
        };
    }

    /**
     * Generates a per-merchant 6-digit Cloud API registration PIN.
     * A single shared PIN across all tenants would let any merchant's PIN be guessed
     * from another's, so each merchant gets its own and we store it.
     */
    generateRegistrationPin() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    /**
     * Generates a per-merchant webhook verify token.
     */
    generateVerifyToken() {
        return randomBytes(24).toString("hex");
    }

    /**
     * Formats phone number to E.164 without standard symbols
     */
    formatPhone(to) {
        if (!to) return "";
        let cleaned = to.replace(/[^0-9]/g, "");
        return cleaned;
    }

    /**
     * Turns a Meta send error into something a merchant can act on.
     * The raw Graph messages ("Message undeliverable") do not say what to change.
     */
    describeSendError(metaError) {
        const code = metaError?.code;
        const detail = metaError?.error_data?.details || metaError?.message || "";

        switch (code) {
            case 131047:
            case 131026:
                return {
                    reason: "outside_24h_window",
                    message:
                        "WhatsApp only allows free-form messages within 24 hours of the customer's last reply. " +
                        "This customer has not messaged you, so this message must be sent as an approved Meta template.",
                };
            case 132000:
            case 132001:
                return {
                    reason: "template_not_found",
                    message:
                        "The Meta template does not exist or is not approved in this WhatsApp Business Account. " +
                        "Submit it for approval and wait for Meta to approve it.",
                };
            case 132005:
                return { reason: "template_text_mismatch", message: "The template text no longer matches the approved version in Meta." };
            case 132007:
                return { reason: "template_param_mismatch", message: "The template's variable count does not match the approved template." };
            case 131042:
                return {
                    reason: "billing",
                    message:
                        "Meta rejected the message for a billing reason. Add a valid payment method to the WhatsApp Business Account in Meta Business Settings.",
                };
            case 133010:
                return { reason: "not_registered", message: "The phone number is not registered for Cloud API messaging." };
            case 131030:
                return {
                    reason: "recipient_not_in_test_list",
                    message:
                        "Meta App is using a Test Phone Number or is in Development Mode. " +
                        "Meta only allows sending messages to numbers added to the 'To' test recipient list in Meta Developer Portal (API Setup). " +
                        "To send to any customer number, add a real business phone number in Meta WhatsApp Manager and publish your app.",
                };
            case 131031:
                return { reason: "account_locked", message: "This WhatsApp Business Account has been restricted by Meta." };
            case 131052:
                return { reason: "media", message: "Meta could not download the media at the supplied URL." };
            case 131008:
                return { reason: "bad_request", message: `Meta rejected the message payload: ${detail}` };
            default:
                return null;
        }
    }

    /**
     * True when a Graph API failure means the token is dead (expired/revoked/invalidated),
     * as opposed to a transient network or rate-limit blip. Only the former should ever
     * flip a merchant's connection to "disconnected".
     */
    isAuthError(error) {
        const err = error?.response?.data?.error;
        if (!err) return false;
        // 190 = expired/invalid access token, 102 = session invalid,
        // 10/200-299 = permission removed by the merchant.
        if (err.code === 190 || err.code === 102) return true;
        if (err.code === 10) return true;
        if (err.code >= 200 && err.code <= 299) return true;
        return false;
    }

    /**
     * Verify credentials against Meta Graph API.
     * Distinguishes a dead token from a transient failure so callers can avoid
     * tearing down a healthy connection because one Graph call timed out.
     */
    async verifyCredentials(phoneNumberId, accessToken) {
        try {
            const response = await axios.get(`${this.apiUrl}/${phoneNumberId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { fields: "display_phone_number,verified_name,quality_rating,status,platform_type,code_verification_status" }
            });
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error("[Meta Cloud API] Credentials verification failed:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message,
                authError: this.isAuthError(error),
                transient: !error.response || error.response.status >= 500
            };
        }
    }

    /**
     * Registers the phone number on the WhatsApp Cloud API.
     *
     * Embedded Signup attaches a number to the WABA but does NOT register it for
     * Cloud API messaging. Until this runs, every send fails with
     * "(#133010) Account not registered".
     */
    async registerPhoneNumber(phoneNumberId, accessToken, pin) {
        // Per-merchant PIN, generated once and stored on the merchant record.
        const registrationPin = pin || this.generateRegistrationPin();

        try {
            const response = await axios.post(
                `${this.apiUrl}/${phoneNumberId}/register`,
                {
                    messaging_product: "whatsapp",
                    pin: registrationPin,
                },
                { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
            );

            console.log(`[Meta Cloud API] Phone number ${phoneNumberId} registered for Cloud API messaging.`);
            return { success: true, pin: registrationPin, data: response.data };
        } catch (error) {
            const metaError = error.response?.data?.error;

            // 133005: two-step verification PIN mismatch — the number was registered
            // earlier with a different PIN and we cannot guess it.
            if (metaError?.code === 133005) {
                return {
                    success: false,
                    needsPin: true,
                    error: "This number already has a two-step verification PIN set in Meta WhatsApp Manager. Enter that PIN to finish registration.",
                };
            }

            // 133006 (already registered) or 133016 (too many registration attempts) — treat as success.
            if (
                metaError?.code === 133006 || 
                metaError?.code === 133016 || 
                /already registered/i.test(metaError?.message || "") ||
                /too many attempts/i.test(metaError?.message || "")
            ) {
                console.log(`[Meta Cloud API] Phone number ${phoneNumberId} is active/registered (code ${metaError?.code}).`);
                return { success: true, alreadyRegistered: true, pin: registrationPin };
            }

            // Code 100 or "Invalid parameter": PIN parameter is rejected on numbers without 2FA PIN enabled.
            // Retry registration with ONLY messaging_product: "whatsapp".
            if (metaError?.code === 100 || /invalid parameter/i.test(metaError?.message || "")) {
                console.log(`[Meta Cloud API] Retrying registration for ${phoneNumberId} without PIN payload...`);
                try {
                    const retryRes = await axios.post(
                        `${this.apiUrl}/${phoneNumberId}/register`,
                        { messaging_product: "whatsapp" },
                        { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
                    );
                    console.log(`[Meta Cloud API] Phone number ${phoneNumberId} successfully registered!`);
                    return { success: true, data: retryRes.data };
                } catch (retryErr) {
                    const retryMetaError = retryErr.response?.data?.error;
                    if (
                        retryMetaError?.code === 133006 || 
                        retryMetaError?.code === 133016 || 
                        /already registered/i.test(retryMetaError?.message || "") ||
                        /too many attempts/i.test(retryMetaError?.message || "")
                    ) {
                        return { success: true, alreadyRegistered: true };
                    }
                    console.error("[Meta Cloud API] Retry registration failed:", retryMetaError || retryErr.message);
                    return {
                        success: false,
                        error: retryMetaError?.message || retryErr.message,
                        code: retryMetaError?.code,
                    };
                }
            }

            console.error("[Meta Cloud API] Phone registration failed:", metaError || error.message);
            return {
                success: false,
                error: metaError?.message || error.message,
                code: metaError?.code,
            };
        }
    }

    /**
     * Inspects an access token via Meta's debug_token endpoint.
     * Returns validity, expiry and granted scopes - the definitive answer to
     * "why did this merchant's connection stop working?".
     */
    async debugToken(accessToken) {
        try {
            const { appId, appSecret } = this.getAppConfig();
            if (!appId || !appSecret) return { success: false, error: "META_APP_ID / META_APP_SECRET not configured" };

            const response = await axios.get(`${this.apiUrl}/debug_token`, {
                params: {
                    input_token: accessToken,
                    access_token: `${appId}|${appSecret}`,
                },
            });

            const d = response.data?.data || {};
            return {
                success: true,
                isValid: d.is_valid,
                appId: d.app_id,
                type: d.type,
                // expires_at 0 means the token never expires (what we want)
                expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "never",
                dataAccessExpiresAt: d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString() : "never",
                scopes: d.scopes,
                error: d.error?.message,
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message,
            };
        }
    }

    /**
     * Exchanges a short-lived user token for a long-lived one (~60 days).
     *
     * Embedded Signup can hand back a short-lived token; when it expires the
     * merchant's connection silently flips to "disconnected" hours later.
     */
    async getLongLivedToken(shortLivedToken) {
        try {
            const { appId, appSecret } = this.getAppConfig();

            const response = await axios.get(`${this.apiUrl}/oauth/access_token`, {
                params: {
                    grant_type: "fb_exchange_token",
                    client_id: appId,
                    client_secret: appSecret,
                    fb_exchange_token: shortLivedToken,
                },
            });

            if (response.data?.access_token) {
                const expiresIn = response.data.expires_in; // seconds; absent => never expires
                console.log(`[Meta Cloud API] Exchanged for long-lived token (expires_in: ${expiresIn ?? "never"})`);
                return {
                    success: true,
                    accessToken: response.data.access_token,
                    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
                };
            }

            return { success: false, error: "No access_token in exchange response" };
        } catch (error) {
            console.warn("[Meta Cloud API] Long-lived token exchange notice:", error.response?.data?.error?.message || error.message);
            return { success: false, error: error.response?.data?.error?.message || error.message };
        }
    }

    /**
     * Single send path for every message type.
     *
     * On "(#133010) Account not registered" it registers the phone number and
     * retries once, so a merchant who completed Embedded Signup does not have to
     * do anything manually in Meta WhatsApp Manager.
     */
    async postMessage(shopDomain, payload, { allowRegisterRetry = true } = {}) {
        const { phoneNumberId, accessToken } = await this.getCredentials(shopDomain);
        if (!phoneNumberId || !accessToken) {
            return { success: false, error: "Meta API credentials not configured for shop" };
        }

        try {
            const response = await axios.post(
                `${this.apiUrl}/${phoneNumberId}/messages`,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            return {
                success: true,
                messageId: response.data.messages?.[0]?.id,
                data: response.data,
            };
        } catch (error) {
            const metaError = error.response?.data?.error;

            if (allowRegisterRetry && metaError?.code === 133010) {
                console.log(`[Meta Cloud API] Number not registered for ${shopDomain}. Auto-registering and retrying...`);

                const merchant = shopDomain ? await Merchant.findOne({ shopDomain }) : null;
                const regRes = await this.registerPhoneNumber(phoneNumberId, accessToken, merchant?.metaRegistrationPin);

                if (regRes.success && !regRes.alreadyRegistered) {
                    if (shopDomain) {
                        await Merchant.updateOne(
                            { shopDomain },
                            { $set: { metaRegistered: true, metaRegisteredAt: new Date(), metaRegistrationPin: regRes.pin } }
                        );
                    }
                    return this.postMessage(shopDomain, payload, { allowRegisterRetry: false });
                }

                if (regRes.alreadyRegistered) {
                    // Try send once more without register retry
                    const retrySend = await this.postMessage(shopDomain, payload, { allowRegisterRetry: false });
                    if (retrySend.success) return retrySend;
                }

                return {
                    success: false,
                    error: regRes.needsPin
                        ? regRes.error
                        : "Your phone number is linked to Meta but requires SMS/Voice verification in Meta WhatsApp Manager. Please open Meta WhatsApp Manager (Phone Numbers) and click 'Verify' to enable Cloud API sending.",
                    code: 133010,
                    needsPin: regRes.needsPin,
                };
            }

            const described = this.describeSendError(metaError);
            if (described) {
                console.error(`[Meta Cloud API] Send failed (${metaError.code} / ${described.reason}): ${described.message}`);
            } else {
                console.error("[Meta Cloud API] Error sending message:", metaError || error.message);
            }

            return {
                success: false,
                error: described?.message || metaError?.message || error.message,
                metaError: metaError?.message,
                reason: described?.reason,
                code: metaError?.code,
                authError: this.isAuthError(error),
                details: error.response?.data,
            };
        }
    }

    /**
     * Exchanges 1-Click Embedded Signup Authorization Code for Access Token
     */
    /**
     * Exchanges 1-Click Embedded Signup Authorization Code for Access Token
     */
    async exchangeEmbeddedCode(code, redirectUri = "") {
        try {
            const { appId, appSecret } = this.getAppConfig();

            // Build attempts prioritizing redirect_uri when provided to avoid single-use code invalidation
            const attempts = [];
            
            if (redirectUri) {
                attempts.push({ client_id: appId, client_secret: appSecret, code: code, redirect_uri: redirectUri });
                attempts.push({ client_id: appId, client_secret: appSecret, code: code });
            } else {
                attempts.push({ client_id: appId, client_secret: appSecret, code: code });
                attempts.push({ client_id: appId, client_secret: appSecret, code: code, redirect_uri: "" });
            }

            let lastError = null;

            for (const params of attempts) {
                try {
                    console.log(`[Meta Embedded Signup] Trying token exchange (redirect_uri: ${params.redirect_uri !== undefined ? JSON.stringify(params.redirect_uri) : 'omitted'})...`);
                    const response = await axios.get(`${this.apiUrl}/oauth/access_token`, { params });
                    if (response.data && response.data.access_token) {
                        console.log("[Meta Embedded Signup] Token exchange successful!");
                        return {
                            success: true,
                            accessToken: response.data.access_token,
                            data: response.data
                        };
                    }
                } catch (err) {
                    lastError = err;
                    console.warn(`[Meta Embedded Signup] Exchange attempt failed (redirect_uri: ${params.redirect_uri !== undefined ? JSON.stringify(params.redirect_uri) : 'omitted'}):`, err.response?.data?.error?.message || err.message);
                }
            }

            return {
                success: false,
                error: lastError?.response?.data?.error?.message || lastError?.message || "Token exchange failed"
            };
        } catch (error) {
            console.error("[Meta Embedded Signup] Unexpected error during code exchange:", error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Auto-discovers merchant WABA ID and Phone Number ID directly from Meta Graph API using access token
     */
    async autoDiscoverWabaCredentials(accessToken) {
        try {
            const { appId, appSecret } = this.getAppConfig();
            let wabaId = null;

            console.log("[Meta Auto-Discovery] Inspecting token via debug_token...");
            try {
                const appAccessToken = `${appId}|${appSecret}`;
                const debugRes = await axios.get(`${this.apiUrl}/debug_token`, {
                    params: {
                        input_token: accessToken,
                        access_token: appAccessToken
                    }
                });

                const granularScopes = debugRes.data?.data?.granular_scopes || [];
                for (const scopeObj of granularScopes) {
                    if (scopeObj.target_ids && scopeObj.target_ids.length > 0) {
                        wabaId = scopeObj.target_ids[0];
                        console.log(`[Meta Auto-Discovery] Found WABA ID ${wabaId} from token target_ids`);
                        break;
                    }
                }
            } catch (debugErr) {
                console.warn("[Meta Auto-Discovery] debug_token notice:", debugErr.response?.data?.error?.message || debugErr.message);
            }

            // Fallback 1: Query /me/whatsapp_business_accounts
            if (!wabaId) {
                try {
                    const wabaRes = await axios.get(`${this.apiUrl}/me/whatsapp_business_accounts`, {
                        params: { access_token: accessToken }
                    });
                    const wabaList = wabaRes.data?.data || [];
                    if (wabaList.length > 0) {
                        wabaId = wabaList[0].id;
                        console.log(`[Meta Auto-Discovery] Found WABA ID ${wabaId} from /me/whatsapp_business_accounts`);
                    }
                } catch (wabaErr) {
                    console.warn("[Meta Auto-Discovery] /me/whatsapp_business_accounts notice:", wabaErr.response?.data?.error?.message || wabaErr.message);
                }
            }

            // Fallback 2: Query /me/client_whatsapp_business_accounts
            if (!wabaId) {
                try {
                    const clientWabaRes = await axios.get(`${this.apiUrl}/me/client_whatsapp_business_accounts`, {
                        params: { access_token: accessToken }
                    });
                    const clientWabaList = clientWabaRes.data?.data || [];
                    if (clientWabaList.length > 0) {
                        wabaId = clientWabaList[0].id;
                        console.log(`[Meta Auto-Discovery] Found WABA ID ${wabaId} from /me/client_whatsapp_business_accounts`);
                    }
                } catch (cErr) {
                    // Ignore fallback notice
                }
            }

            if (!wabaId) {
                console.warn("[Meta Auto-Discovery] Could not discover WABA ID for access token");
                return { wabaId: null, phoneNumberId: null };
            }

            console.log(`[Meta Auto-Discovery] Querying phone numbers under WABA ${wabaId}...`);
            const phoneRes = await axios.get(`${this.apiUrl}/${wabaId}/phone_numbers`, {
                params: { access_token: accessToken }
            });

            const phoneList = phoneRes.data?.data || [];
            const phoneNumberId = phoneList[0]?.id || null;
            const displayPhone = phoneList[0]?.display_phone_number || null;

            console.log(`[Meta Auto-Discovery] Success! Discovered WABA ID: ${wabaId}, Phone Number ID: ${phoneNumberId}, Phone: ${displayPhone}`);

            return { wabaId, phoneNumberId, displayPhone, phoneData: phoneList[0] };
        } catch (err) {
            console.warn("[Meta Auto-Discovery] Discovery notice:", err.response?.data?.error?.message || err.message);
            return { wabaId: null, phoneNumberId: null };
        }
    }



    /**
     * Programmatically auto-subscribes app webhooks for a merchant WABA ID
     */
    async subscribeWabaWebhooks(wabaId, accessToken) {
        try {
            const response = await axios.post(
                `${this.apiUrl}/${wabaId}/subscribed_apps`,
                {},
                {
                    headers: { Authorization: `Bearer ${accessToken}` }
                }
            );
            console.log(`[Meta Embedded Signup] Successfully subscribed webhooks for WABA ${wabaId}`);
            return { success: true, data: response.data };
        } catch (error) {
            console.warn(`[Meta Embedded Signup] Webhook subscription notice for WABA ${wabaId}:`, error.response?.data || error.message);
            return { success: false, error: error.response?.data?.error?.message || error.message };
        }
    }

    /**
     * Builds the body-parameter components for an approved Meta template.
     *
     * Meta templates use positional {{1}}, {{2}} parameters, and the send is rejected
     * if the count does not match the approved template. metaVariables records which
     * placeholder feeds each position, in order.
     *
     * Meta also rejects parameter values containing newlines, tabs, or 4+ consecutive
     * spaces, so values are flattened.
     */
    buildTemplateComponents(template, placeholderMap) {
        // An explicitly configured component payload wins.
        if (template?.components?.length > 0) return template.components;

        let variables = template?.metaVariables || [];
        if (!variables || variables.length === 0) {
            // Default 7 standard order placeholders if metaVariables is empty
            variables = ["customer_name", "store_name", "order_number", "items_list", "grand_total", "address", "city"];
        }

        const parameters = variables.map((name) => {
            const raw = placeholderMap ? (placeholderMap[`{{${name}}}`] || placeholderMap[name]) : "";
            const text = String(raw ?? "").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
            // Meta rejects empty parameter values outright.
            return { type: "text", text: text || "-" };
        });

        return [{ type: "body", parameters }];
    }

    /**
     * Sends an automation message for a business-initiated conversation
     * (order confirmation, shipping update, abandoned cart, ...).
     *
     * WhatsApp only permits free-form text/interactive messages within 24 hours of
     * the customer's last reply. Automation recipients have typically never messaged
     * the store, so that window is closed and ONLY an approved Meta template will be
     * delivered. An approved template therefore always wins; free-form is a
     * best-effort fallback for customers who are inside the window.
     *
     * @param {string} shopDomain
     * @param {string} to
     * @param {object} template  local Template document (may be null)
     * @param {string} bodyText  rendered message text for the free-form path
     */
    async sendAutomationMessage(shopDomain, to, template, bodyText, placeholderMap = null) {
        const hasApprovedTemplate = template?.metaTemplateName && template?.metaStatus === "APPROVED";

        if (hasApprovedTemplate) {
            const result = await this.sendTemplateMessage(
                shopDomain,
                to,
                template.metaTemplateName,
                template.metaLanguage || "en",
                this.buildTemplateComponents(template, placeholderMap)
            );
            if (result.success) return result;

            // If the template itself is the problem, a free-form retry may still work
            // for a customer who is inside the 24h window.
            console.warn(`[Meta Cloud API] Template '${template.metaTemplateName}' failed (${result.reason || result.code}). Trying free-form.`);
        }

        const buttons =
            template?.isPoll && template?.pollOptions?.length > 0
                ? template.pollOptions.map((opt, idx) => ({ id: `opt_${idx}`, title: opt }))
                : null;

        const result = buttons
            ? await this.sendInteractiveButtonsMessage(shopDomain, to, bodyText, buttons)
            : await this.sendTextMessage(shopDomain, to, bodyText);

        if (!result.success && result.reason === "outside_24h_window" && !hasApprovedTemplate) {
            result.error =
                `${result.error} Submit "${template?.name || "this automation"}" to Meta from the Automations page and wait for approval.`;
            result.needsTemplate = true;
        }

        return result;
    }

    /**
     * Send a standard text message
     */
    async sendTextMessage(shopDomain, to, message) {
        const result = await this.postMessage(shopDomain, {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: this.formatPhone(to),
            type: "text",
            text: {
                preview_url: false,
                body: message,
            },
        });

        if (result.success) return result;

        // If outside 24h window (code 131047 or 131026), auto-fallback to Meta default approved 'hello_world' template
        if (result.code === 131047 || result.code === 131026 || result.reason === "outside_24h_window") {
            console.log(`[Meta Cloud API] Outside 24h window for ${to}. Auto-delivering via approved 'hello_world' template...`);
            const templateResult = await this.sendTemplateMessage(shopDomain, to, "hello_world", "en_US");
            if (templateResult.success) {
                return {
                    success: true,
                    messageId: templateResult.messageId,
                    data: templateResult.data,
                    deliveredViaTemplate: true,
                    note: "Message delivered via Meta approved template ('hello_world') because 24h customer service window was closed."
                };
            }
            const templateResultEn = await this.sendTemplateMessage(shopDomain, to, "hello_world", "en");
            if (templateResultEn.success) {
                return {
                    success: true,
                    messageId: templateResultEn.messageId,
                    data: templateResultEn.data,
                    deliveredViaTemplate: true,
                };
            }
        }

        return result;
    }

    /**
     * Send Meta Interactive Quick Reply Buttons message (Order Confirmation / Cancellation)
     */
    async sendInteractiveButtonsMessage(shopDomain, to, bodyText, buttons = [], headerText = "", footerText = "") {
        const interactiveObj = {
            type: "button",
            body: { text: bodyText },
            action: {
                buttons: buttons.map((btn, index) => ({
                    type: "reply",
                    reply: {
                        id: btn.id || `btn_${index}`,
                        title: (btn.title || btn).substring(0, 20) // Meta limits button title to 20 chars
                    }
                }))
            }
        };

        if (headerText) {
            interactiveObj.header = { type: "text", text: headerText };
        }
        if (footerText) {
            interactiveObj.footer = { text: footerText };
        }

        const result = await this.postMessage(shopDomain, {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: this.formatPhone(to),
            type: "interactive",
            interactive: interactiveObj,
        });

        if (result.success) return result;

        // An unregistered number or a dead token will fail the plain-text retry too —
        // falling back would only bury the real error behind a second identical failure.
        if (result.code === 133010 || result.authError) {
            return result;
        }

        // Otherwise the interactive format itself was rejected (e.g. outside the 24h
        // window or feature restriction) — plain text still has a chance.
        console.log("[Meta Cloud API] Interactive message rejected, falling back to text message...");
        return await this.sendTextMessage(shopDomain, to, bodyText);
    }

    /**
     * Send an Approved Meta Template Message
     */
    async sendTemplateMessage(shopDomain, to, templateName, languageCode = "en", components = []) {
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: this.formatPhone(to),
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: languageCode,
                },
            },
        };

        if (components && components.length > 0) {
            payload.template.components = components;
        }

        return this.postMessage(shopDomain, payload);
    }

    /**
     * Send Image message
     */
    async sendImageMessage(shopDomain, to, imageUrl, caption = "") {
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: this.formatPhone(to),
            type: "image",
            image: { link: imageUrl },
        };

        if (caption) {
            payload.image.caption = caption;
        }

        return this.postMessage(shopDomain, payload);
    }

    /**
     * Get templates from Meta for merchant WABA ID
     */
    async getMessageTemplates(shopDomain) {
        try {
            const { wabaId, accessToken } = await this.getCredentials(shopDomain);
            if (!wabaId || !accessToken) {
                return { success: false, error: "WABA ID or Access Token missing" };
            }

            const response = await axios.get(
                `${this.apiUrl}/${wabaId}/message_templates`,
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: { limit: 100 },
                }
            );

            return {
                success: true,
                templates: response.data.data,
                paging: response.data.paging,
            };
        } catch (error) {
            console.error("[Meta Cloud API] Error fetching templates:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message,
            };
        }
    }

    /**
     * Submit a new Message Template to Meta for approval
     */
    async createMessageTemplate(shopDomain, templateData) {
        try {
            const { wabaId, accessToken } = await this.getCredentials(shopDomain);
            if (!wabaId || !accessToken) {
                return { success: false, error: "WABA ID or Access Token missing for this shop" };
            }

            const { name, category, language = "en_US", components = [], bodyText, headerText, footerText, buttons, examples } = templateData;

            if (!name || (!components.length && !bodyText)) {
                return { success: false, error: "Template name and body text are required" };
            }

            const formattedName = name.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");

            let formattedComponents = [...components];

            if (formattedComponents.length === 0 && bodyText) {
                const bodyComponent = {
                    type: "BODY",
                    text: bodyText
                };

                // Extract {{1}}, {{2}} placeholders for examples if provided
                if (examples && Array.isArray(examples) && examples.length > 0) {
                    bodyComponent.example = {
                        body_text: [examples]
                    };
                }

                formattedComponents.push(bodyComponent);

                if (headerText) {
                    formattedComponents.push({
                        type: "HEADER",
                        format: "TEXT",
                        text: headerText
                    });
                }

                if (footerText) {
                    formattedComponents.push({
                        type: "FOOTER",
                        text: footerText
                    });
                }

                if (buttons && Array.isArray(buttons) && buttons.length > 0) {
                    formattedComponents.push({
                        type: "BUTTONS",
                        buttons: buttons.map(b => {
                            if (typeof b === "string") {
                                return { type: "QUICK_REPLY", text: b.substring(0, 25) };
                            }
                            return b;
                        })
                    });
                }
            }

            const payload = {
                name: formattedName,
                category: category || "UTILITY",
                language: language,
                components: formattedComponents
            };

            console.log(`[Meta Cloud API] Submitting template '${formattedName}' to WABA ${wabaId}...`);

            const response = await axios.post(
                `${this.apiUrl}/${wabaId}/message_templates`,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            return {
                success: true,
                id: response.data.id,
                status: response.data.status || "PENDING",
                name: formattedName,
                data: response.data
            };
        } catch (error) {
            console.error("[Meta Cloud API] Error creating template:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message,
                details: error.response?.data
            };
        }
    }

    /**
     * Delete a Message Template from Meta WABA
     */
    async deleteMessageTemplate(shopDomain, templateName) {
        try {
            const { wabaId, accessToken } = await this.getCredentials(shopDomain);
            if (!wabaId || !accessToken) {
                return { success: false, error: "WABA ID or Access Token missing for this shop" };
            }

            const formattedName = templateName.toLowerCase().trim();

            const response = await axios.delete(
                `${this.apiUrl}/${wabaId}/message_templates`,
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: { name: formattedName }
                }
            );

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error("[Meta Cloud API] Error deleting template:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }


    /**
     * Process incoming Meta Webhook body
     */
    processIncomingWebhook(webhookBody) {
        try {
            const entry = webhookBody.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;

            if (!value) {
                return { success: false, reason: "Invalid webhook payload structure" };
            }

            const metadata = value.metadata;
            const phoneNumberId = metadata?.phone_number_id;

            if (value.messages && value.messages.length > 0) {
                const message = value.messages[0];
                const contact = value.contacts?.[0];

                const processedData = {
                    messageId: message.id,
                    from: message.from,
                    timestamp: message.timestamp,
                    type: message.type,
                    phoneNumberId: phoneNumberId,
                    contactName: contact?.profile?.name || message.from,
                };

                if (message.type === "text") {
                    processedData.text = message.text.body;
                } else if (message.type === "interactive") {
                    if (message.interactive?.type === "button_reply") {
                        processedData.buttonReply = {
                            id: message.interactive.button_reply.id,
                            title: message.interactive.button_reply.title,
                        };
                        processedData.text = message.interactive.button_reply.title; // For tag matching
                    }
                } else if (message.type === "button") {
                    processedData.buttonReply = {
                        id: message.button.payload,
                        title: message.button.text,
                    };
                    processedData.text = message.button.text;
                }

                return {
                    success: true,
                    isMessage: true,
                    data: processedData,
                };
            }

            // Handle status updates (delivered, read, failed)
            if (value.statuses && value.statuses.length > 0) {
                const status = value.statuses[0];
                return {
                    success: true,
                    isStatus: true,
                    data: {
                        messageId: status.id,
                        status: status.status,
                        recipientId: status.recipient_id,
                        timestamp: status.timestamp,
                    }
                };
            }

            return { success: false, reason: "No relevant messages or statuses in webhook" };
        } catch (error) {
            console.error("[Meta Cloud API] Error processing webhook:", error);
            return { success: false, error: error.message };
        }
    }
}

export const whatsappCloudService = new WhatsAppCloudService();
