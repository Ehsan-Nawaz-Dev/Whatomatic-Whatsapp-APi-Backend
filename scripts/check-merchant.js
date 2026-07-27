
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Merchant } from '../src/models/Merchant.js';

dotenv.config();

const checkMerchant = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const shopDomain = 'ezone-9374.myshopify.com';
        const merchant = await Merchant.findOne({ shopDomain });

        if (merchant) {
            console.log('✅ Merchant Found:');
            console.log('ID:', merchant._id);
            console.log('Shop:', merchant.shopDomain);
            console.log('Token Exists:', !!merchant.shopifyAccessToken);
            console.log('Token Length:', merchant.shopifyAccessToken ? merchant.shopifyAccessToken.length : 0);
        } else {
            console.log('❌ Merchant NOT FOUND for', shopDomain);

            // List all merchants to see what we have
            const all = await Merchant.find({}, 'shopDomain');
            console.log('Available Merchants:', all.map(m => m.shopDomain));
        }

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
};

checkMerchant();
