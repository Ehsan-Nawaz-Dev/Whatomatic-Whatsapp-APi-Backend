import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Merchant } from './src/models/Merchant.js';

dotenv.config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const m = await Merchant.findOne({ shopDomain: /ezonde/i });

    if (m) {
        console.log(`TESTEZONDE: ${m.shopDomain}`);
        console.log(`TOKEN_EXISTS: ${!!m.shopifyAccessToken}`);
    } else {
        console.log("NOT_FOUND");
    }

    await mongoose.disconnect();
}

check();
