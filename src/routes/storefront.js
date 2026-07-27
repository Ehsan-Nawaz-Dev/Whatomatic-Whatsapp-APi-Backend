import { Router } from "express";
import { ChatButtonSettings } from "../models/ChatButtonSettings.js";
import { Merchant } from "../models/Merchant.js";

const router = Router();

// GET /api/storefront/button.js?shop=your-shop.myshopify.com
router.get("/button.js", async (req, res) => {
    let { shop } = req.query;
    if (!shop) return res.status(400).send("// Missing shop parameter");

    // Clean shop domain
    shop = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");

    try {
        console.log(`[Storefront] Serving button script for cleaned shop: ${shop}`);

        // Search for settings - using regex for robustness although cleaned shop should match
        const settings = await ChatButtonSettings.findOne({
            shopDomain: { $regex: new RegExp(`^${shop}$`, "i") }
        });

        if (!settings) {
            console.log(`[Storefront] No settings found for ${shop}, checking merchant fallback`);
            const merchant = await Merchant.findOne({ shopDomain: { $regex: new RegExp(`^${shop}$`, "i") } });

            if (!merchant) {
                return res.type("application/javascript").send("// WhatsApp button settings and merchant not found");
            }

            // Simple fallback if no specific button settings exist yet
            const fallbackPhone = merchant.whatsappNumber || merchant.phone || "";
            const script = generateScript({
                phoneNumber: fallbackPhone,
                buttonText: "Chat with us",
                position: "right",
                color: "#25D366"
            });
            return res.type("application/javascript").send(script);
        }

        if (!settings.enabled) {
            console.log(`[Storefront] Button is disabled for ${shop}`);
            return res.type("application/javascript").send("// WhatsApp button is disabled");
        }

        const script = generateScript({
            phoneNumber: settings.phoneNumber,
            buttonText: settings.buttonText,
            position: settings.position,
            color: settings.color
        });

        res.type("application/javascript").send(script);
    } catch (err) {
        console.error("Error serving storefront script:", err);
        res.status(500).send("// Internal server error");
    }
});

function generateScript({ phoneNumber, buttonText, position, color }) {
    const normalizedPhone = phoneNumber ? phoneNumber.replace(/[^\d]/g, "") : "";
    return `
(function() {
    function initWhatsAppButton() {
        if (document.getElementById('whatflow-whatsapp-button')) return;

        const container = document.createElement('div');
        container.id = 'whatflow-whatsapp-button';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.${position === 'left' ? 'left' : 'right'} = '20px';
        container.style.zIndex = '999999';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '10px';
        container.style.cursor = 'pointer';
        container.style.transition = 'all 0.3s ease';

        const link = document.createElement('a');
        const safePhone = '${normalizedPhone}';
        const safeText = ${JSON.stringify(buttonText || "Chat with us")};
        const safeColor = ${JSON.stringify(color || "#25D366")};

        link.href = 'https://wa.me/' + safePhone + '?text=' + encodeURIComponent('Hi, I have a question about my order.');
        link.target = '_blank';
        link.style.textDecoration = 'none';
        link.style.display = 'flex';
        link.style.alignItems = 'center';
        link.style.backgroundColor = safeColor;
        link.style.color = '#ffffff';
        link.style.padding = '12px 20px';
        link.style.borderRadius = '50px';
        link.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        link.style.fontWeight = 'bold';
        link.style.fontSize = '14px';
        link.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

        const icon = document.createElement('span');
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
        icon.style.marginRight = '8px';
        icon.style.display = 'flex';
        icon.style.alignItems = 'center';

        const text = document.createElement('span');
        text.innerText = safeText;

        link.appendChild(icon);
        link.appendChild(text);
        container.appendChild(link);
        document.body.appendChild(container);

        // Hover effect
        container.onmouseenter = () => { container.style.transform = 'scale(1.05)'; };
        container.onmouseleave = () => { container.style.transform = 'scale(1)'; };
    }

    if (document.readyState === 'complete') {
        initWhatsAppButton();
    } else {
        window.addEventListener('load', initWhatsAppButton);
    }
})();
    `;
}

export default router;
