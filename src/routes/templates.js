import { Router } from "express";
import { Merchant } from "../models/Merchant.js";
import { Template } from "../models/Template.js";
import { AutomationSetting } from "../models/AutomationSetting.js";

const router = Router();

const getShopDomain = (req) => {
  if (req.shopifyShop) return req.shopifyShop;
  const shop = req.query.shop || req.headers["x-shop-domain"];
  if (!shop) return null;
  return shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
};

async function seedMissingTemplates(merchant, shopDomain) {
  try {
    const defaultTemplates = [
      {
        merchant: merchant._id,
        name: "Order Confirmation",
        event: "orders/create",
        message: `Hi {{customer_name}}! 👋\n\nThank you for your order from {{store_name}}!\n\n📦 *Order:* {{order_number}}\n🛒 *Items:* {{items_list}}\n💰 *Total:* {{grand_total}}\n📍 *Address:* {{address}}, {{city}}\n\nPlease confirm if these details are correct.`,
        enabled: true,
        isPoll: true,
        pollOptions: ["✅ Yes, Confirm", "❌ No, Cancel"]
      },
      {
        merchant: merchant._id,
        name: "Bank Transfer Confirmation",
        event: "orders/create/bank_transfer",
        message: `🏦 *Bank Transfer Instructions!*\n\nHi {{customer_name}},\n\nThank you for your order *{{order_number}}*. 🛍️\n\nTo complete your order, please transfer *{{grand_total}}* to our bank account:\n\n*Bank:* [Bank Name]\n*Account Title:* [Account Title]\n*Account/IBAN:* [Account Number]\n\nOnce transferred, please reply to this message with a screenshot/receipt of the transfer so we can confirm your order immediately! 📲\n\nThank you!\n- {{store_name}} Team`,
        enabled: false,
        isPoll: false,
        pollOptions: []
      },
      {
        merchant: merchant._id,
        name: "Order Cancelled",
        event: "orders/cancelled",
        message: `Hi {{customer_name}},\n\nYour order {{order_number}} has been cancelled.\n\nIf this was a mistake, please contact us.\n\nThank you for shopping with {{store_name}}!`,
        enabled: false,
        isPoll: false
      },
      {
        merchant: merchant._id,
        name: "Shipment Update",
        event: "fulfillments/update",
        message: `Hi {{customer_name}}! 🚚\n\nGreat news! Your order {{order_number}} has been shipped via {{courier}}!\n\n📦 Tracking Number: {{tracking_number}}\n📍 Track your package: {{tracking_link}}\n\nThank you for shopping with {{store_name}}!`,
        enabled: false,
        isPoll: false
      },
      {
        merchant: merchant._id,
        name: "Delivery Update",
        event: "fulfillments/delivered",
        message: `Hi {{customer_name}}! 🚚\n\nYour order {{order_number}} has been delivered!\n\nThank you for shopping with {{store_name}}!`,
        enabled: false,
        isPoll: false
      },
      {
        merchant: merchant._id,
        name: "Order Confirmed Reply",
        event: "orders/confirmed",
        message: `Thank you {{customer_name}}! your order {{order_number}} has been confirmed. ✅ We will notify you when it ships.`,
        enabled: false,
        isPoll: false
      },
      {
        merchant: merchant._id,
        name: "Cart Recovery",
        event: "checkouts/abandoned",
        message: `Hi {{customer_name}}, you left something in your cart! 🛒\n\nClick here to finish your purchase: {{cart_link}}\n\nThank you for visiting {{store_name}}!`,
        enabled: false,
        isPoll: false
      },
      {
        merchant: merchant._id,
        name: "Admin Order Alert",
        event: "admin-order-alert",
        message: `🔔 *New Order Alert!*\n\nOrder: {{order_number}}\nCustomer: {{customer_name}}\nTotal: {{grand_total}}\nItems: {{items_list}}\nAddress: {{address}}, {{city}}`,
        enabled: false,
        isPoll: false
      },
      {
        merchant: merchant._id,
        name: "Admin Order Confirmed Alert",
        event: "admin-confirmed-alert",
        message: `🔔 *Order Confirmed by Customer!*\n\nOrder {{order_number}} has been confirmed by customer {{customer_name}}! ✅\n\n*Items:*\n{{items_list}}\n\n*Grand Total:* {{grand_total}}\n\n*Shipping Address:*\n{{address}}, {{city}}`,
        enabled: false,
        isPoll: false
      },
      {
        merchant: merchant._id,
        name: "Cancellation Verification",
        event: "orders/cancel_verify",
        message: `Are you sure you want to cancel your order? ❌\n\nThis will stop your order from being processed immediately.`,
        enabled: false,
        isPoll: true,
        pollOptions: ["🗑️ Yes, Cancel Order", "✅ No, Keep Order"]
      }
    ];

    for (const template of defaultTemplates) {
      const existingTemplate = await Template.findOne({ merchant: merchant._id, event: template.event });
      if (!existingTemplate) {
        console.log(`[TemplatesSeed] Seeding missing template ${template.name} for shop ${shopDomain}`);
        await Template.create(template);
      }
    }

    const defaultAutomations = [
      { shopDomain: shopDomain, type: "order-confirmation", enabled: true },
      { shopDomain: shopDomain, type: "bank-transfer-confirmation", enabled: false },
      { shopDomain: shopDomain, type: "abandoned_cart", enabled: false },
      { shopDomain: shopDomain, type: "fulfillment_update", enabled: false },
      { shopDomain: shopDomain, type: "fulfillment_delivered", enabled: false },
      { shopDomain: shopDomain, type: "cancellation", enabled: false },
      { shopDomain: shopDomain, type: "cancellation-verify", enabled: false },
      { shopDomain: shopDomain, type: "order-confirmed-reply", enabled: false },
      { shopDomain: shopDomain, type: "admin-order-alert", enabled: false },
      { shopDomain: shopDomain, type: "admin-confirmed-alert", enabled: false }
    ];

    for (const automation of defaultAutomations) {
      const existingSetting = await AutomationSetting.findOne({ shopDomain, type: automation.type });
      if (!existingSetting) {
        console.log(`[TemplatesSeed] Seeding missing automation setting ${automation.type} for shop ${shopDomain}`);
        await AutomationSetting.create(automation);
      }
    }
  } catch (err) {
    console.error("[TemplatesSeed] Error seeding missing data:", err);
  }
}

