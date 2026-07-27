import { DeferredDelivery } from "../models/DeferredDelivery.js";
import { Merchant } from "../models/Merchant.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { shopifyService } from "./shopifyService.js";
import { automationService } from "./automationService.js";

/**
 * Called when a delivery receipt (✓✓) arrives for a message that was queued
 * on WhatsApp's servers because the customer's phone was offline at send time.
 * Completes everything that was intentionally skipped until real delivery:
 * usage count, billing, Shopify "Pending Confirmation" tag and dashboard status.
 */
export async function completeDeferredDelivery(messageKeyId) {
    // findOneAndDelete = atomic claim, so duplicate receipts can't double-count
    const record = await DeferredDelivery.findOneAndDelete({ messageKeyId });
    if (!record) return;

    const { shopDomain, orderId, activityId, kind } = record;
    console.log(`[DeferredDelivery] ✅✅ Late delivery confirmed for ${shopDomain}, order ${orderId} (msg ${messageKeyId}). Counting & tagging now...`);

    try {
        const merchant = await Merchant.findOne({ shopDomain });
        if (!merchant) return;

        // 1. Count the message now that it actually reached the customer
        const incMerchant = await Merchant.findOneAndUpdate(
            { shopDomain },
            { $inc: { usage: 1, trialUsage: merchant.plan === "trial" ? 1 : 0 } },
            { new: true }
        );
        import("./billingService.js").then(({ checkAndChargeUsage }) => {
            checkAndChargeUsage(incMerchant);
        }).catch(err => console.error("[DeferredDelivery] Billing service error:", err));

        await automationService.trackSent(shopDomain, kind || "order-confirmation");

        // 2. Tag the order as pending confirmation (same logic as the webhook)
        if (orderId && merchant.shopifyAccessToken) {
            const formatTag = (tag, defaultText, emoji) => {
                const final = tag || defaultText;
                if (final.includes(emoji)) return final;
                if (/[\u{1F300}-\u{1F9FF}]/u.test(final)) return final;
                return `${emoji} ${final}`;
            };
            const pendingTag = formatTag(merchant.pendingConfirmTag, "Pending Confirmation", "🕒");
            const tagsToRemove = [
                merchant.orderConfirmTag,
                merchant.orderCancelTag,
                "Order Confirmed",
                "Order Cancelled",
                "Order Cancel By customer",
                "✅ Order Confirmed",
                "❌ Order Cancelled"
            ].filter(t => t && t !== pendingTag);

            const tagResult = await shopifyService.addOrderTag(shopDomain, merchant.shopifyAccessToken, orderId, pendingTag, tagsToRemove);
            console.log(`[DeferredDelivery] Tagging result for order ${orderId}:`, tagResult);
        }

        // 3. Flip the dashboard activity to the normal "sent" state
        if (activityId) {
            const activity = await ActivityLog.findById(activityId);
            if (activity) {
                activity.type = "pending";
                activity.message = "WhatsApp Message Sent ✅ (Awaiting Customer)";
                activity.errorMessage = null;
                await activity.save();
            }
        }

        console.log(`[DeferredDelivery] Completed order ${orderId} for ${shopDomain}`);
    } catch (err) {
        console.error(`[DeferredDelivery] Error completing ${messageKeyId}:`, err.message);
    }
}
