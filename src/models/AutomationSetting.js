import mongoose from "mongoose";

const AutomationSettingSchema = new mongoose.Schema(
    {
        shopDomain: { type: String, required: true, index: true },
        type: {
            type: String,
            enum: [
                "abandoned_cart",
                "fulfillment_update",
                "fulfillment_delivered",
                "admin-order-alert",
                "admin-confirmed-alert",
                "order-confirmation",
                "cancellation",
                "order-confirmed-reply",
                "cancellation-verify",
                "bank-transfer-confirmation"
            ],
            required: true
        },
        enabled: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// Compound index for quick lookups
AutomationSettingSchema.index({ shopDomain: 1, type: 1 }, { unique: true });

export const AutomationSetting = mongoose.model("AutomationSetting", AutomationSettingSchema);
