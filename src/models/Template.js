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

    // Meta WhatsApp Cloud API Specific Template Attributes.
    // metaStatus defaulted to "APPROVED" even though nothing had been submitted to
    // Meta, which made unsubmitted templates look ready to send. NONE is the truth
    // until Meta actually approves one.
    metaTemplateName: { type: String },
    metaLanguage: { type: String, default: "en" },
    metaCategory: { type: String },
    metaStatus: {
      type: String,
      enum: ["NONE", "PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"],
      default: "NONE",
    },
    metaTemplateId: { type: String },
    metaRejectedReason: { type: String },
    metaSyncedAt: { type: Date },
    // Ordered placeholder names behind Meta's positional {{1}}, {{2}} body params.
    // e.g. ["customer_name", "order_number"] means {{1}}=customer_name.
    // Required to send an approved template with the right values in the right slots.
    metaVariables: { type: [String], default: [] },
    components: { type: Array, default: [] },
  },
  { timestamps: true },
);

export const Template = mongoose.model("Template", TemplateSchema);
