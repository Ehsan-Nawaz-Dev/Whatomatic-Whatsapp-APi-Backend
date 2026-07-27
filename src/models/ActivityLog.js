import mongoose from "mongoose";

const ActivityLogSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: false },
    type: {
      type: String,
      enum: ["confirmed", "cancelled", "recovered", "pending", "failed", "pre-cancel", "shipped", "fulfilled", "delivered"],
      required: true,
    },
    orderId: { type: String },
    customerName: { type: String },
    customerPhone: { type: String },
    message: { type: String },
    errorMessage: { type: String },
    channel: { type: String, default: "whatsapp" },
    rawPayload: { type: Object },
  },
  { timestamps: true },
);

export const ActivityLog = mongoose.model("ActivityLog", ActivityLogSchema);
