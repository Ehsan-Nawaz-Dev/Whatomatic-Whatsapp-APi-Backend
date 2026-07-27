import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Merchant } from './src/models/Merchant.js';

dotenv.config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const m1 = await Merchant.findOne({ shopDomain: /ezone/i });
    const m2 = await Merchant.findOne({ shopDomain: /ezonde/i });

    console.log("CHECK_START");
    if (m1) console.log(`SHOP_1: ${m1.shopDomain}, TOKEN: ${!!m1.shopifyAccessToken}`);
    if (m2) console.log(`SHOP_2: ${m2.shopDomain}, TOKEN: ${!!m2.shopifyAccessToken}`);
    console.log("CHECK_END");

    await mongoose.disconnect();
}

check();
