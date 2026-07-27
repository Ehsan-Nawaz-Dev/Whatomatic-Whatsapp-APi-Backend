import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import apiRouter from "./routes/index.js";
import planRoutes from './routes/plans.js';
import { ActivityLog } from "./models/ActivityLog.js";
import { Template } from "./models/Template.js";

dotenv.config();

/**
 * Watchdog: order webhooks create the activity as 'pending' ("Processing Order
 * Notification...") BEFORE the WhatsApp message is sent. If the server restarts
 * or crashes mid-send (including while waiting on a template sendingDelay),
 * the activity stays 'pending' forever and the dashboard falsely shows
 * "waiting for customer confirmation". Surface those as failed instead.
 */
const recoverStuckActivities = async () => {
  try {
    // Respect the largest configured sendingDelay so delayed sends aren't flagged early
    const maxDelayTpl = await Template.findOne({ sendingDelay: { $gt: 0 } }).sort({ sendingDelay: -1 });
    const graceMinutes = 15 + (maxDelayTpl?.sendingDelay || 0);
    const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);

    const result = await ActivityLog.updateMany(
      { type: "pending", message: "Processing Order Notification...", createdAt: { $lt: cutoff } },
      {
        $set: {
          type: "failed",
          message: "Failed to send WhatsApp ❌",
          errorMessage: "Send was interrupted (server restarted or WhatsApp connection dropped before the message went out)",
        },
      }
    );
    if (result.modifiedCount > 0) {
      console.warn(`[Watchdog] Marked ${result.modifiedCount} interrupted send(s) as failed (stuck in 'Processing' for over ${graceMinutes} min).`);
    }
  } catch (err) {
    console.error("[Watchdog] Error recovering stuck activities:", err.message);
  }
};

const app = express();

// Middleware
app.use(cors());
app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(morgan("dev"));

// Database connection middleware for serverless
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "whatflow-backend" });
});

// Root endpoint - Smart Redirect
app.get("/", (req, res) => {
  const shop = req.query.shop;
  if (shop) {
    // If shop param exists, it's likely an install request -> Go to Auth
    return res.redirect(`/api/auth/shopify?shop=${shop}`);
  }

  // Otherwise, redirect to the frontend dashboard
  // Use the env var or fallback
  const frontendUrl = process.env.FRONTEND_APP_URL || "https://whatflow-alpha.vercel.app";
  res.redirect(frontendUrl);
});

// Redirect /auth to /api/auth/shopify (Legacy/Standard Shopify support)
app.use("/auth", (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  res.redirect(`/Api/auth/shopify${query ? '?' + query : ''}`);
});

// API routes - Support both lowercase and capitalized versions for maximum frontend compatibility
app.use("/api", apiRouter);
app.use("/Api", apiRouter);

// Export app for serverless
export { app };

// Only run server if not in serverless environment
if (process.env.VERCEL !== "1") {
  const PORT = process.env.PORT || 5000;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_APP_URL || "http://localhost:5173",
      methods: ["GET", "POST"],
    },
  });

  // Socket.IO connection handling
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Join room for specific shop
    socket.on("join", (shopDomain) => {
      socket.join(shopDomain);
      console.log(`Client ${socket.id} joined room: ${shopDomain}`);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // Start server after DB connect
  connectDB()
    .then(() => {
      setTimeout(recoverStuckActivities, 30 * 1000); // Sweep once after boot
      setInterval(recoverStuckActivities, 10 * 60 * 1000); // Then every 10 minutes
      httpServer.listen(PORT, () => {
        console.log(`WhatFlow backend running on port ${PORT}`);
        console.log(`Server ready`);
      });
    })
    .catch((err) => {
      console.error("Failed to start server", err);
      process.exit(1);
    });
} else {
  // In serverless environment, we still want to trigger the connection
  connectDB().catch(err => console.error("Initial DB connection failed in serverless mode", err));
}
