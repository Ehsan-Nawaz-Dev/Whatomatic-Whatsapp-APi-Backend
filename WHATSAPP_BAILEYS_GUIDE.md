# WhatsApp Baileys Integration Guideline

We have migrated from `whatsapp-web.js` to `@whiskeysockets/baileys`. This migration provides a more lightweight and robust connection without requiring a full Headless Chrome instance.

## How to use Pairing Code

The pairing code method allows you to link a WhatsApp account without scanning a QR code. Instead, you enter an 8-character code on your phone.

### 1. Request a Pairing Code
Call the `POST /api/whatsapp/pair` endpoint:

**Request:**
```json
{
  "shop": "your-shop.myshopify.com",
  "phone": "+1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "pairingCode": "ABC123XY"
}
```

### 2. Enter Code on Phone
1. Open WhatsApp on your phone.
2. Go to **Settings** > **Linked Devices**.
3. Tap **Link a Device**.
4. Tap **Link with phone number instead**.
5. Enter the 8-character code displayed by the API.

## API Endpoints

- **`GET /api/whatsapp/status`**: Check the current connection status.
- **`POST /api/whatsapp/connect`**: Initialize a standard connection (generates QR code).
- **`POST /api/whatsapp/pair`**: Initialize a connection via phone number pairing.
- **`POST /api/whatsapp/disconnect`**: Log out and clear the session.
- **`POST /api/whatsapp/send`**: Send a message.

## Session Storage
Sessions are stored in the `auth_info/[shopDomain]` directory. This allows the connection to automatically restore when the server restarts.
