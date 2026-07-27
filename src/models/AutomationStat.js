import mongoose from "mongoose";

const AutomationStatSchema = new mongoose.Schema(
    {
        shopDomain: { type: String, required: true, index: true },
        type: {
            type: String,
            enum: ["abandoned_cart", "fulfillment_update", "fulfillment_delivered", "admin-order-alert", "admin-confirmed-alert", "order-confirmation"],
            required: true
        },
        sent: { type: Number, default: 0 },
        recovered: { type: Number, default: 0 }, // Only for abandoned_cart
        revenue: { type: Number, default: 0 },   // Only for abandoned_cart
    },
    { timestamps: true }
);

// Compound index for quick lookups
AutomationStatSchema.index({ shopDomain: 1, type: 1 }, { unique: true });

export const AutomationStat = mongoose.model("AutomationStat", AutomationStatSchema);