// GET /api/templates
router.get("/", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    const merchant = await Merchant.findOne({ shopDomain });
    if (!merchant) return res.json([]);

    // Seed any templates or automation settings that might be missing (e.g. for existing merchants)
    await seedMissingTemplates(merchant, shopDomain);

    const templates = await Template.find({ merchant: merchant._id }).sort({ createdAt: -1 });
    res.json(templates);
  } catch (err) {
    console.error("Error fetching templates", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/templates
router.post("/", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    let merchant = await Merchant.findOne({ shopDomain });
    if (!merchant) {
      merchant = await Merchant.create({ shopDomain });
    }

    const template = await Template.create({
      merchant: merchant._id,
      name: req.body.name,
      event: req.body.event,
      message: req.body.message,
      enabled: req.body.enabled ?? true,
      isPoll: req.body.isPoll,
      pollOptions: req.body.pollOptions,
      sendingDelay: req.body.sendingDelay || 0,
    });

    res.status(201).json(template);
  } catch (err) {
    console.error("Error creating template", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/templates/:id
router.put("/:id", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    const merchant = await Merchant.findOne({ shopDomain });
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });

    const template = await Template.findOneAndUpdate(
      { _id: req.params.id, merchant: merchant._id },
      {
        name: req.body.name,
        event: req.body.event,
        message: req.body.message,
        enabled: req.body.enabled,
        isPoll: req.body.isPoll,
        pollOptions: req.body.pollOptions,
        sendingDelay: req.body.sendingDelay || 0,
      },
      { new: true },
    );

    if (!template) return res.status(404).json({ error: "Template not found or unauthorized" });

    res.json(template);
  } catch (err) {
    console.error("Error updating template", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/templates/:id
router.delete("/:id", async (req, res) => {
  try {
    const shopDomain = getShopDomain(req);
    if (!shopDomain) return res.status(400).json({ error: "Missing shop parameter" });

    const merchant = await Merchant.findOne({ shopDomain });
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });

    const template = await Template.findOneAndDelete({ _id: req.params.id, merchant: merchant._id });
    if (!template) return res.status(404).json({ error: "Template not found or unauthorized" });

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting template", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
