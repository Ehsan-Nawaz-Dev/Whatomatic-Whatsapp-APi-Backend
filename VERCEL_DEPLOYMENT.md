# WhatFlow Backend - Vercel Deployment Guide

## 🚀 Deploying to Vercel

### Prerequisites
- Vercel account (sign up at [vercel.com](https://vercel.com))
- Vercel CLI installed globally: `npm i -g vercel`

### Deployment Steps

1. **Login to Vercel**
   ```bash
   vercel login
   ```

2. **Deploy to Production**
   ```bash
   vercel --prod
   ```

3. **Configure Environment Variables**
   
   After deployment, add these environment variables in Vercel Dashboard:
   - Go to your project → Settings → Environment Variables
   - Add the following:
     - `DATABASE_URL` - Your MongoDB connection string
     - `FRONTEND_APP_URL` - Your frontend URL
     - `PORT` - Leave blank (Vercel sets this automatically)
     - `WHATSAPP_ACCESS_TOKEN` - Your WhatsApp Cloud API token
     - `WHATSAPP_PHONE_NUMBER_ID` - Your WhatsApp phone number ID
     - `WHATSAPP_BUSINESS_ACCOUNT_ID` - Your WhatsApp business account ID
     - Any other environment variables from your `.env` file

4. **Redeploy After Adding Variables**
   ```bash
   vercel --prod
   ```

### Testing Your Deployment

After deployment, test these endpoints:

- **Health Check**: `https://your-app.vercel.app/health`
- **Root**: `https://your-app.vercel.app/`
- **API Routes**: `https://your-app.vercel.app/api/...`

### Important Notes

⚠️ **Socket.IO Limitation**: Vercel's serverless platform doesn't support WebSocket connections reliably. The Socket.IO features will only work when running locally.

**For production with Socket.IO**, consider:
- [Railway](https://railway.app) - Full WebSocket support
- [Render](https://render.com) - Free tier with WebSocket support  
- [Heroku](https://heroku.com) - Traditional hosting with WebSocket support
- [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform)

### Local Development

Run locally (with full Socket.IO support):
```bash
npm run dev
```

The server will run on `http://localhost:5000` with all features including Socket.IO.

---

## 📁 Project Structure

```
backend/
├── api/
│   └── index.js          # Vercel serverless function entry point
├── src/
│   ├── server.js         # Main Express app (exports for serverless)
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   ├── models/           # Database models
│   └── config/           # Configuration files
├── vercel.json           # Vercel configuration
└── package.json          # Dependencies and scripts
```

## 🔧 How It Works

1. **vercel.json** - Routes all requests to `api/index.js`
2. **api/index.js** - Serverless function that imports and exports the Express app
3. **src/server.js** - Express app that conditionally starts server (local) or exports app (serverless)
4. When deployed to Vercel, `VERCEL=1` environment variable prevents Socket.IO initialization
5. When running locally, full server with Socket.IO starts normally
