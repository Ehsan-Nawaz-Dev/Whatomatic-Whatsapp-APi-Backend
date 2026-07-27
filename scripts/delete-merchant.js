
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Merchant } from '../src/models/Merchant.js';

dotenv.config();

const deleteMerchant = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const shopDomain = 'ezone-9374.myshopify.com';
        const result = await Merchant.deleteOne({ shopDomain });

        console.log('Delete Result:', result);
        console.log('Merchant deleted. Please re-install the app immediately.');

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
};

deleteMerchant();
