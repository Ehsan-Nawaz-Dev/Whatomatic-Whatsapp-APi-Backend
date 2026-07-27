import mongoose from "mongoose";

const PollMessageSchema = new mongoose.Schema(
    {
        shopDomain: { type: String, required: true, index: true },
        messageKeyId: { type: String, required: true, index: true },
        // Store the full message as JSON (serialized with BufferJSON)
        messageData: { type: String, required: true },
        // Customer phone for easier lookup
        customerPhone: { type: String },
        // Link to specific Order ID to handle concurrency/multiple orders correctly
        orderId: { type: String, index: true },
    },
    { timestamps: true }
);

// Compound index for fast lookup
PollMessageSchema.index({ shopDomain: 1, messageKeyId: 1 }, { unique: true });

// Auto-expire after 7 days (polls older than 7 days are irrelevant)
PollMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

export const PollMessage = mongoose.model("PollMessage", PollMessageSchema);
