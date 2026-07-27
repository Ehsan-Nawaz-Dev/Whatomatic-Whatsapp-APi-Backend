import { Plan } from '../models/Plan.js';
import { Template } from '../models/Template.js';
import { Admin } from '../models/Admin.js';

export const upgradeShippingTemplates = async () => {
    try {
        const oldMessage = `Hi {{customer_name}}! 🚚\n\nGreat news! Your order {{order_number}} has been shipped!\n\n📍 Track your package: {{tracking_link}}\n\nThank you for shopping with {{store_name}}!`;
        const newMessage = `Hi {{customer_name}}! 🚚\n\nGreat news! Your order {{order_number}} has been shipped via {{courier}}!\n\n📦 Tracking Number: {{tracking_number}}\n📍 Track your package: {{tracking_link}}\n\nThank you for shopping with {{store_name}}!`;

        const result = await Template.updateMany(
            { event: "fulfillments/update", message: oldMessage },
            { $set: { message: newMessage } }
        );
        if (result.modifiedCount > 0) {
            console.log(`[Seeder] ✅ Upgraded ${result.modifiedCount} old shipping templates to include tracking number.`);
        }
    } catch (err) {
        console.error('[Seeder] ❌ Error upgrading shipping templates:', err);
    }
};

/**
 * Seeds default subscription plans if the collection is empty.
 * This ensures the billing system works on fresh installations.
 */
export const seedPlans = async () => {
    try {
        console.log('[Seeder] Syncing default plans...');
        const defaultPlans = [
            {
                id: 'free',
                name: 'Free',
                price: 0,
                messageLimit: 50,
                trialDays: 0,
                features: [
                    "Up to 50 messages/month",
                    "Automated WhatsApp Order Confirmations",
                    "Abandoned Checkout Recovery",
                    "Order Fulfillment Notifications",
                    "Real-Time Analytics & Reporting"
                ],
                isActive: true,
                isPopular: false
            },
            {
                id: 'starter',
                name: 'Starter',
                price: 4.99,
                messageLimit: 1250,
                trialDays: 3,
                features: [
                    "Up to 1,250 messages/month",
                    "Automated WhatsApp Order Confirmations",
                    "Abandoned Checkout Recovery",
                    "Order Fulfillment Notifications",
                    "Customizable Message Templates",
                    "3-Day Free Trial"
                ],
                isActive: true,
                isPopular: false
            },
            {
                id: 'growth',
                name: 'Growth',
                price: 9.99,
                messageLimit: 2500,
                trialDays: 0,
                features: [
                    "Up to 2,500 messages/month",
                    "All Starter Features",
                    "Automated Order Tag Updates",
                    "Manual Campaigns",
                    "Priority Support"
                ],
                isActive: true,
                isPopular: true
            },
            {
                id: 'professional',
                name: 'Professional',
                price: 14.99,
                messageLimit: 4250,
                trialDays: 0,
                features: [
                    "Up to 4,250 messages/month",
                    "All Growth Features",
                    "Custom Branding",
                    "Dedicated Account Manager",
                    "API Access"
                ],
                isActive: true,
                isPopular: false
            }
        ];

        for (const plan of defaultPlans) {
            await Plan.findOneAndUpdate(
                { id: plan.id },
                plan,
                { upsert: true, new: true }
            );
            console.log(`[Seeder] Synced plan: ${plan.name}`);
        }
        console.log('[Seeder] ✅ All plans successfully synchronized.');
    } catch (err) {
        console.error('[Seeder] ❌ Error syncing plans:', err);
    }
};

export const seedAdmin = async () => {
    try {
        const count = await Admin.countDocuments();
        if (count === 0) {
            await Admin.create({ username: 'admin', password: 'admin123' });
            console.log('[Seeder] ✅ Default admin credentials seeded successfully.');
        }
    } catch (err) {
        console.error('[Seeder] ❌ Error seeding admin:', err);
    }
};
