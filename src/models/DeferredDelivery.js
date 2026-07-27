import mongoose from "mongoose";

// An order whose WhatsApp message reached WhatsApp's servers (✓) but not yet
// the customer's phone (✓✓). When the delivery receipt arrives, deliveryService
// completes the usage count + Shopify tag + dashboard status.
const DeferredDeliverySchema = new mongoose.Schema({
    shopDomain: { type: String, required: true, index: true },
    messageKeyId: { type: String, required: true, index: true },
    orderId: { type: String },
    activityId: { type: mongoose.Schema.Types.ObjectId, ref: "ActivityLog" },
    customerPhone: { type: String },
    kind: { type: String, default: "order-confirmation" },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 48 } // auto-clean after 48h
});

export const DeferredDelivery = mongoose.model("DeferredDelivery", DeferredDeliverySchema);
