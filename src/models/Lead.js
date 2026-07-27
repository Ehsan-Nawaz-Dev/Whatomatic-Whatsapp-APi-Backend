import mongoose from "mongoose";

const LeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    message: { type: String },
    source: { type: String, default: "landing" },
  },
  { timestamps: true },
);

export const Lead = mongoose.model("Lead", LeadSchema);
