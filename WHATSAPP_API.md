# WhatsApp API Backend Setup

## Overview
This backend provides WhatsApp Web integration using `whatsapp-web.js` library. It supports multiple merchant accounts, QR code authentication, real-time status updates via Socket.IO, and message sending capabilities.

## Features
- ✅ Multi-tenant WhatsApp sessions (one per merchant/shop)
- ✅ QR Code authentication with real-time updates
- ✅ Session persistence using MongoDB
- ✅ Real-time connection status via Socket.IO
- ✅ Message sending capabilities
- ✅ Auto-reconnection handling
- ✅ Connection status tracking

## Architecture

### Components
1. **WhatsAppService** (`src/services/whatsappService.js`)
   - Manages WhatsApp client instances
   - Handles QR code generation and authentication
   - Provides message sending functionality
   - Emits real-time events via Socket.IO

2. **WhatsApp Routes** (`src/routes/whatsapp.js`)
   - REST API endpoints for WhatsApp operations
   - Connection management
   - Status checking
   - Message sending

3. **WhatsApp Session Model** (`src/models/WhatsAppSession.js`)
   - Stores session data in MongoDB
   - Tracks connection status
   - Stores QR codes and phone numbers

4. **Socket.IO Integration** (`src/server.js`)
   - Real-time QR code updates
   - Connection status notifications
   - Error notifications

## API Endpoints

### 1. Get Connection Status
```
GET /api/whatsapp/status?shop={shopDomain}
```

**Response:**
```json
{
  "isConnected": true,
  "status": "connected",
  "phoneNumber": "1234567890",
  "qrCode": null,
  "lastConnected": "2025-12-29T10:00:00Z"
}
```

**Status Values:**
- `disconnected` - Not connected
- `connecting` - Initializing connection
- `qr_ready` - QR code available for scanning
- `connected` - Successfully connected
- `error` - Connection error

---

### 2. Initialize Connection
```
POST /api/whatsapp/connect?shop={shopDomain}
```

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp client initialization started",
  "status": "initializing"
}
```

**Note:** After calling this endpoint, listen to Socket.IO events for QR code and connection status.

---

### 3. Disconnect WhatsApp
```
POST /api/whatsapp/disconnect?shop={shopDomain}
```

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp client disconnected successfully"
}
```

---

### 4. Get QR Code
```
GET /api/whatsapp/qr?shop={shopDomain}
```

**Response:**
```json
{
  "qrCode": "data:image/png;base64,...",
  "status": "qr_ready"
}
```

---

### 5. Send Message
```
POST /api/whatsapp/send?shop={shopDomain}
Content-Type: application/json

{
  "phoneNumber": "+1234567890",
  "message": "Hello from WhatFlow!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully"
}
```

## Socket.IO Events

### Client → Server Events

#### Join Room
```javascript
socket.emit('join', shopDomain);
```
Join a room to receive updates for a specific shop.

### Server → Client Events

#### QR Code Generated
```javascript
socket.on('qr', (data) => {
  console.log('QR Code:', data.qrCode); // Base64 image
  // Display QR code to user
});
```

#### Connected
```javascript
socket.on('connected', (data) => {
  console.log('Connected!', data.phoneNumber);
});
```

#### Disconnected
```javascript
socket.on('disconnected', (data) => {
  console.log('Disconnected:', data.reason);
});
```

#### Error
```javascript
socket.on('error', (data) => {
  console.log('Error:', data.message);
});
```

## Frontend Integration Example

### React/Next.js Example

