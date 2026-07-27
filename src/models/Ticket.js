import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    shopDomain: { type: String }
}, { timestamps: true });

export const Ticket = mongoose.model('Ticket', ticketSchema);
