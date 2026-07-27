import mongoose from "mongoose";

const ContactSchema = new mongoose.Schema(
    {
        merchant: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true },
        name: { type: String, required: true },
        phone: { type: String, required: true },
        email: { type: String },
        tags: [{ type: String }],
        notes: { type: String },
        lastOrderAt: { type: Date },
        totalOrders: { type: Number, default: 1 },
        source: { type: String, default: "shopify" },
    },
    { timestamps: true }
);

// Unique combination of merchant and phone
ContactSchema.index({ merchant: 1, phone: 1 }, { unique: true });

export const Contact = mongoose.model("Contact", ContactSchema);
