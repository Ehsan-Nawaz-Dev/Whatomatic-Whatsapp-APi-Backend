import mongoose from "mongoose";

const WhatsAppSessionSchema = new mongoose.Schema(
    {
        shopDomain: { type: String, required: true, unique: true },
        metaPhoneNumberId: { type: String },
        metaWabaId: { type: String },
        phoneNumber: { type: String }, // Verified WhatsApp Business number
        isConnected: { type: Boolean, default: false },
        status: {
            type: String,
            enum: ["disconnected", "connected", "error"],
            default: "disconnected"
        },
        displayPhoneNumber: { type: String },
        qualityRating: { type: String }, // e.g. GREEN, YELLOW, RED
        lastVerifiedAt: { type: Date },
        errorMessage: { type: String },
    },
    { timestamps: true }
);

export const WhatsAppSession = mongoose.model("WhatsAppSession", WhatsAppSessionSchema);
