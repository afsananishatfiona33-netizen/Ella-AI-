/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

/**
 * Cloud Function: analyzeAndChat
 * Accessible onCall (v2 callable function).
 * 
 * To deploy this with the GEMINI_API_KEY secret configured, make sure to run:
 * firebase functions:secrets:set GEMINI_API_KEY="YOUR_KEY_HERE"
 */
export const analyzeAndChat = onCall(
  {
    secrets: ["GEMINI_API_KEY"],
    cors: true, // Allow requests from our front-end
  },
  async (request) => {
    // 1. Ensure user is authenticated
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const uid = request.auth.uid;
    const data = request.data;
    
    // 2. Validate input parameters
    if (!data || typeof data.message !== "string" || !data.message.trim()) {
      throw new HttpsError(
        "invalid-argument",
        "A non-empty 'message' string is required."
      );
    }

    const userMessageText = data.message.trim();

    // 3. Resolve the Gemini API Key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "GEMINI_API_KEY is not configured in Cloud Secret Manager."
      );
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

    try {
      // 4. Fetch the psychologist system prompt from local markdown file
      // In functions container, check potential assets or root paths
      let systemPrompt = "You are an academic psychologist.";
      const promptPath = path.join(__dirname, "..", "academic-psychologist.md");
      const rootPromptPath = path.join(__dirname, "..", "..", "academic-psychologist.md");

      if (fs.existsSync(promptPath)) {
        systemPrompt = fs.readFileSync(promptPath, "utf8");
      } else if (fs.existsSync(rootPromptPath)) {
        systemPrompt = fs.readFileSync(rootPromptPath, "utf8");
      }

      // 5. Fetch prior chat messages from Firestore
      const chatDocRef = db.collection("chats").doc(uid);
      const chatSnapshot = await chatDocRef.get();

      let messagesList: Array<{ sender: "user" | "model"; text: string; timestamp: string }> = [];

      if (chatSnapshot.exists) {
        const chatData = chatSnapshot.data();
        if (chatData && Array.isArray(chatData.messages)) {
          messagesList = chatData.messages;
        }
      }

      // 6. Build content histoy array for Gemini generateContent call
      // Map Firestore message list elements to Gemini Content format
      const isFirstMessage = messagesList.length === 0;

      // Construct system instruction configuration
      const config = {
        systemInstruction: systemPrompt,
        temperature: 0.8,
      };

      // Prepare contents parameter for generateContent: map history and append newest message
      const formattedHistory = messagesList.map((msg) => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      }));

      // Append user's current message
      formattedHistory.push({
        role: "user",
        parts: [{ text: userMessageText }],
      });

      // 7. Fire request to official gemini-3.5-flash model
      const modelResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: formattedHistory,
        config: config,
      });

      const replyText = modelResponse.text;
      if (!replyText) {
        throw new HttpsError(
          "internal",
          "Received empty response from Gemini model."
        );
      }

      const isoNow = new Date().toISOString();

      // 8. Safely append exchange back to client-authenticated Firestore
      const userMessage = {
        sender: "user" as const,
        text: userMessageText,
        timestamp: isoNow,
      };

      const aiReplyMessage = {
        sender: "model" as const,
        text: replyText,
        timestamp: isoNow,
      };

      const finalMessages = [...messagesList, userMessage, aiReplyMessage];

      // Store in firestore collection "chats"
      await chatDocRef.set({
        userId: uid,
        updatedAt: isoNow,
        messages: finalMessages,
      }, { merge: true });

      // 9. Return response back directly to the frontend client
      return {
        reply: replyText,
        timestamp: isoNow,
      };
    } catch (error: any) {
      console.error("Error executing Chat psychologist:", error);
      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : "Internal therapist service error."
      );
    }
  }
);
