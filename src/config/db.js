import mongoose from "mongoose";
import { seedPlans, upgradeShippingTemplates, seedAdmin } from "../utils/seeder.js";

let isConnected = false;
let hasSeeded = false;

export const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/whatflow";

  try {
    const db = await mongoose.connect(uri, {
      autoIndex: process.env.NODE_ENV !== "production",
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });

    isConnected = db.connections[0].readyState === 1;
    console.log("MongoDB connected successfully");

    // Run seeders only once per container instance, not on every request
    if (!hasSeeded) {
      hasSeeded = true;
      Promise.all([
        seedPlans(),
        seedAdmin(),
        upgradeShippingTemplates()
      ]).catch(seedErr => console.warn("[Seeder] Non-critical background seed warning:", seedErr.message));
    }
  } catch (err) {
    isConnected = false;
    console.error("MongoDB connection error:", err.message);
    throw err;
  }
};
