import mongoose from "mongoose";

const GlobalNotificationSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        message: { type: String, required: true },
        type: { type: String, enum: ["info", "warning", "success", "error"], default: "info" },
        isActive: { type: Boolean, default: true },
        targetPlan: { type: String, default: "all" }, // "all", "free", "gold", etc.
    },
    { timestamps: true }
);

export const GlobalNotification = mongoose.model("GlobalNotification", GlobalNotificationSchema);
