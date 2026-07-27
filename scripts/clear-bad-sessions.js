import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';

// Override DNS resolution servers for SRV records on Windows/local environment
dns.setServers(['8.8.8.8', '1.1.1.1']);

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

// Define schema for WhatsAppAuth
const WhatsAppAuthSchema = new mongoose.Schema(
    {
        shopDomain: { type: String, required: true },
        dataType: { type: String, required: true },
        id: { type: String, required: true },
        data: { type: mongoose.Schema.Types.Mixed },
    },
    { collection: 'whatsappauths' }
);

const WhatsAppAuth = mongoose.model('WhatsAppAuthClear', WhatsAppAuthSchema);

async function run() {
    if (!MONGODB_URI) {
        console.error("❌ MONGODB_URI is not set in env!");
        process.exit(1);
    }
    
    // Check if shopDomain is provided as command line argument
    const shopDomainArg = process.argv[2];

    try {
        console.log(`Connecting to MongoDB...`);
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Connected successfully!");

        const query = { dataType: { $ne: 'creds' } };
        if (shopDomainArg) {
            query.shopDomain = shopDomainArg;
            console.log(`Targeting shop: ${shopDomainArg}`);
        } else {
            console.log("Targeting all shops (all sessions and pre-keys will be cleared, preserving logins).");
        }

        const totalBefore = await WhatsAppAuth.countDocuments(query);
        console.log(`Found ${totalBefore} non-creds documents (sessions, pre-keys, sender-keys) to clear.`);

        if (totalBefore === 0) {
            console.log("No documents to clear.");
            return;
        }

        const result = await WhatsAppAuth.deleteMany(query);
        console.log(`🧹 Successfully cleared ${result.deletedCount} documents.`);
        console.log("🎉 All desynchronized session and pre-key states have been cleared.");
        console.log("👉 Next, restart your backend service on PM2. The sessions will rebuild cleanly on the next incoming/outgoing message without logging you out.");
    } catch (err) {
        console.error("❌ Error clearing sessions:", err);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
}

run();
