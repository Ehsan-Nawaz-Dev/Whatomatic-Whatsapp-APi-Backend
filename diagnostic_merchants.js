import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Merchant } from './src/models/Merchant.js';

dotenv.config();

async function checkMerchants() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const merchants = await Merchant.find();

        console.log(`\n--- MERCHANT DIAGNOSTIC ---`);
        console.log(`Total Merchants: ${merchants.length}`);

        merchants.forEach(m => {
            console.log(`\nShop: ${m.shopDomain}`);
            console.log(`Active: ${m.isActive}`);
            console.log(`Has Token: ${!!m.shopifyAccessToken}`);
            if (m.shopifyAccessToken) {
                console.log(`Token Prefix: ${m.shopifyAccessToken.substring(0, 10)}...`);
            }
            console.log(`Plan: ${m.plan}`);
            console.log(`Needs Reauth: ${m.needsReauth}`);
        });

        console.log(`\n--- END DIAGNOSTIC ---\n`);

        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkMerchants();
