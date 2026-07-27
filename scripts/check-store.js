import 'dotenv/config';
import mongoose from 'mongoose';
import { Merchant } from '../src/models/Merchant.js';
import { AutomationSetting } from '../src/models/AutomationSetting.js';
import { ActivityLog } from '../src/models/ActivityLog.js';
import { WhatsAppSession } from '../src/models/WhatsAppSession.js';
import { Template } from '../src/models/Template.js';

const SHOP = process.argv[2] || 'delma-co.myshopify.com';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`\n========== STORE DIAGNOSTICS: ${SHOP} ==========\n`);

    // 1. Merchant Info
    const merchant = await Merchant.findOne({ shopDomain: SHOP }).lean();
    if (!merchant) {
        console.log('❌ Merchant NOT FOUND in database.');
        await mongoose.disconnect();
        return;
    }
    console.log('--- MERCHANT ---');
    console.log(`  Shop Domain:     ${merchant.shopDomain}`);
    console.log(`  Plan:            ${merchant.plan || 'N/A'}`);
    console.log(`  Is Active:       ${merchant.isActive !== false ? '✅ Yes' : '❌ No'}`);
    console.log(`  WhatsApp Number: ${merchant.whatsappNumber || 'Not set'}`);
    console.log(`  Admin Phone:     ${merchant.adminPhoneNumber || 'Not set'}`);
    console.log(`  Usage:           ${merchant.usage || 0} / ${merchant.dailyLimit || 250} (daily: ${merchant.dailyUsage || 0})`);
    console.log(`  Has AccessToken: ${!!merchant.shopifyAccessToken}`);

    // 2. WhatsApp Session
    const session = await WhatsAppSession.findOne({ shopDomain: SHOP }).lean();
    console.log('\n--- WHATSAPP SESSION ---');
    if (session) {
        console.log(`  Status:        ${session.status}`);
        console.log(`  Is Connected:  ${session.isConnected ? '✅ Yes' : '❌ No'}`);
        console.log(`  Phone Number:  ${session.phoneNumber || 'N/A'}`);
        console.log(`  Last Connected:${session.lastConnected || 'Never'}`);
        console.log(`  Error Message: ${session.errorMessage || 'None'}`);
    } else {
        console.log('  No WhatsApp session found.');
    }

    // 3. Automation Settings
    const automations = await AutomationSetting.find({ shopDomain: SHOP }).lean();
    console.log('\n--- AUTOMATION SETTINGS ---');
    if (automations.length === 0) {
        console.log('  No automation settings found.');
    } else {
        for (const a of automations) {
            console.log(`  ${a.enabled ? '✅' : '❌'} ${a.type.padEnd(30)} ${a.enabled ? 'ENABLED' : 'DISABLED'}`);
        }
    }

    // 4. Templates
    const templates = await Template.find({ merchant: merchant._id }).lean();
    console.log('\n--- TEMPLATES ---');
    if (templates.length === 0) {
        console.log('  No templates found.');
    } else {
        for (const t of templates) {
            console.log(`  ${t.enabled ? '✅' : '❌'} ${t.name.padEnd(30)} Event: ${t.event.padEnd(25)} Poll: ${t.isPoll ? 'Yes' : 'No'}`);
        }
    }

    // 5. Recent Activity Logs (last 20)
    const logs = await ActivityLog.find({ merchant: merchant._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
    console.log('\n--- RECENT ACTIVITY (Last 20) ---');
    if (logs.length === 0) {
        console.log('  No activity logs found.');
    } else {
        for (const log of logs) {
            const date = new Date(log.createdAt).toLocaleString();
            const icon = log.type === 'confirmed' ? '✅' :
                         log.type === 'cancelled' ? '❌' :
                         log.type === 'pending' ? '🕒' :
                         log.type === 'failed' ? '💥' : '📋';
            console.log(`  ${icon} [${date}] Order: ${log.orderId || 'N/A'} | Type: ${log.type.padEnd(12)} | ${log.message || ''}`);
            if (log.errorMessage) console.log(`     ⚠️  Error: ${log.errorMessage}`);
        }
    }

    console.log('\n========== END ==========\n');
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Script error:', err);
    mongoose.disconnect();
});
