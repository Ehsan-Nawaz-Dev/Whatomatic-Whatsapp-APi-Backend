import { Router } from "express";
import { ActivityLog } from "../models/ActivityLog.js";
import { Merchant } from "../models/Merchant.js";
import { whatsappCloudService } from "../services/whatsappCloudService.js";
import { shopifyService } from "../services/shopifyService.js";

const router = Router();

// Endpoint receiving incoming WhatsApp webhook events
router.post("/", async (req, res) => {
  try {
    const payload = req.body;

    const { pollResponse, shop, customerPhone } = payload;

    if (pollResponse && pollResponse.selectedOptions && pollResponse.selectedOptions.length > 0) {
      const selectedOption = pollResponse.selectedOptions[0];
      const merchant = await Merchant.findOne({ shopDomain: shop });

      if (merchant) {
        let replyText = "";
        let tagToAdd = "";

        const isConfirm = selectedOption.toLowerCase().includes("confirm") ||
          selectedOption.toLowerCase().includes("yes") ||
          selectedOption.includes("✅");
        const isCancel = selectedOption.toLowerCase().includes("cancel") ||
          selectedOption.toLowerCase().includes("no") ||
          selectedOption.includes("❌");

        const getTagWithEmoji = (tag, defaultTag, emoji) => {
          const finalTag = tag || defaultTag;
          if (finalTag.includes(emoji)) return finalTag;
          if (/[\u{1F300}-\u{1F9FF}]/u.test(finalTag)) return finalTag;
          return `${emoji} ${finalTag}`;
        };

        if (isConfirm) {
          replyText = merchant.orderConfirmReply || "Your order is confirmed, thank you! ✅";
          tagToAdd = getTagWithEmoji(merchant.orderConfirmTag, "Order Confirmed", "✅");
        } else if (isCancel) {
          replyText = merchant.orderCancelReply || "Your order has been cancelled. ❌";
          tagToAdd = getTagWithEmoji(merchant.orderCancelTag, "Order Cancelled", "❌");
        }

        if (tagToAdd) {
          const log = await ActivityLog.findOne({
            merchant: merchant._id,
            customerPhone: new RegExp(customerPhone.slice(-10)),
            type: "pending"
          }).sort({ createdAt: -1 });

          if (log && log.orderId) {
            const getTagVariants = (tag, emoji) => {
              if (!tag) return [];
              const variants = [tag];
              if (emoji && !tag.includes(emoji)) variants.push(`${emoji} ${tag}`);
              return variants;
            };

            const pendingTags = [
              ...getTagVariants(merchant.pendingConfirmTag, "🕒"),
              "Pending Confirmation", "Pending Order Confirmation"
            ];
            const cancelTags = [
              ...getTagVariants(merchant.orderCancelTag, "❌"),
              "Order Cancelled", "Order Cancel By customer"
            ];
            const confirmTags = [
              ...getTagVariants(merchant.orderConfirmTag, "✅"),
              "Order Confirmed"
            ];

            const tagsToRemove = [...new Set(isConfirm
              ? [...pendingTags, ...cancelTags]
              : [...pendingTags, ...confirmTags]
            )];

            await shopifyService.addOrderTag(shop, merchant.shopifyAccessToken, log.orderId, tagToAdd, tagsToRemove);

            log.message = `Customer voted ${selectedOption} 📊`;
            await log.save();
          }
        }

        if (replyText) {
          await whatsappCloudService.sendTextMessage(shop, customerPhone, replyText);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Error handling WhatsApp webhook", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
