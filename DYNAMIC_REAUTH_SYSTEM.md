# Dynamic Shopify Re-Authorization System

## Overview
This system **automatically detects** when ANY merchant's Shopify access token expires and prompts them to reconnect - completely dynamic for your SaaS platform.

---

## 🔧 Components

### Backend (`/api/settings/auth-status`)
**Endpoint**: `GET /api/settings/auth-status?shop={shop}.myshopify.com`

**Returns**:
```json
{
  "authenticated": false,
  "needsReauth": true,
  "reason": "Invalid or expired Shopify access token",
  "detectedAt": "2026-02-10T11:46:09Z",
  "reauthUrl": "https://api.whatomatic.com/api/auth/shopify?shop=ezone-9374.myshopify.com"
}
```

### Frontend Component (`ReAuthBanner.tsx`)
- **Dynamic**: Works for ANY merchant based on `?shop=` parameter
- **Auto-refreshes**: Checks auth status every 30 seconds
- **Conditional**: Only displays when `needsReauth: true`
- **Action button**: Redirects to OAuth flow for re-authorization

---

## 🎯 How It Works

### 1. **Error Detection** (Automatic)
When any Shopify API call fails with `401 Unauthorized`:
```
[ShopifyService] 🚨 AUTH ERROR DETECTED for shop.myshopify.com
[ShopifyService] Merchant marked for re-authorization
```

Database updated:
```javascript
{
  needsReauth: true,
  reauthReason: "Invalid or expired Shopify access token",
  reauthDetectedAt: new Date()
}
```

### 2. **Frontend Detection** (Dynamic)
The `ReAuthBanner` component automatically:
1. Gets `shop` parameter from URL (`?shop=merchant.myshopify.com`)
2. Calls `/api/settings/auth-status?shop=merchant.myshopify.com`
3. Checks if `needsReauth: true`
4. Displays banner if token is invalid

### 3. **Merchant Action**
User clicks **"Reconnect Shopify Now"** button:
1. Redirected to: `https://api.whatomatic.com/api/auth/shopify?shop=merchant.myshopify.com`
2. Shopify authorization page appears
3. Merchant approves permissions
4. Backend receives new token
5. Database updated:
   ```javascript
   {
     shopifyAccessToken: "shpat_new_token_here",
     needsReauth: false,
     reauthReason: null,
     reauthDetectedAt: null
   }
   ```
6. Banner disappears automatically

---

## 📊 Flow Diagram

```
Order Webhook → Invalid Token → 401 Error
                                    ↓
                        Mark merchant.needsReauth = true
                                    ↓
                        Frontend checks auth-status
                                    ↓
                        Banner appears: "Reconnect Shopify"
                                    ↓
                        User clicks button
                                    ↓
                        OAuth flow starts
                                    ↓
                        New token saved
                                    ↓
                        needsReauth = false
                                    ↓
                        Banner disappears ✅
```

---

## 🌐 SaaS Multi-Tenancy

### Merchant A: `shop-a.myshopify.com`
- Token expires → Banner shows: "Reconnect for shop-a.myshopify.com"
- No impact on other merchants

### Merchant B: `shop-b.myshopify.com`
- Token is valid → No banner
- Working normally

### Merchant C: `shop-c.myshopify.com`
- Token expires → Banner shows: "Reconnect for shop-c.myshopify.com"
- Independent of A and B

**Each merchant sees their own status dynamically based on the `?shop=` URL parameter.**

---

## 🚀 Installation

### Backend
✅ Already implemented:
- `/api/settings/auth-status` endpoint
- Auto-detection in `ShopifyService`
- `needsReauth` field in `Merchant` model

### Frontend
✅ Newly added:
- `ReAuthBanner.tsx` component
- Integrated into `Dashboard.tsx`
- Auto-refresh every 30 seconds

---

## 🧪 Testing

### Test Scenario 1: Force Token Expiry
```javascript
// In MongoDB
db.merchants.updateOne(
  { shopDomain: "test-shop.myshopify.com" },
  { 
    $set: { 
      shopifyAccessToken: "invalid_token_12345",
      needsReauth: true,
      reauthReason: "Test: Simulated token expiry"
    }
  }
);
```

Visit dashboard → Banner appears → Click "Reconnect" → OAuth flow completes → Banner disappears

### Test Scenario 2: Real Token Expiry
1. Trigger a Shopify webhook (create test order)
2. System detects 401 error automatically
3. Marks merchant for reauth
4. Banner appears in dashboard
5. Merchant reconnects
6. System resumes normal operation

---

## 🔒 Security Features

- **HMAC Verification**: All webhooks verified
- **OAuth Flow**: Standard Shopify OAuth 2.0
- **Token Storage**: Encrypted in MongoDB
- **Per-Merchant Isolation**: Each merchant has independent auth status

---

## 📝 Merchant Experience

### Before Fix:
❌ Orders fail silently  
❌ Errors in backend logs  
❌ No notifications sent  
❌ Merchant doesn't know there's an issue   

### After Fix:
✅ Prominent banner at top of dashboard  
✅ Clear error message: "Shopify Connection Lost"  
✅ One-click "Reconnect" button  
✅ Automatic detection and recovery  
✅ Works for ALL merchants dynamically  

---

## 💡 Future Enhancements

- [ ] Email notification when token expires
- [ ] Webhook retry queue for failed attempts
- [ ] Admin dashboard showing all merchants needing reauth
- [ ] Automatic token refresh before expiry (if Shopify supports)

---

## 🎯 Summary

This is a **production-ready SaaS solution** that:
1. **Automatically detects** expired tokens for ANY merchant
2. **Dynamically displays** re-authorization prompts
3. **Guides merchants** through OAuth reconnection
4. **Works independently** for each merchant in your multi-tenant system

No hardcoded shop names. No manual intervention. Fully automated and scalable. 🚀
