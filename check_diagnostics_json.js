import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { ActivityLog } from './src/models/ActivityLog.js';
import { Merchant } from './src/models/Merchant.js';
import { WhatsAppSession } from './src/models/WhatsAppSession.js';

dotenv.config();

async function checkStatus() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const lastLogs = await ActivityLog.find().sort({ createdAt: -1 }).limit(5);
        const logData = lastLogs.map(l => ({
            time: l.createdAt,
            type: l.type,
            orderId: l.orderId,
            msg: l.message,
            err: l.errorMessage
        }));

        const merchants = await Merchant.find({ needsReauth: true }).select('shopDomain reauthReason');

        const sessions = await WhatsAppSession.find().select('shopDomain isConnected status');

        console.log(JSON.stringify({
            logs: logData,
            reauthNeeded: merchants,
            sessions: sessions
        }, null, 2));

        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkStatus();
