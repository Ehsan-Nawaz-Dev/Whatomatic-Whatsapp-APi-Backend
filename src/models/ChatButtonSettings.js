import mongoose from "mongoose";

const ChatButtonSettingsSchema = new mongoose.Schema(
    {
        shopDomain: { type: String, required: true, unique: true },
        phoneNumber: { type: String },
        buttonText: { type: String, default: "Chat with us" },
        position: { type: String, enum: ["left", "right"], default: "right" },
        color: { type: String, default: "#25D366" },
        enabled: { type: Boolean, default: true },
    },
    { timestamps: true }
);

export const ChatButtonSettings = mongoose.model("ChatButtonSettings", ChatButtonSettingsSchema);
