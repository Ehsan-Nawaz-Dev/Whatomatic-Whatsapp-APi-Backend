import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';

// Override DNS resolution servers for SRV records on Windows/local environment
dns.setServers(['8.8.8.8', '1.1.1.1']);

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

// Define simplified schemas for migration
const planSchema = new mongoose.Schema({
    id: String,
    name: String
}, { collection: 'plans' });

const merchantSchema = new mongoose.Schema({
    shopDomain: String,
    plan: String,
    basePlan: String
}, { collection: 'merchants' });

const Plan = mongoose.model('PlanMigration', planSchema);
const Merchant = mongoose.model('MerchantMigration', merchantSchema);

async function run() {
    if (!MONGODB_URI) {
        console.error("❌ MONGODB_URI is not set in env!");
        process.exit(1);
    }
    try {
        console.log(`Connecting to MongoDB...`);
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Connected successfully!");

        // 1. Delete plan 'pro' if it exists
        const deletePlanResult = await Plan.deleteOne({ id: 'pro' });
        console.log(`🧹 Deleted duplicate plan 'pro' documents: ${deletePlanResult.deletedCount}`);

        // 2. Update merchants from 'pro' to 'professional'
        const updatePlanResult = await Merchant.updateMany(
            { plan: 'pro' },
            { $set: { plan: 'professional' } }
        );
        console.log(`🔄 Updated merchants from plan 'pro' to 'professional': ${updatePlanResult.modifiedCount}`);

        // 3. Update merchants from basePlan 'pro' to 'professional'
        const updateBasePlanResult = await Merchant.updateMany(
            { basePlan: 'pro' },
            { $set: { basePlan: 'professional' } }
        );
        console.log(`🔄 Updated merchants from basePlan 'pro' to 'professional': ${updateBasePlanResult.modifiedCount}`);

        console.log("🎉 Database migration completed successfully!");
    } catch (err) {
        console.error("❌ Database migration error:", err);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
}

run();
