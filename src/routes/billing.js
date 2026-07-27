import { Router } from 'express';
import axios from 'axios';
import { Merchant } from '../models/Merchant.js';
import { Plan } from '../models/Plan.js';
import { checkAndResetBillingCycle } from '../services/billingService.js';

const router = Router();
const SHOPIFY_APP_URL = (process.env.SHOPIFY_APP_URL || "http://localhost:5000").replace(/\/$/, "");
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const API_VERSION = "2025-01";

// ============================================================
// POST /billing/create — Create a subscription or activate free plan
// ============================================================
router.post('/create', async (req, res) => {
    const shop = req.shopifyShop || req.query.shop;
    const { plan: planId } = req.body;
    console.log(`[Billing] Creating charge for shop: ${shop}, plan: ${planId}`);

    // Fetch Plan from DB
    const planConfig = await Plan.findOne({ id: planId });
    if (!planConfig) return res.status(400).json({ message: 'Invalid plan selected' });

    try {
        const merchant = await Merchant.findOne({
            shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
        });

        if (!merchant) {
            console.warn(`[Billing] Merchant ${shop} not found in database. Triggering automatic re-auth setup...`);
            // Return OAuth URL as the confirmationUrl. Frontend will handle redirect.
            const authUrl = `${SHOPIFY_APP_URL}/Api/auth/shopify?shop=${shop}`;
            return res.json({ confirmationUrl: authUrl });
        }

        // --- ALL PLANS NOW GO THROUGH SHOPIFY BILLING ---
        if (!merchant.shopifyAccessToken) {
            console.warn(`[Billing] Token missing for ${shop}. Redirecting to OAuth.`);
            const authUrl = `${SHOPIFY_APP_URL}/Api/auth/shopify?shop=${shop}`;
            return res.json({ confirmationUrl: authUrl });
        }

        // Build the return URL for after Shopify approval
        const returnUrl = `${SHOPIFY_APP_URL}/api/billing/confirm?shop=${shop}&plan=${planId}`;

        // Construct line items dynamically
        let lineItems = [];

        // If the plan has a base recurring price, add it
        if (planConfig.price > 0) {
            lineItems.push({
                plan: {
                    appRecurringPricingDetails: {
                        price: {
                            amount: planConfig.price,
                            currencyCode: (planConfig.currency || 'USD').toUpperCase()
                        },
                        interval: "EVERY_30_DAYS"
                    }
                }
            });
        }

        // Add Usage Pricing for auto-upgrades (chunk charging)
        lineItems.push({
            plan: {
                appUsagePricingDetails: {
                    cappedAmount: { amount: 15.0, currencyCode: "USD" },
                    terms: "Up to 50 free messages. Auto-upgrades to Starter ($4.99) after 50 messages, Growth ($9.99) after 1250, and Professional ($14.99) after 2500."
                }
            }
        });

        // GraphQL mutation for appSubscriptionCreate
        const graphqlQuery = {
            query: `
                mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $trialDays: Int, $lineItems: [AppSubscriptionLineItemInput!]!) {
                    appSubscriptionCreate(
                        name: $name
                        returnUrl: $returnUrl
                        test: $test
                        trialDays: $trialDays
                        lineItems: $lineItems
                    ) {
                        confirmationUrl
                        appSubscription {
                            id
                            status
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }
            `,
            variables: {
                name: `${planConfig.name} Plan`,
                returnUrl: returnUrl,
                test: process.env.SHOPIFY_BILLING_TEST === 'true',
                trialDays: planConfig.trialDays && planConfig.trialDays > 0 ? planConfig.trialDays : null,
                lineItems: lineItems
            }
        };

        console.log(`[Billing] Calling GraphQL appSubscriptionCreate for ${shop}...`);
        console.log(`[Billing] Plan: ${planConfig.name}, Price: ${planConfig.price} ${planConfig.currency || 'USD'}`);
        console.log(`[Billing] Return URL: ${returnUrl}`);

        const response = await axios.post(
            `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
            graphqlQuery,
            {
                headers: {
                    'X-Shopify-Access-Token': merchant.shopifyAccessToken,
                    'Content-Type': 'application/json'
                }
            }
        );

        const result = response.data?.data?.appSubscriptionCreate;

        // Check for user errors
        if (result?.userErrors?.length > 0) {
            console.error(`[Billing] GraphQL userErrors:`, result.userErrors);
            return res.status(400).json({
                message: 'Failed to create subscription',
                errors: result.userErrors
            });
        }

        // Check for confirmation URL
        if (!result?.confirmationUrl) {
            console.error(`[Billing] No confirmationUrl returned. Full response:`, JSON.stringify(response.data, null, 2));
            return res.status(500).json({ message: 'Shopify did not return a confirmation URL' });
        }

        // Save subscription ID for later verification
        if (result.appSubscription?.id) {
            merchant.shopifySubscriptionId = result.appSubscription.id;
            await merchant.save();
            console.log(`[Billing] Saved subscription ID: ${result.appSubscription.id}`);
        }

        console.log(`[Billing] ✅ Subscription created. Confirmation URL ready for ${shop}`);
        res.json({ confirmationUrl: result.confirmationUrl });

    } catch (error) {
        console.error('--- BILLING ERROR DETAIL ---');
        console.error(error.response?.data || error.message);
        res.status(500).json({
            message: 'Failed to create charge',
            detail: error.response?.data || error.message
        });
    }
});

// ============================================================
// GET /billing/confirm — Return URL after Shopify approval
// ============================================================
router.get('/confirm', async (req, res) => {
    const shop = req.shopifyShop || req.query.shop;
    const { plan, charge_id } = req.query;
    console.log(`[Billing] Confirm callback for shop: ${shop}, plan: ${plan}, charge_id: ${charge_id || 'N/A'}`);

    try {
        const merchant = await Merchant.findOne({
            shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
        });
        if (!merchant || !merchant.shopifyAccessToken) {
            return res.status(404).send('Merchant or access token not found');
        }

        // Verify subscription status via GraphQL
        if (merchant.shopifySubscriptionId) {
            try {
                const verifyQuery = {
                    query: `
                        query {
                            node(id: "${merchant.shopifySubscriptionId}") {
                                ... on AppSubscription {
                                    id
                                    status
                                    name
                                    lineItems(first: 5) {
                                        edges {
                                            node {
                                                id
                                                plan {
                                                    pricingDetails {
                                                        ... on AppUsagePricing {
                                                            terms
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    `
                };

                const verifyResponse = await axios.post(
                    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
                    verifyQuery,
                    {
                        headers: {
                            'X-Shopify-Access-Token': merchant.shopifyAccessToken,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const subscription = verifyResponse.data?.data?.node;
                console.log(`[Billing] Subscription status: ${subscription?.status} for ${shop}`);

                if (subscription?.status === 'ACTIVE') {
                    console.log(`[Billing] ✅ Subscription ACTIVE for ${shop}`);

                    // Extract the usage line item ID
                    const lineItems = subscription.lineItems?.edges || [];
                    const usageLineItem = lineItems.find(edge => edge.node.plan?.pricingDetails?.terms);
                    if (usageLineItem) {
                        merchant.shopifyUsageLineItemId = usageLineItem.node.id;
                        console.log(`[Billing] Found usage line item ID: ${usageLineItem.node.id}`);
                    }
                } else if (subscription?.status === 'DECLINED') {
                    console.log(`[Billing] ❌ Subscription DECLINED by ${shop}`);
                    return res.redirect(getBillingRedirectUrl(shop, 'declined'));
                }
            } catch (verifyErr) {
                console.warn(`[Billing] Could not verify subscription status:`, verifyErr.message);
                // Continue anyway - merchant approved, so activate
            }
        }

        // If we also received a charge_id (REST fallback), activate it
        if (charge_id) {
            try {
                await axios.post(
                    `https://${shop}/admin/api/${API_VERSION}/recurring_application_charges/${charge_id}/activate.json`,
                    {},
                    { headers: { 'X-Shopify-Access-Token': merchant.shopifyAccessToken } }
                );
                console.log(`[Billing] REST charge ${charge_id} activated as fallback.`);
            } catch (activateErr) {
                console.warn(`[Billing] REST charge activation error (non-fatal):`, activateErr.message);
            }
        }

        // Update DB
        merchant.plan = plan;
        merchant.basePlan = plan;
        merchant.billingStatus = 'active';
        merchant.usage = 0;
        merchant.usageChargeTotal = 0;
        merchant.billingCycleEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await merchant.save();
        console.log(`[Billing] ✅ Plan '${plan}' activated for ${shop}. Billing cycle ends at: ${merchant.billingCycleEnd.toISOString()}`);

        // Redirect to billing success page
        res.redirect(getBillingRedirectUrl(shop, 'success'));

    } catch (error) {
        console.error('Activation Error:', error.response?.data || error.message);
        res.status(500).send('Billing activation failed');
    }
});

// ============================================================
// GET /billing/status — Check current subscription status
// ============================================================
router.get('/status', async (req, res) => {
    const shop = req.shopifyShop || req.query.shop;
    try {
        let merchant = await Merchant.findOne({
            shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
        });

        if (!merchant) {
            console.log(`[Billing] Status requested for unknown shop: ${shop}`);
            return res.json({ plan: 'none', status: 'none', usage: 0, limit: 10 });
        }

        // Reset billing cycle if 30 days have elapsed
        merchant = await checkAndResetBillingCycle(merchant);

        // If merchant has an active plan (free or trial), allow through even without token
        // Token is only strictly needed for paid Shopify subscription plans
        const hasActivePlan = merchant.billingStatus === 'active' && merchant.plan;
        const isFreeOrTrial = merchant.plan === 'free' || merchant.plan === 'trial';

        if (!merchant.shopifyAccessToken && !hasActivePlan) {
            // No token AND no active plan — needs re-auth
            console.warn(`[Billing] Token missing for ${shop} and no active plan. Returning 401.`);
            return res.status(401).json({
                error: 'Token missing',
                message: 'Please reinstall the app.',
                needsToken: true
            });
        }

        if (!merchant.shopifyAccessToken && hasActivePlan) {
            // Has active plan but no token — return status with needsToken flag
            console.warn(`[Billing] Token missing for ${shop} but has active ${merchant.plan} plan. Returning status with needsToken flag.`);
            const planConfig = await Plan.findOne({ id: merchant.plan || 'free' });
            const baseLimit = planConfig ? planConfig.messageLimit : (merchant.trialLimit || 10);
            const limit = merchant.plan === 'trial'
                ? baseLimit
                : baseLimit + Math.max(0, (merchant.trialLimit || 10) - 10);
            return res.json({
                plan: merchant.plan || 'free',
                status: merchant.billingStatus || 'none',
                usage: merchant.usage || 0,
                limit: limit,
                needsToken: true,
                authenticated: false
            });
        }

        const planConfig = await Plan.findOne({ id: merchant.plan || 'free' });
        const baseLimit = planConfig ? planConfig.messageLimit : (merchant.trialLimit || 10);
        const limit = merchant.plan === 'trial'
            ? baseLimit
            : baseLimit + Math.max(0, (merchant.trialLimit || 10) - 10);
        const newlyInstalled = merchant.installedAt ? (Date.now() - new Date(merchant.installedAt).getTime() < 10 * 60 * 1000) : false;

        res.json({
            plan: merchant.plan || 'free',
            status: merchant.billingStatus || 'none',
            usage: merchant.usage || 0,
            limit: limit,
            isNewlyInstalled: newlyInstalled,
            hasUsagePlan: !!merchant.shopifyUsageLineItemId
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// ============================================================
// Helper: Build redirect URL after billing
// ============================================================
function getBillingRedirectUrl(shop, status) {
    const shopName = shop.replace(".myshopify.com", "");
    const route = status === 'success' ? 'billing-success' : 'dashboard?tab=billing&billing=declined';

    if (SHOPIFY_API_KEY) {
        return `https://admin.shopify.com/store/${shopName}/apps/${SHOPIFY_API_KEY}/${route}?shop=${shop}`;
    }
    const frontendUrl = process.env.FRONTEND_APP_URL || "https://whatomatic.vercel.app";
    return `${frontendUrl}/${route}?shop=${shop}`;
}

export default router;
