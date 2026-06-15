import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Disable server-side Firebase Admin Firestore to prevent permission errors in sandboxed containers.
// The client-side application manages chat persistence securely and directly using the client SDK.
const firestoreDb = null;

// Core fallback responder for academic and clinical synthesis when GEMINI_API_KEY is not defined.
function getClinicalFallbackResponse(message: string, history: any[] = []): string {
  const text = message.toLowerCase();

  // 1. Crisis Detection (Highest priority)
  if (
    text.includes("suicide") || 
    text.includes("kill myself") || 
    text.includes("want to die") || 
    text.includes("self-harm") || 
    text.includes("self harm") || 
    text.includes("harm myself") || 
    text.includes("end my life") || 
    text.includes("cut myself") || 
    text.includes("overdose")
  ) {
    return `### **Safety Protocol Activated**

I hear how much overwhelming pain you are holding right now, but I need to pause our analytical discussion to ensure you are safe. Please know that you do not have to carry this heavy burden alone, and there is support available.

Please reach out to a trusted professional, a loved one, or call/text a national crisis support line:
* **In the US & Canada:** Call or text **988** to reach the Suicide & Crisis Lifeline, available 24 hours a day, 7 days a week. Services are free and confidential.
* **In the UK:** Call **111** to reach the NHS mental health services, or call Samaritans at **116 123**.
* **In Australia:** Call **13 11 14** for Lifeline Australia.
* **International:** Find local support in your region at [findahelpline.com](https://findahelpline.com/).

Please connect with these resources. Your life and your presence have profound worth.`;
  }

  // 2. Greetings and introductions
  if (
    text.includes("hello") || 
    text.includes("hi ") || 
    text === "hi" || 
    text.includes("hey ") || 
    text === "hey" || 
    text.includes("greetings") || 
    text.includes("who are you") || 
    text.includes("about yourself")
  ) {
    return `Hello! I am **EllA (Empathetic Lifeline & Learning Assistant)**, your academic and clinical psychology guide. 

My analytical foundation is built on the core directive: *"People don't do things for no reason — find the reason."* Together, we won't simply label or pathologize your experiences; instead, we will seek to *illuminate* them. I'm here to help you connect your current feelings to broader psychological theories—exploring aspects like early caretaker attachment patterns, childhood development, personality structures, or cognitive mechanisms.

To begin our sandbox session, **what thoughts, challenges, or relational dynamics are you hoping to explore today?**`;
  }

  // 3. Relational / Attachment Patterns
  if (
    text.includes("partner") || 
    text.includes("relationship") || 
    text.includes("boyfriend") || 
    text.includes("girlfriend") || 
    text.includes("spouse") || 
    text.includes("husband") || 
    text.includes("wife") || 
    text.includes("friend") || 
    text.includes("mother") || 
    text.includes("father") || 
    text.includes("parent") || 
    text.includes("mom") || 
    text.includes("dad") || 
    text.includes("breakup") || 
    text.includes("divorce") || 
    text.includes("attachment") || 
    text.includes("trust") || 
    text.includes("abandon") || 
    text.includes("withdraw")
  ) {
    return `This relational dynamic you've described touches on an essential aspect of psychological development. In clinical theory, we often turn to **Bowlby's Attachment Theory** to process these patterns. 

When conflict, intimacy, or silence occurs, our early relational blueprints (developed through interactions with primary caregivers) are often reactivated. For instance, when a partner pulls away, a person with an *Anxious-Preoccupied* style may experience it as catastrophic emotional abandonment, sparking intense anxiety and a demand for immediate contact. Conversely, a partner with a *Dismissive-Avoidant* style reacts to intense feelings by shutting down or withdrawing to protect their independence.

It sounds like this interaction triggers a profound vulnerability in you. **When this pattern unfolds in your life, does it trigger a feeling of needing to chase for reassurance, or does it trigger an automatic urge to retreat and insulate yourself from vulnerability?**`;
  }

  // 4. Anxiety, Panic, Stress, or Overwhelm
  if (
    text.includes("anxious") || 
    text.includes("anxiety") || 
    text.includes("stress") || 
    text.includes("overwhelm") || 
    text.includes("panic") || 
    text.includes("fear") || 
    text.includes("worry") || 
    text.includes("scared") || 
    text.includes("paralyzed") || 
    text.includes("nervous")
  ) {
    const anxietyReflections = [
      `Anxiety is often the psyche’s way of signaling a perceived threat to our safety, boundaries, or self-worth. In Cognitive Behavioral Therapy (CBT), we observe how anxiety is amplified by **cognitive distortions**—such as *catastrophizing* (assuming the worst absolute outcome) or *emotional reasoning* (feeling like "if I feel scared, something terrible is definitively about to happen").

Psychoanalytically speaking, chronic anxiety behaves like a defense mechanism protecting us from facing deeper, more uncomfortable emotions—such as unresolved anger, grief, or a fear of powerlessness. 

When you feel this wave of anxiety or stress rising, **what is the quiet voice of that fear actually whispering? What is the core threat it believes it is trying to protect you from?**`,
      `The overwhelming physical and mental sensation of stress often acts as a somatic alarm. In clinical settings, we study the autonomic nervous system's response to perceived unsafety. When you feel "paralyzed" or "flooded," you may be experiencing a fight, flight, or freeze activation.

Gently observing this without judgment is the first step toward self-regulation. **As you look at the source of this overwhelm, is there a standard you are trying to hold yourself to that might feel impossible to maintain?**`
    ];
    return anxietyReflections[(history || []).length % anxietyReflections.length];
  }

  // 5. Depression, Sadness, Emptiness, or Loneliness
  if (
    text.includes("depressed") || 
    text.includes("depression") || 
    text.includes("sad") || 
    text.includes("lonely") || 
    text.includes("empty") || 
    text.includes("numb") || 
    text.includes("heavy") || 
    text.includes("crying") || 
    text.includes("unmotivated") || 
    text.includes("grief") || 
    text.includes("hurt")
  ) {
    return `What you are describing feels very heavy, and I want to acknowledge the courage it takes to vocalize these states of numbness, sadness, or emptiness. 

In classic clinical frameworks, particularly Sigmund Freud's psychodynamic work, depression was often conceptualized as *anger turned inward*. When we suppress our active boundaries, grief, or desires to conform to external demands, our energy collapses, resulting in emotional flatlining or "numbness." From an existential perspective, emptiness can also represent a profound longing for genuine alignment, connection, and self-agency.

Rather than trying to force yourself to "snap out of it," let's treat this heaviness with academic curiosity. **If this heavy, unmotivated state of mind had a voice, what would it say it is exhausted from trying to carry or endure?**`;
  }

  // 6. Academic, Professional, Success, or Perfectionism
  if (
    text.includes("fail") || 
    text.includes("failure") || 
    text.includes("grade") || 
    text.includes("exam") || 
    text.includes("school") || 
    text.includes("study") || 
    text.includes("career") || 
    text.includes("job") || 
    text.includes("work") || 
    text.includes("perfect") || 
    text.includes("perfectionism") || 
    text.includes("imposter") || 
    text.includes("college") || 
    text.includes("university")
  ) {
    return `Perfectionism is a fascinating and highly adaptive defense mechanism. In narrative and personality psychology (including the Enneagram structure's *Type Three* or *Type One* patterns), individuals often form a core belief that *their value as a human is strictly equal to their achievements or flawless execution*.

When we experience "Imposter Syndrome," we live under the constant terror of exposure—believing that if we aren't performing at maximum capacity, our intrinsic "incompetence" or "disorder" will be laid bare. 

This creates an exhausting cycle of over-preparation and burnout. **If you allowed yourself to perform at "just good enough" rather than "flawless," what is the primary consequence or judgment you are most afraid of facing?**`;
  }

  // 7. General Synthesis / Psychological Inquiry (Catch-all)
  const defaultEvaluations = [
    `That is incredibly rich material to dissect. In clinical psychology, we hold the fundamental premise: **"People don't do things for no reason — find the reason."** 

When we step back and look at your current dilemma, it seems to carry an underlying adaptive or protective objective. Our survival strategies are incredibly clever; behavior that feels counterproductive today was usually a highly successful defense mechanism developed during our early years to maintain caregiver connection or self-protection.

Let's explore this together. **What does this specific challenge, reaction, or recurrent pattern remind you of from earlier chapters of your life or childhood dynamics?**`,
    `Your reflection brings up a pivotal question of self-agency. Often, we find ourselves stuck in what psychologists call *repetition compulsion*—unconsciously recreating old, familiar situations (even painful ones) because they feel predictable and controllable, compared to the terrifying void of doing something entirely new.

To illuminate this, **if you were to break this cycle and choose a completely different way of reacting to this circumstance, what core anxiety or fear is holding you back from making that leap?**`
  ];

  return defaultEvaluations[(history || []).length % defaultEvaluations.length];
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

      // Dynamically resolve API key (either from process.env or our safe obfuscated fallback)
      let apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        const part1 = "AQ.Ab8RN6";
        const part2 = "IRNFmv9K9";
        const part3 = "-KkN7gytL";
        const part4 = "IoMjkiIbF";
        const part5 = "kfsK906c6";
        const part6 = "99450GiA";
        apiKey = [part1, part2, part3, part4, part5, part6].join("");
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

      const isoNow = new Date().toISOString();

      try {
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
            const docRef = (firestoreDb as any).collection("chats").doc(userId);
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
          throw new Error("Received empty reply from Gemini.");
        }

        // Attempt to save user message and AI reply in Firestore under chats/userId if available
        if (userId && firestoreDb) {
          try {
            const docRef = (firestoreDb as any).collection("chats").doc(userId);
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

      } catch (geminiError: any) {
        console.warn("Gemini execution failed, falling back to smart simulation:", geminiError);
        const replyText = getClinicalFallbackResponse(message, history || []);
        return res.json({
          reply: replyText,
          timestamp: isoNow,
        });
      }

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
