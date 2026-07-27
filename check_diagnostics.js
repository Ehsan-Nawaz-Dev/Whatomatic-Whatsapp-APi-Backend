import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { ActivityLog } from './src/models/ActivityLog.js';
import { Merchant } from './src/models/Merchant.js';
import { WhatsAppSession } from './src/models/WhatsAppSession.js';

dotenv.config();

async function checkStatus() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const lastLogs = await ActivityLog.find().sort({ createdAt: -1 }).limit(10);
        console.log('Last 10 Activity Logs:');
        lastLogs.forEach(log => {
            console.log(`- [${log.createdAt}] ${log.type} | Order: ${log.orderId} | Msg: ${log.message} | Error: ${log.errorMessage || 'none'}`);
        });

        const merchants = await Merchant.find({ needsReauth: true });
        console.log('\nMerchants needing re-auth:');
        merchants.forEach(m => console.log(`- ${m.shopDomain} | Reason: ${m.reauthReason}`));

        const sessions = await WhatsAppSession.find();
        console.log('\nWhatsApp Sessions:');
        sessions.forEach(s => console.log(`- ${s.shopDomain} | Connected: ${s.isConnected} | Status: ${s.status}`));

        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkStatus();
