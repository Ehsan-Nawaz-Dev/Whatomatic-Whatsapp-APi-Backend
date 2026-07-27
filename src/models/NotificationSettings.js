import mongoose from "mongoose";

const NotificationSettingsSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true, unique: true },
    notifyOnConfirm: { type: Boolean, default: true },
    notifyOnCancel: { type: Boolean, default: true },
    notifyOnAbandoned: { type: Boolean, default: false },
    emailAlerts: { type: Boolean, default: true },
    whatsappAlerts: { type: Boolean, default: false },
    pushNotifications: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const NotificationSettings = mongoose.model("NotificationSettings", NotificationSettingsSchema);
