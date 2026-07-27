import { whatsappCloudService } from "./whatsappCloudService.js";
import { Campaign } from "../models/Campaign.js";

class CampaignService {
    async sendCampaign(campaignId) {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) return;

        campaign.status = "sending";
        await campaign.save();

        const { shopDomain, contacts, message } = campaign;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];

            // Small delay between requests to be polite (1-2 seconds for Cloud API)
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            try {
                // Replace placeholders
                let personalizedMessage = message.replace(/{{name}}/g, contact.name || "");

                let result;
                if (campaign.isPoll && campaign.pollOptions?.length > 0) {
                    const buttons = campaign.pollOptions.map((opt, idx) => ({ id: `poll_${idx}`, title: opt }));
                    result = await whatsappCloudService.sendInteractiveButtonsMessage(shopDomain, contact.phone, personalizedMessage, buttons);
                } else {
                    result = await whatsappCloudService.sendTextMessage(shopDomain, contact.phone, personalizedMessage);
                }

                if (result.success) {
                    contact.status = "sent";
                    campaign.sentCount += 1;
                } else {
                    contact.status = "failed";
                    contact.error = result.error;
                }
            } catch (err) {
                contact.status = "failed";
                contact.error = err.message;
            }

            // Save progress after each message send
            await campaign.save();
        }

        campaign.status = "completed";
        await campaign.save();
    }
}

export const campaignService = new CampaignService();
