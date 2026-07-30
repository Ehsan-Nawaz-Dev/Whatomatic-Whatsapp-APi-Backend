import axios from "axios";
import dotenv from "dotenv";
import { Merchant } from "../models/Merchant.js";
import { Template } from "../models/Template.js";
import { WhatsAppSession } from "../models/WhatsAppSession.js";

dotenv.config();

const WHATSAPP_API_URL = "https://graph.facebook.com/v21.0";

class WhatsAppCloudService {
    constructor() {
        this.apiUrl = WHATSAPP_API_URL;
    }

    /**
     * Resolves Meta API credentials for a given shopDomain or falls back to env defaults
     * @param {string} shopDomain 
     * @returns {Promise<{phoneNumberId: string, wabaId: string, accessToken: string, verifyToken: string}>}
     */
    async getCredentials(shopDomain) {
        let phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        let wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        let accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        let verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

        if (shopDomain) {
            const merchant = await Merchant.findOne({ shopDomain });
            if (merchant) {
                if (merchant.metaPhoneNumberId) phoneNumberId = merchant.metaPhoneNumberId;
                if (merchant.metaWabaId) wabaId = merchant.metaWabaId;
                if (merchant.metaAccessToken) accessToken = merchant.metaAccessToken;
                if (merchant.metaWebhookVerifyToken) verifyToken = merchant.metaWebhookVerifyToken;
            }
        }

        return { phoneNumberId, wabaId, accessToken, verifyToken };
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
     * Verify credentials against Meta Graph API
     */
    async verifyCredentials(phoneNumberId, accessToken) {
        try {
            const response = await axios.get(`${this.apiUrl}/${phoneNumberId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { fields: "display_phone_number,verified_name,quality_rating,status" }
            });
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            console.error("[Meta Cloud API] Credentials verification failed:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }

    /**
     * Exchanges 1-Click Embedded Signup Authorization Code for Access Token
     */
    async exchangeEmbeddedCode(code, redirectUri = "") {
        try {
            const appId = process.env.META_APP_ID || "1031248766177799";
            const appSecret = process.env.META_APP_SECRET || process.env.SHOPIFY_API_SECRET || "";

            const params = {
                client_id: appId,
                client_secret: appSecret,
                code: code
            };

            if (redirectUri) {
                params.redirect_uri = redirectUri;
            }

            let response;
            try {
                response = await axios.get(`${this.apiUrl}/oauth/access_token`, { params });
            } catch (err) {
                const errMsg = err.response?.data?.error?.message || "";
                if (errMsg.includes("redirect_uri") || err.response?.status === 400) {
                    console.warn("[Meta Embedded Signup] Primary token exchange notice, trying fallback redirect_uri parameter...");
                    // Try alternate redirect_uri variations (empty string vs provided redirectUri)
                    const altParams = {
                        client_id: appId,
                        client_secret: appSecret,
                        code: code,
                        redirect_uri: redirectUri ? "" : (process.env.META_REDIRECT_URI || "")
                    };
                    response = await axios.get(`${this.apiUrl}/oauth/access_token`, { params: altParams });
                } else {
                    throw err;
                }
            }

            return {
                success: true,
                accessToken: response.data.access_token,
                data: response.data
            };
        } catch (error) {
            console.error("[Meta Embedded Signup] Code exchange failed:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
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
     * Send a standard text message
     */
    async sendTextMessage(shopDomain, to, message) {
        try {
            const { phoneNumberId, accessToken } = await this.getCredentials(shopDomain);
            if (!phoneNumberId || !accessToken) {
                throw new Error("Meta API credentials not configured for shop");
            }

            const formattedNumber = this.formatPhone(to);

            const response = await axios.post(
                `${this.apiUrl}/${phoneNumberId}/messages`,
                {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: formattedNumber,
                    type: "text",
                    text: {
                        preview_url: false,
                        body: message,
                    },
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            return {
                success: true,
                messageId: response.data.messages[0]?.id,
                data: response.data,
            };
        } catch (error) {
            console.error("[Meta Cloud API] Error sending text message:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message,
                details: error.response?.data,
            };
        }
    }

    /**
     * Send Meta Interactive Quick Reply Buttons message (Order Confirmation / Cancellation)
     */
    async sendInteractiveButtonsMessage(shopDomain, to, bodyText, buttons = [], headerText = "", footerText = "") {
        try {
            const { phoneNumberId, accessToken } = await this.getCredentials(shopDomain);
            if (!phoneNumberId || !accessToken) {
                throw new Error("Meta API credentials not configured for shop");
            }

            const formattedNumber = this.formatPhone(to);

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

            const response = await axios.post(
                `${this.apiUrl}/${phoneNumberId}/messages`,
                {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: formattedNumber,
                    type: "interactive",
                    interactive: interactiveObj,
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            return {
                success: true,
                messageId: response.data.messages[0]?.id,
                data: response.data,
            };
        } catch (error) {
            console.error("[Meta Cloud API] Error sending interactive message:", error.response?.data || error.message);
            // Fallback to text message if interactive message fails (e.g. outside 24h window or feature restriction)
            console.log("[Meta Cloud API] Falling back to text message...");
            return await this.sendTextMessage(shopDomain, to, bodyText);
        }
    }

    /**
     * Send an Approved Meta Template Message
     */
    async sendTemplateMessage(shopDomain, to, templateName, languageCode = "en", components = []) {
        try {
            const { phoneNumberId, accessToken } = await this.getCredentials(shopDomain);
            if (!phoneNumberId || !accessToken) {
                throw new Error("Meta API credentials not configured for shop");
            }

            const formattedNumber = this.formatPhone(to);

            const payload = {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: formattedNumber,
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
                messageId: response.data.messages[0]?.id,
                data: response.data,
            };
        } catch (error) {
            console.error("[Meta Cloud API] Error sending template message:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message,
                details: error.response?.data,
            };
        }
    }

    /**
     * Send Image message
     */
    async sendImageMessage(shopDomain, to, imageUrl, caption = "") {
        try {
            const { phoneNumberId, accessToken } = await this.getCredentials(shopDomain);
            if (!phoneNumberId || !accessToken) {
                throw new Error("Meta API credentials not configured for shop");
            }

            const formattedNumber = this.formatPhone(to);

            const payload = {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: formattedNumber,
                type: "image",
                image: { link: imageUrl },
            };

            if (caption) {
                payload.image.caption = caption;
            }

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
                messageId: response.data.messages[0]?.id,
                data: response.data,
            };
        } catch (error) {
            console.error("[Meta Cloud API] Error sending image message:", error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message,
            };
        }
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
