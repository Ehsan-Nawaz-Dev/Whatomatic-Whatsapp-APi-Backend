import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { whatsappService } from './src/services/whatsappService.js';
import { WhatsAppSession } from './src/models/WhatsAppSession.js';

dotenv.config();

async function checkSockets() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('--- WhatsApp Service Status ---');
        console.log('Memory Sockets:', Array.from(whatsappService.sockets.keys()));

        const sessions = await WhatsAppSession.find();
        console.log('\nDB Sessions:');
        sessions.forEach(s => {
            console.log(`- ${s.shopDomain}: isConnected=${s.isConnected}, status=${s.status}`);
        });

        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkSockets();
