import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Merchant } from './src/models/Merchant.js';

dotenv.config();

async function checkProvider() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const merchants = await Merchant.find().select('shopDomain whatsappProvider isActive needsReauth');
        console.log(JSON.stringify(merchants, null, 2));
        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkProvider();
