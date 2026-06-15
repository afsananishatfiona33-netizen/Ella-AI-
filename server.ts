import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import dotenv from "dotenv";

dotenv.config();

// Attempt to initialize Firebase Admin SDK
let firestoreDb: Firestore | null = null;
try {
  if (getApps().length === 0) {
    initializeApp();
  }
  firestoreDb = getFirestore();
  console.log("Firebase Admin Firestore initialized successfully.");
} catch (error) {
  console.warn(
    "Firebase Admin could not be initialized automatically. Operating in resilient/mock-free hybrid mode.",
    error
  );
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Enable JSON request body parsing
  app.use(express.json());

  // API Route: Send message to Psychologist
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, userId, history } = req.body;

      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "Message is required." });
      }

      // Check for Gemini API key
      const apiKey = process.env.GEMINI_API_KEY || "AQ.Ab8RN6IRNFmv9K9-KkN7gytLIoMjkiIbFkfsK906c699450GiA";
      if (!apiKey) {
        return res.status(500).json({
          error: "GEMINI_API_KEY is not defined. Please add it to your server secrets.",
        });
      }

      // Read System Prompt from academic-psychologist.md
      let systemInstruction = "You are a professional clinical and academic psychologist.";
      try {
        const promptPath = path.join(process.cwd(), "academic-psychologist.md");
        if (fs.existsSync(promptPath)) {
          systemInstruction = fs.readFileSync(promptPath, "utf8");
        }
      } catch (err) {
        console.error("Failed to read academic-psychologist.md system prompt index:", err);
      }

      // Initialize the official @google/genai SDK
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      // Prepare contents list
      let formattedHistory: any[] = [];

      // 1) First preference: Use client-passed historical message log
      if (Array.isArray(history) && history.length > 0) {
        formattedHistory = history.map((msg: any) => ({
          role: msg.sender === "user" ? "user" : "model",
          parts: [{ text: msg.text }],
        }));
      }
      // 2) Second preference: If userId is provided and we can read from Firestore
      else if (userId && firestoreDb) {
        try {
          const docRef = firestoreDb.collection("chats").doc(userId);
          const snap = await docRef.get();
          if (snap.exists) {
            const data = snap.data();
            if (data && Array.isArray(data.messages)) {
              formattedHistory = data.messages.map((msg: any) => ({
                role: msg.sender === "user" ? "user" : "model",
                parts: [{ text: msg.text }],
              }));
            }
          }
        } catch (dbErr) {
          console.warn("Could not read chat history from Firestore:", dbErr);
        }
      }

      // Append current message
      formattedHistory.push({
        role: "user",
        parts: [{ text: message.trim() }],
      });

      // Query Gemini 3.5-flash
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: formattedHistory,
        config: {
          systemInstruction,
          temperature: 0.8,
        },
      });

      const replyText = response.text;
      if (!replyText) {
        return res.status(500).json({ error: "Received empty reply from Gemini." });
      }

      const isoNow = new Date().toISOString();

      // Attempt to save user message and AI reply in Firestore under chats/userId if available
      if (userId && firestoreDb) {
        try {
          const docRef = firestoreDb.collection("chats").doc(userId);
          const snap = await docRef.get();
          let messages = [];
          if (snap.exists) {
            const data = snap.data();
            if (data && Array.isArray(data.messages)) {
              messages = [...data.messages];
            }
          }

          // Append new conversation turn
          messages.push({
            sender: "user",
            text: message.trim(),
            timestamp: isoNow,
          });
          messages.push({
            sender: "model",
            text: replyText,
            timestamp: isoNow,
          });

          await docRef.set({
            userId,
            updatedAt: isoNow,
            messages,
          }, { merge: true });
        } catch (dbErr) {
          console.warn("Could not automatically save chat transaction to Firestore via Admin SDK:", dbErr);
        }
      }

      return res.json({
        reply: replyText,
        timestamp: isoNow,
      });
    } catch (error: any) {
      console.error("API error during Chat Psychologist session:", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Error processing your emotional consult.",
      });
    }
  });

  // Hot module replacement or static file server
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`EllA psychologist backend active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
