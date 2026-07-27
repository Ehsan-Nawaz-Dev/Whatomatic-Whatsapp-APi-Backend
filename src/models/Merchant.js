import mongoose from "mongoose";

const MerchantSchema = new mongoose.Schema(
  {
    shopDomain: { type: String, required: true, unique: true },
    shopifyAccessToken: { type: String },

    // Auto-fetched from Shopify
    storeName: { type: String },
    contactName: { type: String },
    email: { type: String },
    phone: { type: String },
    currency: { type: String, default: 'USD' },
    timezone: { type: String },
    country: { type: String },

    // WhatsApp Settings (Meta Business Cloud API)
    whatsappNumber: { type: String },
    adminPhoneNumber: { type: String },
    whatsappProvider: { type: String, enum: ["cloud", "twilio"], default: "cloud" },

    // Meta WhatsApp Business API Credentials
    metaPhoneNumberId: { type: String },
    metaWabaId: { type: String },
    metaAccessToken: { type: String },
    metaWebhookVerifyToken: { type: String },
    metaPhoneDisplay: { type: String },

    // Tag Settings
    pendingConfirmTag: { type: String, default: '🕒 Pending Confirmation' },
    orderConfirmTag: { type: String, default: '✅ Order Confirmed' },
    orderCancelTag: { type: String, default: '❌ Order Cancelled' },
    adminNotifiedTag: { type: String, default: '📣 Admin Notified' },
    noWhatsappTag: { type: String, default: '📵 No WhatsApp' },

    // Reply Messages
    orderConfirmReply: { type: String, default: 'Thank you! Your order has been confirmed. ✅' },
    orderCancelReply: { type: String, default: 'Your order has been cancelled. ❌' },

    // Legacy fields (kept for backward compatibility)
    defaultCountry: { type: String },
    language: { type: String },

    // Billing Status
    plan: { type: String, default: 'free' },
    basePlan: { type: String, default: 'free' },
    billingStatus: { type: String, default: 'inactive' },
    shopifySubscriptionId: { type: String }, // GraphQL subscription ID
    shopifyUsageLineItemId: { type: String }, // For usage-based charges
    usageChargeTotal: { type: Number, default: 0 }, // Total billed usage this month
    billingCycleEnd: { type: Date },

    // Expiring Offline Access Tokens
    shopifyRefreshToken: { type: String },
    shopifyTokenExpiresAt: { type: Date },
    shopifyRefreshTokenExpiresAt: { type: Date },

    // Trial & Usage System
    trialActivated: { type: Boolean, default: false },
    trialStartedAt: { type: Date },
    usage: { type: Number, default: 0 },
    trialUsage: { type: Number, default: 0 },
    trialLimit: { type: Number, default: 10 },

    // Daily Safety Limits
    dailyLimit: { type: Number, default: 250 }, // Default safe-ish limit for unofficial connections
    dailyUsage: { type: Number, default: 0 },
    lastUsageDate: { type: String }, // Stored as YYYY-MM-DD

    // Status
    isActive: { type: Boolean, default: true },
    installedAt: { type: Date },

    // Re-auth System
    needsReauth: { type: Boolean, default: false },
    reauthReason: { type: String },
    reauthDetectedAt: { type: Date },
  },
  { timestamps: true }
);

export const Merchant = mongoose.model("Merchant", MerchantSchema);
