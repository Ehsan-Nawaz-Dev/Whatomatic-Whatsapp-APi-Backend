import { Router } from "express";
import { Merchant } from "../models/Merchant.js";
import { ActivityLog } from "../models/ActivityLog.js";
import { WhatsAppSession } from "../models/WhatsAppSession.js";
import { Template } from "../models/Template.js";
import { AutomationSetting } from "../models/AutomationSetting.js";
import { AutomationStat } from "../models/AutomationStat.js";
import { Campaign } from "../models/Campaign.js";
import { ChatButtonSettings } from "../models/ChatButtonSettings.js";
import { NotificationSettings } from "../models/NotificationSettings.js";
import { Plan } from "../models/Plan.js";
import { Lead } from "../models/Lead.js";
import { GlobalNotification } from "../models/GlobalNotification.js";
import { Admin } from "../models/Admin.js";
import { Ticket } from "../models/Ticket.js";
import { PollMessage } from "../models/PollMessage.js";


const router = Router();

// GET /api/admin/broadcast - List all global notifications
router.get("/broadcast", async (req, res) => {
    try {
        const broadcasts = await GlobalNotification.find().sort({ createdAt: -1 });
        res.json(broadcasts);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch broadcasts" });
    }
});

// POST /api/admin/broadcast - Create a new global notification
router.post("/broadcast", async (req, res) => {
    try {
        const { title, message, type, targetPlan } = req.body;
        const broadcast = await GlobalNotification.create({ title, message, type, targetPlan });
        res.json(broadcast);
    } catch (err) {
        res.status(500).json({ error: "Failed to create broadcast" });
    }
});

// DELETE /api/admin/broadcast/:id - Remove a global notification
router.delete("/broadcast/:id", async (req, res) => {
    try {
        await GlobalNotification.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete broadcast" });
    }
});

// GET /api/admin/merchants - List all merchants with connection status
router.get("/merchants", async (req, res) => {
    try {
        const merchants = await Merchant.find({ shopifyAccessToken: { $ne: null, $exists: true } }).sort({ createdAt: -1 }).lean();
        const sessions = await WhatsAppSession.find().lean();
        const plans = await Plan.find().lean();

        const planMap = plans.reduce((acc, p) => {
            acc[p.id] = p.messageLimit;
            return acc;
        }, {});

        // Map sessions to merchants
        const enrichedMerchants = merchants.map(merchant => {
            const session = sessions.find(s => s.shopDomain === merchant.shopDomain);
            // Limit is either trialLimit (for trial) or plan.messageLimit + extended trial limit surplus
            const baseLimit = merchant.plan === 'trial'
                ? (merchant.trialLimit || 10)
                : (planMap[merchant.plan || 'free'] || 50);

            const limit = merchant.plan === 'trial'
                ? baseLimit
                : baseLimit + Math.max(0, (merchant.trialLimit || 10) - 10);

            // Usage is trialUsage (for trial) or usage (for others)
            const usage = merchant.plan === 'trial'
                ? (merchant.trialUsage || 0)
                : (merchant.usage || 0);

            return {
                ...merchant,
                limit,
                usage,
                isConnected: session?.isConnected || false,
                lastConnected: session?.lastConnected,
                status: session?.status || 'disconnected'
            };
        });

        res.json(enrichedMerchants);
    } catch (err) {
        console.error("Admin: Error fetching merchants", err);
        res.status(500).json({ error: "Failed to fetch merchants" });
    }
});

// GET /api/admin/activity - Global activity log (Last 50 entries)
router.get("/activity", async (req, res) => {
    try {
        const logs = await ActivityLog.find()
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        res.json(logs);
    } catch (err) {
        console.error("Admin: Error fetching activity", err);
        res.status(500).json({ error: "Failed to fetch activity logs" });
    }
});

// POST /api/admin/login - Admin login using dynamic DB credentials
router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const admin = await Admin.findOne({ username });
        if (admin && admin.password === password) {
            res.json({ success: true, token: "admin-secret-token" });
        } else {
            res.status(401).json({ success: false, error: "Invalid credentials" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server error during login" });
    }
});

// POST /api/admin/change-password - Change admin password
router.post("/change-password", async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const admin = await Admin.findOne({ username: 'admin' });
        if (!admin) return res.status(404).json({ error: "Admin account not found" });

        if (admin.password !== currentPassword) {
            return res.status(400).json({ error: "Current password is incorrect" });
        }

        admin.password = newPassword;
        await admin.save();
        res.json({ success: true, message: "Password updated successfully" });
    } catch (err) {
        res.status(500).json({ error: "Failed to update password" });
    }
});

// GET /api/admin/tickets - Fetch all support tickets
router.get("/tickets", async (req, res) => {
    try {
        const tickets = await Ticket.find().sort({ createdAt: -1 });
        res.json(tickets);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch tickets" });
    }
});

