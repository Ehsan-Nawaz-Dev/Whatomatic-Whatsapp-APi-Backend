import { whatsappCloudService } from "./src/services/whatsappCloudService.js";
import dotenv from "dotenv";

dotenv.config();

async function testWhatsAppCloudAPI() {
    console.log("------------------------------------------");
    console.log("🚀 WhatsApp Cloud API Configuration Test");
    console.log("------------------------------------------");

    const config = {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        recipient: process.env.TEST_RECIPIENT_NUMBER
    };

    const missingFields = Object.entries(config)
        .filter(([key, value]) => !value)
        .map(([key]) => key);

    if (missingFields.length > 0) {
        console.error("❌ Error: Missing configuration in .env file:");
        missingFields.forEach(field => {
            const envVar = field === 'accessToken' ? 'WHATSAPP_ACCESS_TOKEN' :
                field === 'phoneNumberId' ? 'WHATSAPP_PHONE_NUMBER_ID' :
                    field === 'businessAccountId' ? 'WHATSAPP_BUSINESS_ACCOUNT_ID' :
                        'TEST_RECIPIENT_NUMBER';
            console.error(`   - ${envVar}`);
        });
        console.log("\nPlease add these to your .env file and try again.");
        return;
    }

    console.log("✅ All required environment variables are present.");
    console.log(`📡 Sending test message to: ${config.recipient}`);

    const result = await whatsappCloudService.sendTextMessage(
        config.recipient,
        "Hello! This is a test message from your WhatsApp Cloud API integration. 🚀"
    );

    if (result.success) {
        console.log("✅ Success! Message sent.");
        console.log("Message ID:", result.messageId);
    } else {
        console.error("❌ Failed to send message.");
        console.error("Error:", result.error);
        if (result.details) {
            console.error("Details:", JSON.stringify(result.details, null, 2));
        }
    }
}

testWhatsAppCloudAPI().catch(err => {
    console.error("An unexpected error occurred during the test:", err);
});
