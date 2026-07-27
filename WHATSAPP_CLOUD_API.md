# WhatsApp Business Cloud API - Quick Start Guide

## 🚀 Setup Instructions

### Step 1: Add Your Credentials

Open `.env` and add your WhatsApp Business API credentials:

```env
# WhatsApp Business Cloud API
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321098765
WHATSAPP_VERIFY_TOKEN=my_secure_custom_token_123
```

**Where to find these:**
- Go to [Meta Developer Console](https://developers.facebook.com/)
- Select your app → WhatsApp → API Setup
- Copy your Access Token, Phone Number ID, and Business Account ID

---

## 📡 API Endpoints

All endpoints are available at: `http://localhost:3000/api/whatsapp-cloud/`

### 1. Send Text Message
```bash
POST /api/whatsapp-cloud/send
Content-Type: application/json

{
  "to": "+1234567890",
  "message": "Hello from WhatsApp Cloud API!"
}
```

**Example using curl:**
```bash
curl -X POST http://localhost:3000/api/whatsapp-cloud/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "message": "Hello!"}'
```

---

### 2. Send Template Message
```bash
POST /api/whatsapp-cloud/send-template
Content-Type: application/json

{
  "to": "+1234567890",
  "templateName": "hello_world",
  "languageCode": "en"
}
```

**With parameters:**
```json
{
  "to": "+1234567890",
  "templateName": "order_confirmation",
  "languageCode": "en",
  "components": [
    {
      "type": "body",
      "parameters": [
        {
          "type": "text",
          "text": "John"
        },
        {
          "type": "text",
          "text": "ORD-12345"
        }
      ]
    }
  ]
}
```

---

### 3. Send Image Message
```bash
POST /api/whatsapp-cloud/send-image
Content-Type: application/json

{
  "to": "+1234567890",
  "imageUrl": "https://example.com/image.jpg",
  "caption": "Check out this image!"
}
```

---

### 4. Get Message Templates
```bash
GET /api/whatsapp-cloud/templates
```

Returns all your approved message templates.

---

### 5. Webhook Endpoints

**Webhook Verification (GET)**
```bash
GET /api/whatsapp-cloud/webhooks?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE
```

**Receive Messages (POST)**
```bash
POST /api/whatsapp-cloud/webhooks
```

---

## 🔧 Frontend Integration

### React/Next.js Example

```javascript
// Send a text message
async function sendWhatsAppMessage(phoneNumber, message) {
  try {
    const response = await fetch('http://localhost:3000/api/whatsapp-cloud/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phoneNumber,
        message: message,
      }),
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('Message sent!', data.messageId);
    } else {
      console.error('Error:', data.error);
    }
    
    return data;
  } catch (error) {
    console.error('Network error:', error);
  }
}

// Usage
await sendWhatsAppMessage('+1234567890', 'Hello from my app!');
```

### Send Template Message

```javascript
async function sendTemplateMessage(phoneNumber, templateName) {
  const response = await fetch('http://localhost:3000/api/whatsapp-cloud/send-template', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: phoneNumber,
      templateName: templateName,
      languageCode: 'en',
    }),
  });
  
  return await response.json();
}

await sendTemplateMessage('+1234567890', 'hello_world');
```

### Get Available Templates

```javascript
async function getTemplates() {
  const response = await fetch('http://localhost:3000/api/whatsapp-cloud/templates');
  const data = await response.json();
  
  if (data.success) {
    console.log('Available templates:', data.templates);
  }
  
  return data.templates;
}
```

---

## 🔔 Webhook Setup

### 1. Configure Webhook URL in Meta Console

1. Go to Meta Developer Console → Your App → WhatsApp → Configuration
2. Edit "Webhook" settings
3. Enter your webhook URL: `https://your-domain.com/api/whatsapp-cloud/webhooks`
4. Enter your Verify Token (same as `WHATSAPP_VERIFY_TOKEN` in .env)
5. Subscribe to `messages` webhook field

### 2. For Local Development (using ngrok)

```bash
# Install ngrok if needed
npm install -g ngrok

# Start ngrok tunnel
ngrok http 3000

# Use the https URL provided by ngrok as your webhook URL
# Example: https://abc123.ngrok.io/api/whatsapp-cloud/webhooks
```

### 3. Process Incoming Messages

The backend automatically processes incoming messages. You can extend the webhook handler in `src/routes/whatsapp-cloud.js`:

```javascript
// In POST /webhooks route
if (result.success) {
  const messageData = result.data;
  
  // Add your business logic here
  // Examples:
  // - Save to database
  // - Send automated reply
  // - Trigger notification
  // - Update customer record
  
  console.log('Received message:', messageData);
}
```

---

## 📱 Testing

### Test Message Sending

```bash
# Test text message
curl -X POST http://localhost:3000/api/whatsapp-cloud/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+YOUR_PHONE_NUMBER", "message": "Test message from Cloud API"}'

# Expected response:
# {
#   "success": true,
#   "messageId": "wamid.XXX...",
#   "message": "Message sent successfully"
# }
```

### Test Template Retrieval

```bash
curl http://localhost:3000/api/whatsapp-cloud/templates

# Expected response:
# {
#   "success": true,
#   "templates": [
#     {
#       "name": "hello_world",
#       "language": "en",
#       "status": "APPROVED",
#       ...
#     }
#   ]
# }
```

---

## 🔐 Security Best Practices

1. **Never commit credentials** - Your `.env` file is already in `.gitignore`
2. **Use environment variables** - Never hardcode tokens in code
3. **Validate webhook signatures** - Verify requests are from Meta (can be added)
4. **Rate limiting** - Consider adding rate limits to prevent abuse
5. **HTTPS in production** - Always use HTTPS for webhooks

---

## 🐛 Troubleshooting

### Error: "Invalid access token"
- Check your `WHATSAPP_ACCESS_TOKEN` in `.env`
- Verify token hasn't expired
- Generate a new token from Meta Developer Console

### Error: "Invalid phone number"
- Use international format: `+[country_code][number]`
- Remove spaces, dashes, parentheses
- Example: `+1234567890` not `(123) 456-7890`

### Webhook not receiving messages
- Verify webhook URL is accessible from internet (use ngrok for local testing)
- Check verify token matches in Meta Console and `.env`
- Ensure webhook is subscribed to "messages" field
- Check server logs for incoming webhook calls

### Template message fails
- Ensure template is approved in Meta Business Manager
- Check template name matches exactly (case-sensitive)
- Verify language code is correct
- Check parameter count matches template requirements

---

## 📚 Additional Resources

- [WhatsApp Cloud API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Message Templates Guide](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Webhook Setup](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [API Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference)

---

## ✅ Quick Checklist

- [ ] Added credentials to `.env` file
- [ ] Restarted server: `npm run dev`
- [ ] Tested sending a message to your phone
- [ ] Retrieved available templates
- [ ] Set up webhook (optional, for receiving messages)
- [ ] Tested receiving messages (if webhook configured)
