import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import { Merchant } from '../src/models/Merchant.js';

const API_VERSION = '2025-01';

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB. Scanning merchants for active paid plans...');

    // Find all merchants currently marked with a paid plan
    const merchants = await Merchant.find({
        plan: { $in: ['starter', 'growth', 'professional', 'pro'] }
    }).lean();

    console.log(`Found ${merchants.length} merchants on paid plans. Verifying status with Shopify...\n`);

    const expiredOrInvalid = [];

    for (const merchant of merchants) {
        const { shopDomain, plan, shopifySubscriptionId, shopifyAccessToken } = merchant;
        console.log(`Checking ${shopDomain} (Plan: ${plan})...`);

        if (!shopifyAccessToken) {
            console.log(`  ❌ No shopifyAccessToken. Status: EXPIRED/UNINSTALLED`);
            expiredOrInvalid.push({ merchant, reason: 'Missing access token' });
            continue;
        }

        if (!shopifySubscriptionId) {
            console.log(`  ❌ No shopifySubscriptionId recorded. Status: EXPIRED/UNINSTALLED`);
            expiredOrInvalid.push({ merchant, reason: 'No subscription ID' });
            continue;
        }

        try {
            const verifyQuery = {
                query: `
                    query {
                        node(id: "${shopifySubscriptionId}") {
                            ... on AppSubscription {
                                id
                                status
                                name
                            }
                        }
                    }
                `
            };

            const response = await axios.post(
                `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`,
                verifyQuery,
                {
                    headers: {
                        'X-Shopify-Access-Token': shopifyAccessToken,
                        'Content-Type': 'application/json'
                    },
                    timeout: 8000
                }
            );

            const errors = response.data?.errors;
            if (errors) {
                console.log(`  ❌ GraphQL Errors: ${JSON.stringify(errors)}`);
                expiredOrInvalid.push({ merchant, reason: `GraphQL Error: ${errors[0]?.message || 'Unknown'}` });
                continue;
            }

            const subscription = response.data?.data?.node;
            if (!subscription) {
                console.log(`  ❌ Subscription not found on Shopify. Status: EXPIRED/UNINSTALLED`);
                expiredOrInvalid.push({ merchant, reason: 'Subscription not found on Shopify' });
                continue;
            }

            console.log(`  Shopify Status: ${subscription.status} | Plan Name: ${subscription.name}`);

            if (subscription.status !== 'ACTIVE') {
                console.log(`  ❌ Subscription is NOT active. Status: ${subscription.status}`);
                expiredOrInvalid.push({ merchant, reason: `Shopify status: ${subscription.status}` });
            } else {
                console.log(`  ✅ Active and valid.`);
            }

        } catch (err) {
            const status = err.response?.status;
            let reason = err.message;
            if (status === 401) {
                reason = 'Unauthorized (App uninstalled/Token revoked)';
            } else if (err.response?.data) {
                reason = JSON.stringify(err.response.data);
            }
            console.log(`  ❌ Error querying Shopify: ${reason}`);
            expiredOrInvalid.push({ merchant, reason });
        }
        
        // Stagger API calls
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n==================================================');
    console.log(`SCAN COMPLETE: Found ${expiredOrInvalid.length} expired or invalid paid plans:`);
    console.log('==================================================\n');

    if (expiredOrInvalid.length > 0) {
        expiredOrInvalid.forEach(({ merchant, reason }) => {
            console.log(`- Shop: ${merchant.shopDomain}`);
            console.log(`  DB Plan: ${merchant.plan}`);
            console.log(`  Reason: ${reason}`);
            console.log(`  Revert command suggestion:`);
            console.log(`  db.merchants.updateOne({ _id: ObjectId("${merchant._id}") }, { $set: { plan: "free", billingStatus: "none", shopifySubscriptionId: null } })\n`);
        });

        // Prompt or offer auto-revert script output
        const autoRevertCommand = `
node -e '
import("dotenv/config").then(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.connect(process.env.MONGODB_URI);
  const ids = [${expiredOrInvalid.map(e => `"${e.merchant._id}"`).join(',')}];
  const result = await mongoose.connection.db.collection("merchants").updateMany(
    { _id: { \$in: ids.map(id => new mongoose.Types.ObjectId(id)) } },
    { \$set: { plan: "free", billingStatus: "none", shopifySubscriptionId: null } }
  );
  console.log(\`Successfully reverted \${result.modifiedCount} merchants to free plan.\`);
  await mongoose.disconnect();
});
'`;
        console.log('To automatically revert all these expired stores to the free plan, run this command on your VPS:');
        console.log(autoRevertCommand);
    } else {
        console.log('🎉 No expired or invalid paid plans found in the database!');
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Fatal script error:', err);
    mongoose.disconnect();
});