// PUT /api/admin/tickets/:id/resolve - Resolve a support ticket (mark status as closed)
router.put("/tickets/:id/resolve", async (req, res) => {
    try {
        const ticket = await Ticket.findByIdAndUpdate(
            req.params.id,
            { status: 'closed' },
            { new: true }
        );
        if (!ticket) return res.status(404).json({ error: "Ticket not found" });
        res.json({ success: true, ticket });
    } catch (err) {
        res.status(500).json({ error: "Failed to resolve ticket" });
    }
});

// POST /api/admin/merchants/plan - Manually adjust a merchant's plan
router.post("/merchants/plan", async (req, res) => {
    try {
        const { shopDomain, plan, trialLimit } = req.body;

        if (!shopDomain) return res.status(400).json({ error: "shopDomain is required" });

        const updateData = {};
        if (plan) updateData.plan = plan;
        if (trialLimit !== undefined) updateData.trialLimit = trialLimit;

        const merchant = await Merchant.findOneAndUpdate(
            { shopDomain },
            updateData,
            { new: true }
        );

        if (!merchant) return res.status(404).json({ error: "Merchant not found" });

        res.json({ success: true, merchant });
    } catch (err) {
        console.error("Admin: Error updating merchant plan", err);
        res.status(500).json({ error: "Failed to update merchant plan" });
    }
});

// POST /api/admin/merchants/block - Toggle block status
router.post("/merchants/block", async (req, res) => {
    try {
        const { shopDomain, isActive } = req.body;
        const merchant = await Merchant.findOneAndUpdate(
            { shopDomain },
            { isActive },
            { new: true }
        );
        res.json({ success: true, isActive: merchant.isActive });
    } catch (err) {
        res.status(500).json({ error: "Failed to block" });
    }
});

// POST /api/admin/merchants/extend-trial - Add messages to trial
router.post("/merchants/extend-trial", async (req, res) => {
    try {
        const { shopDomain, extraMessages } = req.body;
        const merchant = await Merchant.findOne({ shopDomain });
        if (!merchant) return res.status(404).json({ error: "Not found" });

        merchant.trialLimit = (merchant.trialLimit || 10) + parseInt(extraMessages);
        await merchant.save();

        res.json({ success: true, newLimit: merchant.trialLimit });
    } catch (err) {
        res.status(500).json({ error: "Failed to extend trial" });
    }
});

// GET /api/admin/stats - Get subscription analytics
router.get("/stats", async (req, res) => {
    try {
        const merchants = await Merchant.find({ billingStatus: 'active', shopifyAccessToken: { $ne: null, $exists: true } }).lean();
        const plans = await Plan.find().lean();

        const planMap = plans.reduce((acc, p) => {
            acc[p.id] = p.price;
            return acc;
        }, {});

        let totalEarnings = 0;
        const planCounts = {};

        merchants.forEach(m => {
            const price = planMap[m.plan] || 0;
            totalEarnings += price;
            planCounts[m.plan] = (planCounts[m.plan] || 0) + 1;
        });

        res.json({
            totalSubscribers: merchants.length,
            totalMonthlyEarnings: totalEarnings,
            planBreakdown: planCounts
        });
    } catch (err) {
        console.error("Admin: Error fetching stats", err);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// DELETE /api/admin/merchants/:shopDomain - NUCLEAR WIPE: Delete all data for a store
router.delete("/merchants/:shopDomain", async (req, res) => {
    try {
        const { shopDomain } = req.params;
        if (!shopDomain) return res.status(400).json({ error: "shopDomain is required" });

        console.log(`[Admin] NUCLEAR DELETE triggered for: ${shopDomain}`);

        const merchant = await Merchant.findOne({ shopDomain });
        const merchantId = merchant ? merchant._id : null;

        // 1. Delete Merchant record
        await Merchant.deleteOne({ shopDomain });

        // 2. Delete WhatsApp Session
        await WhatsAppSession.deleteOne({ shopDomain });

        // 3. Delete based on merchant ID (if found) or shop domain
        if (merchantId) {
            await Template.deleteMany({ merchant: merchantId });
            await NotificationSettings.deleteMany({ merchant: merchantId });
        }

        // Delete collections using shopDomain
        await Promise.all([
            AutomationSetting.deleteMany({ shopDomain }),
            AutomationStat.deleteMany({ shopDomain }),
            Campaign.deleteMany({ shopDomain }),
            ChatButtonSettings.deleteMany({ shopDomain }),
            PollMessage.deleteMany({ shopDomain })
        ]);

        // 4. Delete Activity Logs
        if (merchantId) {
            await ActivityLog.deleteMany({ merchant: merchantId });
        }

        console.log(`[Admin] Successfully wiped all data for ${shopDomain}`);
        res.json({ success: true, message: `All data for ${shopDomain} has been deleted.` });
    } catch (err) {
        console.error("Admin: Error during nuclear delete", err);
        res.status(500).json({ error: "Failed to delete store data completely." });
    }
});

export default router;
