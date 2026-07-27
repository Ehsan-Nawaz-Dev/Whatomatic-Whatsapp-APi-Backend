import mongoose from 'mongoose';

const planSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true }, // e.g., 'free', 'starter'
    name: { type: String, required: true },
    price: { type: Number, required: true },
    messageLimit: { type: Number, required: true },
    features: [{ type: String }],
    isActive: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
    shopifyVariantId: { type: String }, // Optional, if connecting to Shopify implementation details
    currency: { type: String, default: 'USD' },
    trialDays: { type: Number, default: 0 }
}, { timestamps: true });

export const Plan = mongoose.model('Plan', planSchema);
