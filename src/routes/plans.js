import { Router } from 'express';
import { Plan } from '../models/Plan.js';

const router = Router();

// Public: Get all active plans
router.get('/', async (req, res) => {
    try {
        const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
        res.json(plans);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch plans' });
    }
});

// Admin: Update a plan (Protected would normally require admin auth, skipping for now as per user context)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updatedPlan = await Plan.findOneAndUpdate({ id }, req.body, { new: true });
        res.json(updatedPlan);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update plan' });
    }
});

// Admin: Create a plan
router.post('/', async (req, res) => {
    try {
        const newPlan = new Plan(req.body);
        await newPlan.save();
        res.json(newPlan);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create plan' });
    }
});

// Admin: Delete a plan
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedPlan = await Plan.findOneAndDelete({ id });
        if (!deletedPlan) {
            return res.status(404).json({ error: 'Plan not found' });
        }
        res.json({ success: true, message: 'Plan deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete plan' });
    }
});

export default router;
