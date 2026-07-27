import mongoose from "mongoose";

const TemplateSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true },
    name: { type: String, required: true },
    event: {
      type: String,
      enum: [
        "orders/create",
        "orders/create/bank_transfer",
        "checkouts/abandoned",
        "fulfillments/update",
        "fulfillments/delivered",
        "orders/cancelled",
        "admin-order-alert",
        "admin-confirmed-alert",
        "orders/confirmed",
        "orders/cancel_verify",
      ],
      required: true,
    },
    message: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    isPoll: { type: Boolean, default: false },
    pollOptions: { type: [String], default: ["✅Yes, Confirm✅", "❌No, Cancel❌"] },
    sendingDelay: { type: Number, default: 0 }, // Sending delay in minutes. 0 = default safe guard
    targetOrderStatus: { type: String, enum: ["all", "pending", "paid"], default: "all" }, // Used to filter orders by payment status

    // Meta WhatsApp Cloud API Specific Template Attributes
    metaTemplateName: { type: String },
    metaLanguage: { type: String, default: "en" },
    metaCategory: { type: String },
    metaStatus: { type: String, default: "APPROVED" },
    components: { type: Array, default: [] },
  },
  { timestamps: true },
);

export const Template = mongoose.model("Template", TemplateSchema);
