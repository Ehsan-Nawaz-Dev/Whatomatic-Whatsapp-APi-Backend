import mongoose from "mongoose";
import { seedPlans, upgradeShippingTemplates, seedAdmin } from "../utils/seeder.js";

let isConnected = false;

export const connectDB = async () => {
  if (isConnected) {
    return;
  }

    const uri = process.env.DATABASE_URL || process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/whatflow";

    try {
      const db = await mongoose.connect(uri, {
        autoIndex: true,
        serverSelectionTimeoutMS: 5000,
      });
      isConnected = db.connections[0].readyState === 1;
      console.log("MongoDB connected successfully");

      // Seed default plans and admin credentials asynchronously without blocking lambda responses
      Promise.all([
        seedPlans(),
        seedAdmin(),
        upgradeShippingTemplates()
      ]).catch(seedErr => console.warn("[Seeder] Non-critical background seed warning:", seedErr.message));
    } catch (err) {
      console.error("MongoDB connection error:", err.message);
      throw err;
    }
};
