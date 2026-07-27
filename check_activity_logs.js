import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { ActivityLog } from './src/models/ActivityLog.js';

dotenv.config();

async function checkLogs() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const shop = "testezonde.myshopify.com";
        const logs = await ActivityLog.find({ customerPhone: { $exists: true } })
            .sort({ createdAt: -1 })
            .limit(10);

        console.log("\n--- RECENT ACTIVITY LOGS ---");
        logs.forEach(l => {
            console.log(`[${l.createdAt.toISOString()}] Type: ${l.type}, Phone: ${l.customerPhone}, Message: ${l.message}`);
        });

        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkLogs();
