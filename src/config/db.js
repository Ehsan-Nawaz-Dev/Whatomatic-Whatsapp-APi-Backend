import mongoose from "mongoose";
import { seedPlans, upgradeShippingTemplates, seedAdmin } from "../utils/seeder.js";

let isConnected = false;

export const connectDB = async () => {
  if (isConnected) {
    return;
  }

  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/whatflow";

  try {
    const db = await mongoose.connect(uri, {
      autoIndex: true,
    });
    isConnected = db.connections[0].readyState === 1;
    console.log("MongoDB connected");

    // Seed default plans and admin credentials
    await seedPlans();
    await seedAdmin();

    // One-time migration: upgrade old shipping templates to include tracking info
    await upgradeShippingTemplates();
  } catch (err) {
    console.error("MongoDB connection error", err);
    throw err;
  }
};
