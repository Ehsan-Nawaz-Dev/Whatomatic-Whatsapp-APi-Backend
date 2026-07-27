export const replacePlaceholders = (template, data) => {
    if (!template) return "";
    const { order, merchant } = data;
    const findValue = (values) => values.find(v => v !== null && v !== undefined && v !== "") || "";

    // Robust Extraction with additional fallbacks
    // Note: Some Shopify stores don't send address1 or city in webhooks
    const address = findValue([
        order.shipping_address?.address1,
        order.shipping_address?.address2,
        order.billing_address?.address1,
        order.billing_address?.address2,
        order.customer?.default_address?.address1,
        order.order?.shipping_address?.address1,
        order.order?.billing_address?.address1,
        // Fallback to country if no street address
        order.shipping_address?.country,
        order.billing_address?.country,
        order.customer?.default_address?.country
    ]) || "Address not provided";

    const city = findValue([
        order.shipping_address?.city,
        order.billing_address?.city,
        order.customer?.default_address?.city,
        order.order?.shipping_address?.city,
        order.order?.billing_address?.city,
        // Fallback to province or country if no city
        order.shipping_address?.province,
        order.billing_address?.province,
        order.shipping_address?.country,
        order.billing_address?.country,
        order.customer?.default_address?.country
    ]) || "City not provided";

    // DEBUG: Log the actual address objects to see what's available
    console.log(`[PlaceholderHelper] DEBUG - shipping_address:`, JSON.stringify(order.shipping_address || null));
    console.log(`[PlaceholderHelper] DEBUG - billing_address:`, JSON.stringify(order.billing_address || null));
    console.log(`[PlaceholderHelper] DEBUG - customer.default_address:`, JSON.stringify(order.customer?.default_address || null));

    const rawPrice = findValue([
        order.total_price,
        order.current_total_price,
        order.subtotal_price,
        order.total_line_items_price,
        order.total_price_set?.shop_money?.amount,
        order.current_total_price_set?.shop_money?.amount,
        order.order?.total_price,
        order.order?.current_total_price
    ]) || "0.00";

    const price = typeof rawPrice === 'number' ? rawPrice.toFixed(2) : rawPrice;
    const currency = order.currency || order.presentment_currency || order.order?.currency || merchant?.currency || "";

    console.log(`[PlaceholderHelper] DEBUG - Price extracted: ${currency} ${price} (raw: ${rawPrice})`);
    const customerPhone = order.customer?.phone || order.shipping_address?.phone || order.billing_address?.phone || order.phone || "";

    // Extract customer name: prioritize shipping/billing (checkout entry) over account name
    const getCustomerName = () => {
        if (order.shipping_address?.first_name) {
            return `${order.shipping_address.first_name} ${order.shipping_address.last_name || ""}`.trim();
        }
        if (order.billing_address?.first_name) {
            return `${order.billing_address.first_name} ${order.billing_address.last_name || ""}`.trim();
        }
        if (order.customer?.first_name) {
            return `${order.customer.first_name} ${order.customer.last_name || ""}`.trim();
        }
        return order.shipping_address?.name || order.billing_address?.name || "Customer";
    };
    const resolvedCustomerName = getCustomerName();

    // Extract customer first name
    const getCustomerFirstName = () => {
        const firstName = order.shipping_address?.first_name || 
                          order.billing_address?.first_name || 
                          order.customer?.first_name;
        if (firstName) {
            return firstName.trim();
        }
        // Fallback to splitting resolvedCustomerName by space
        return resolvedCustomerName.split(" ")[0] || "Customer";
    };
    const resolvedCustomerFirstName = getCustomerFirstName();

    console.log(`[PlaceholderHelper] Extracted values:`, {
        address,
        city,
        price,
        currency,
        customerName: resolvedCustomerName,
        customerFirstName: resolvedCustomerFirstName
    });

    const placeholders = {
        "{{store_name}}": merchant?.storeName || merchant?.shopDomain || "",
        "{{order_number}}": order.name || order.order_number || `#${order.id || order.order_id}`,
        "{{customer_name}}": resolvedCustomerName,
        "{{first_name}}": resolvedCustomerFirstName,
        "{{customer_first_name}}": resolvedCustomerFirstName,
        "{{order_id}}": (order.id || order.order_id)?.toString() || "",
        "{{cart_link}}": order.abandoned_checkout_url || order.checkout_url || "",

        // Price placeholders
        "{{grand_total}}": `${currency} ${price}`.trim(),
        "{{price}}": `${currency} ${price}`.trim(),
        "{{total_price}}": `${currency} ${price}`.trim(),

        // Address placeholders
        "{{address}}": address,
        "{{shipping_address}}": address,
        "{{city}}": city,

        // Contact placeholders
        "{{phone}}": customerPhone,
        "{{customer_phone}}": customerPhone,

        // Order details
        "{{items_list}}": (order.line_items || order.order?.line_items || []).map(item => `${item.title} x ${item.quantity}`).join(", "),
    };

    const trackingLink = order.tracking_url || order.tracking_urls?.[0] || order.fulfillments?.[0]?.tracking_url || order.fulfillments?.[0]?.tracking_urls?.[0] || "";
    const trackingNumber = order.tracking_number || order.tracking_numbers?.[0] || order.fulfillments?.[0]?.tracking_number || order.fulfillments?.[0]?.tracking_numbers?.[0] || "";
    const courier = order.tracking_company || order.fulfillments?.[0]?.tracking_company || "";

    const extendedPlaceholders = {
        ...placeholders,
        "{{tracking_link}}": trackingLink,
        "{{tracking_number}}": trackingNumber,
        "{{courier}}": courier,
        "{{courier_name}}": courier
    };

    let message = template;

    // Filter out lines containing empty tracking placeholders for SAAS/digital products
    let lines = message.split(/\r?\n/);
    lines = lines.filter(line => {
        if (!trackingLink && line.includes("{{tracking_link}}")) return false;
        if (!trackingNumber && line.includes("{{tracking_number}}")) return false;
        if (!courier && (line.includes("{{courier}}") || line.includes("{{courier_name}}"))) return false;
        return true;
    });
    message = lines.join("\n");

    for (const [placeholder, value] of Object.entries(extendedPlaceholders)) {
        // Safe replacement for all occurrences
        message = message.split(placeholder).join(String(value || ""));
    }

    // Clean up consecutive blank lines (reduce multiple newlines to max 2 consecutive newlines)
    message = message.replace(/\n{3,}/g, "\n\n").trim();

    return message;
};
