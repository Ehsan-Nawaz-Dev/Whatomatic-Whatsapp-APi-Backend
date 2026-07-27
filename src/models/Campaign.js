import mongoose from "mongoose";

const CampaignSchema = new mongoose.Schema(
    {
        shopDomain: { type: String, required: true, index: true },
        name: { type: String },
        contacts: [
            {
                phone: { type: String, required: true },
                name: { type: String },
                status: { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
                error: { type: String }
            }
        ],
        message: { type: String, required: true },
        isPoll: { type: Boolean, default: false },
        pollOptions: { type: [String], default: [] },
        type: { type: String, default: "text" },
        status: {
            type: String,
            enum: ["pending", "sending", "completed", "failed"],
            default: "pending"
        },
        sentCount: { type: Number, default: 0 },
        totalCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

export const Campaign = mongoose.model("Campaign", CampaignSchema);
