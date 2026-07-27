
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Plan } from '../src/models/Plan.js';

dotenv.config();

const plans = [
    {
        id: "free",
        name: "Free",
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
        isPopular: false
    },
    {
        id: "starter",
        name: "Starter",
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
        isPopular: false
    },
    {
        id: "growth",
        name: "Growth",
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
        isPopular: true
    },
    {
        id: "professional",
        name: "Professional",
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
        isPopular: false
    }
];

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        for (const plan of plans) {
            await Plan.findOneAndUpdate(
                { id: plan.id },
                plan,
                { upsert: true, new: true }
            );
            console.log(`Synced plan: ${plan.name}`);
        }

        console.log('✅ Plans seeded successfully!');
        await mongoose.disconnect();
    } catch (error) {
        console.error('Error seeding plans:', error);
    }
};

seed();
