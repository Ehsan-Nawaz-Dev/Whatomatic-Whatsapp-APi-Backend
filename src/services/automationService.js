import { AutomationStat } from "../models/AutomationStat.js";

class AutomationService {
    async trackSent(shopDomain, type) {
        try {
            await AutomationStat.findOneAndUpdate(
                { shopDomain, type },
                { $inc: { sent: 1 } },
                { upsert: true, new: true }
            );
        } catch (err) {
            console.error(`Error tracking sent automation for ${shopDomain}:`, err);
        }
    }

    async trackRecovered(shopDomain, revenue = 0) {
        try {
            await AutomationStat.findOneAndUpdate(
                { shopDomain, type: "abandoned_cart" },
                { $inc: { recovered: 1, revenue: revenue } },
                { upsert: true, new: true }
            );
        } catch (err) {
            console.error(`Error tracking recovered cart for ${shopDomain}:`, err);
        }
    }
}

export const automationService = new AutomationService();
