import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Merchant } from './src/models/Merchant.js';
import { AutomationSetting } from './src/models/AutomationSetting.js';
import { Template } from './src/models/Template.js';

dotenv.config();

async function checkConfig() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const shop = "testezonde.myshopify.com";
        const merchant = await Merchant.findOne({ shopDomain: shop });

        if (!merchant) {
            console.log("Merchant not found");
            process.exit(0);
        }

        const settings = await AutomationSetting.find({ shopDomain: shop });
        const templates = await Template.find({ merchant: merchant._id });

        console.log("\n--- AUTOMATION SETTINGS ---");
        settings.forEach(s => console.log(`${s.type}: ${s.enabled ? 'ENABLED' : 'DISABLED'}`));

        console.log("\n--- TEMPLATES ---");
        templates.forEach(t => console.log(`${t.event}: ${t.enabled ? 'ENABLED' : 'DISABLED'} (${t.name})`));

        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkConfig();
