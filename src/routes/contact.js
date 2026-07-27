import { Router } from "express";
import { Contact } from "../models/Contact.js";
import { Merchant } from "../models/Merchant.js";

const router = Router();

// Helper to resolve merchant
const getMerchant = async (req) => {
  const shop = req.shopifyShop || req.query.shop || req.headers["x-shop-domain"];
  if (!shop) return null;
  return await Merchant.findOne({
    shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
  });
};

// GET /api/contact - List contacts for a merchant
router.get("/", async (req, res) => {
  try {
    const merchant = await getMerchant(req);
    if (!merchant) return res.status(400).json({ error: "Invalid shop" });

    const contacts = await Contact.find({ merchant: merchant._id })
      .sort({ updatedAt: -1 })
      .limit(200);

    // Format for frontend (rename _id to id if needed, though frontend usually handles it)
    const formatted = contacts.map(c => ({
      ...c.toObject(),
      id: c._id
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching contacts", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/contact - Create a new contact manually
router.post("/", async (req, res) => {
  try {
    const merchant = await getMerchant(req);
    if (!merchant) return res.status(400).json({ error: "Invalid shop" });

    const { name, phone, email, tags, notes } = req.body;

    // Clean phone
    const cleanPhone = phone.replace(/\D/g, '');

    // Check if contact with this phone already exists for this merchant
    const existing = await Contact.findOne({ merchant: merchant._id, phone: cleanPhone });
    if (existing) {
      return res.status(409).json({
        error: `Contact with phone number ${phone} already exists (${existing.name})`
      });
    }

    const contact = await Contact.create({
      merchant: merchant._id,
      name,
      phone: cleanPhone,
      email,
      tags,
      notes,
      source: 'manual'
    });

    res.status(201).json({ ...contact.toObject(), id: contact._id });
  } catch (err) {
    console.error("Error creating contact", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/contact/:id - Update contact
router.put("/:id", async (req, res) => {
  try {
    const merchant = await getMerchant(req);
    if (!merchant) return res.status(400).json({ error: "Invalid shop" });

    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, merchant: merchant._id },
      { $set: req.body },
      { new: true }
    );
    if (!contact) return res.status(404).json({ error: "Contact not found or unauthorized" });

    res.json({ ...contact.toObject(), id: contact._id });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/contact/:id - Delete contact
router.delete("/:id", async (req, res) => {
  try {
    const merchant = await getMerchant(req);
    if (!merchant) return res.status(400).json({ error: "Invalid shop" });

    const contact = await Contact.findOneAndDelete({ _id: req.params.id, merchant: merchant._id });
    if (!contact) return res.status(404).json({ error: "Contact not found or unauthorized" });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