```javascript
import io from 'socket.io-client';
import { useState, useEffect } from 'react';

function WhatsAppConnection() {
  const [socket, setSocket] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const shopDomain = 'your-shop.myshopify.com';

  useEffect(() => {
    // Connect to Socket.IO
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    // Join room for this shop
    newSocket.emit('join', shopDomain);

    // Listen for QR code
    newSocket.on('qr', (data) => {
      setQrCode(data.qrCode);
      setStatus('qr_ready');
    });

    // Listen for connection
    newSocket.on('connected', (data) => {
      setStatus('connected');
      setQrCode(null);
      console.log('Connected with:', data.phoneNumber);
    });

    // Listen for disconnection
    newSocket.on('disconnected', () => {
      setStatus('disconnected');
    });

    // Listen for errors
    newSocket.on('error', (data) => {
      setStatus('error');
      console.error('WhatsApp error:', data.message);
    });

    return () => newSocket.close();
  }, []);

  const connectWhatsApp = async () => {
    try {
      const response = await fetch(
        `http://localhost:3000/api/whatsapp/connect?shop=${shopDomain}`,
        { method: 'POST' }
      );
      const data = await response.json();
      console.log(data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const disconnectWhatsApp = async () => {
    try {
      const response = await fetch(
        `http://localhost:3000/api/whatsapp/disconnect?shop=${shopDomain}`,
        { method: 'POST' }
      );
      const data = await response.json();
      console.log(data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <div>
      <h2>WhatsApp Connection</h2>
      <p>Status: {status}</p>
      
      {qrCode && (
        <div>
          <h3>Scan this QR code with WhatsApp:</h3>
          <img src={qrCode} alt="WhatsApp QR Code" />
        </div>
      )}
      
      {status === 'disconnected' && (
        <button onClick={connectWhatsApp}>Connect WhatsApp</button>
      )}
      
      {status === 'connected' && (
        <button onClick={disconnectWhatsApp}>Disconnect WhatsApp</button>
      )}
    </div>
  );
}
```

### Sending Messages

```javascript
async function sendWhatsAppMessage(phoneNumber, message) {
  try {
    const response = await fetch(
      `http://localhost:3000/api/whatsapp/send?shop=${shopDomain}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber,
          message,
        }),
      }
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error sending message:', error);
    return { success: false, error: error.message };
  }
}

// Usage
await sendWhatsAppMessage('+1234567890', 'Hello from WhatFlow!');
```

## Installation & Setup

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment Variables
Edit `.env` file:
```env
MONGODB_URI=mongodb://127.0.0.1:27017/whatflow
PORT=3000
FRONTEND_APP_URL=http://localhost:5173
```

### 3. Start MongoDB
Make sure MongoDB is running on your system.

### 4. Start the Server
```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## Testing the Integration

### 1. Test Connection Status
```bash
curl http://localhost:3000/api/whatsapp/status?shop=test-shop.myshopify.com
```

### 2. Initialize Connection
```bash
curl -X POST http://localhost:3000/api/whatsapp/connect?shop=test-shop.myshopify.com
```

### 3. Get QR Code
```bash
curl http://localhost:3000/api/whatsapp/qr?shop=test-shop.myshopify.com
```

### 4. Send Test Message (after connection)
```bash
curl -X POST http://localhost:3000/api/whatsapp/send?shop=test-shop.myshopify.com \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+1234567890", "message": "Test message"}'
```

## Important Notes

### QR Code Authentication
1. Call `/api/whatsapp/connect` to initialize the client
2. Listen for `qr` event via Socket.IO
3. Display the QR code to the user
4. User scans with WhatsApp mobile app
5. Receive `connected` event when authenticated

### Session Persistence
- Sessions are stored using `LocalAuth` strategy
- Session data is stored in `.wwebjs_auth/` directory
- Sessions persist across server restarts
- First connection requires QR code scan
- Subsequent connections auto-authenticate

### Multi-Tenant Support
- Each shop domain gets its own WhatsApp client
- Sessions are isolated per shop
- Multiple shops can be connected simultaneously

### Phone Number Format
When sending messages, phone numbers should be in international format:
- Include country code
- Remove spaces, dashes, and parentheses
- Example: `+1234567890`

## Troubleshooting

### QR Code Not Generating
- Check if Chromium dependencies are installed
- Ensure sufficient system resources
- Check server logs for errors

### Connection Fails
- Verify WhatsApp mobile app is updated
- Check internet connection
- Clear `.wwebjs_auth/` directory and retry

### Messages Not Sending
- Verify WhatsApp connection is active
- Check phone number format
- Ensure phone number is registered on WhatsApp

## Security Considerations

1. **Shop Domain Validation**: Implement proper authentication to verify shop domains
2. **Rate Limiting**: Add rate limiting to prevent abuse
3. **Message Queue**: Consider implementing a message queue for high-volume sending
4. **Error Handling**: Implement comprehensive error handling and logging
5. **Session Security**: Protect session data and implement proper access controls

## Production Deployment

For production deployment:

1. Use environment variables for all configuration
2. Implement proper authentication and authorization
3. Add rate limiting and monitoring
4. Use a process manager (PM2) for reliability
5. Configure proper CORS settings
6. Use HTTPS for all connections
7. Implement logging and error tracking
8. Set up auto-restart on failures

## Resources

- [whatsapp-web.js Documentation](https://wwebjs.dev/)
- [Socket.IO Documentation](https://socket.io/docs/)
- [Express.js Documentation](https://expressjs.com/)
