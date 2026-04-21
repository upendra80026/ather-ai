import { GoogleGenAI } from "@google/genai";
import { getWebSearchContext } from "./tavily";

const apiKey = import.meta.env.VITE_GEN_AI_API_KEY;
console.log("Using API Key:", apiKey ? "Provided" : "Not Provided");
 //"AIzaSyA01cjGt7BsSrBzN8eHJa3dyhhFIRhKKVY";
//"AIzaSyCI6JEiqkxS8x1XkDc-Bo0D36IkpUaA2MA";
//"AIzaSyAe3WQO8IaePC0djATcBUmMtPUcshNwqS8"
// "AIzaSyBKX-GxoVlLtuDvwtRbqUrotUZTyBhzmN8";
// "AIzaSyAl_Nzmt-tSdfyV958bevW25KH9hr1OiRY";


//const apiKey = "AIzaSyD4chVgVvBy5bC6mMa6Ps_s4MFpg7sFMQs"
const ai = new GoogleGenAI({
  apiKey: apiKey
});

const chatHistory = [];
const MAX_HISTORY_TURNS = 8;
const MAX_WEB_CONTEXT_CHARS = 3500;
const ACTION_INTENTS = new Set(["chat", "stop_assistant", "open_site", "play_music"]);

function trimText(text, maxChars) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function normalizeHistoryEntry(role, content) {
  return {
    role: typeof role === "string" && role ? role : "assistant",
    content: typeof content === "string" ? content.trim() : "",
  };
}

export function recordConversationTurn(role, content) {
  const entry = normalizeHistoryEntry(role, content);

  if (!entry.content) {
    return;
  }

  chatHistory.push(entry);

  if (chatHistory.length > MAX_HISTORY_TURNS) {
    chatHistory.splice(0, chatHistory.length - MAX_HISTORY_TURNS);
  }
}

export function clearConversationHistory() {
  chatHistory.length = 0;
}

function extractJsonObject(text) {
  if (!text) return null;
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonString = text.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}

function normalizePlannedAction(parsedAction) {
  const intent = ACTION_INTENTS.has(parsedAction?.intent)
    ? parsedAction.intent
    : "chat";

  let confidence = Number(parsedAction?.confidence);
  if (Number.isNaN(confidence)) {
    confidence = 0;
  }

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    intent,
    confidence,
    params: parsedAction?.params && typeof parsedAction.params === "object"
      ? parsedAction.params
      : {},
    reply: typeof parsedAction?.reply === "string" ? parsedAction.reply : "",
  };
}

export async function planAssistantAction(message, options = {}) {
  const hasPdfLoaded = Boolean(options?.hasPdfLoaded);

  try {
    const plannerPrompt = `You are an action planner for a voice assistant.
Classify the user message into exactly one intent and return STRICT JSON only.

Allowed intents:
- chat
- stop_assistant
- open_site
- play_music

Rules:
- Use open_site only for direct open requests (google, youtube, instagram, whatsapp, facebook).
- Use play_music for requests like play/listen/start music/song/playlist, including patterns like "play <song> by <artist>".
- Use stop_assistant for stop/pause commands.
- Otherwise use chat.
- confidence must be between 0 and 1.

Return JSON schema:
{
  "intent": "chat | stop_assistant | open_site | play_music",
  "confidence": 0.0,
  "params": {
    "site": "google|youtube|instagram|whatsapp|facebook",
    "songName": "",
    "artistName": "",
    "query": "",
    "wantsPlaylist": false
  },
  "reply": "optional short acknowledgement"
}

Context:
- PDF currently loaded: ${hasPdfLoaded ? "yes" : "no"}

User message:
${message}`;

    const plannerResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: plannerPrompt,
    });

    const plannerText =
      plannerResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const parsed = extractJsonObject(plannerText);
    if (!parsed) {
      return {
        intent: "chat",
        confidence: 0,
        params: {},
        reply: "",
      };
    }

    return normalizePlannedAction(parsed);
  } catch (error) {
    console.error("planAssistantAction failed:", error?.message || error);
    return {
      intent: "chat",
      confidence: 0,
      params: {},
      reply: "",
    };
  }
}

function buildReversePrompt(question, webContext) {
  const recentHistory = chatHistory
    .slice(-MAX_HISTORY_TURNS)
    .map(
      (turn, index) =>
        `Turn ${index + 1}\n${turn.role.toUpperCase()}: ${turn.content}`
    )
    .join("\n\n");

  return `You are a helpful assistant.
Use previous conversation when it is relevant.
If the user asks a follow-up, use context from earlier turns.
Keep answers short and on point. Elaborate only if asked.
For action-oriented requests (like play music/open apps), reply with a short acknowledgement because the app may execute helper functions.
When web search context is provided, use it for factual freshness and prefer it over old memory.
Do not say you cannot access live/current internet data if web search context is provided.
If web context is empty, answer normally from your own knowledge.
If previous history includes planner/tool entries, use them as part of the conversation context and remember the user's earlier request.

Previous conversation:
${recentHistory || "No previous conversation."}

Web search context:
${webContext || "No web context provided."}

Current user question:
${question}`;
}

export async function askAI(question) {
  try {
    const webContext = await getWebSearchContext(question);
    const safeWebContext = trimText(webContext, MAX_WEB_CONTEXT_CHARS);
    const prompt = buildReversePrompt(question, safeWebContext);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
  console.log("response getting from askAI:", response)
    const reply =
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I could not generate a response right now.";

    recordConversationTurn("assistant", reply);

    return reply;
  } catch (error) {
    console.error("askAI failed:", error?.message || error);

    try {
      const fallbackResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a helpful assistant. Keep answers short and on point.\n\nQuestion:\n${question}`,
      });
      console.log("response getting from fallback:", fallbackResponse)
      return (
        fallbackResponse.candidates?.[0]?.content?.parts?.[0]?.text ||
        "I could not generate a response right now."
      );
    } catch (fallbackError) {
      console.error("askAI fallback failed:", fallbackError?.message || fallbackError);
      return "I could not generate a response right now.";
    }
  }

}

export function rememberUserMessage(message) {
  recordConversationTurn("user", message);
}

export function rememberPlannerDecision(intent, confidence, params = {}) {
  recordConversationTurn(
    "planner",
    `intent=${intent}, confidence=${confidence}, params=${JSON.stringify(params)}`
  );
}

export function rememberToolAction(actionText) {
  recordConversationTurn("tool", actionText);
}

export function getRecentConversationSnapshot(limit = 12) {
  return chatHistory.slice(-limit).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
}

export function buildConversationSummary(limit = 12) {
  const turns = getRecentConversationSnapshot(limit);

  if (!turns.length) {
    return "I don't have any conversation history yet.";
  }

  const formatted = turns
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");

  return `Recent conversation:\n${formatted}`;
}

export async function askAIWithContext(question, contextText) {
  try {
    const prompt = `You are a helpful assistant. Answer using only the provided PDF content. If the answer is not present in the PDF, clearly say: "I could not find that in the uploaded PDF."\n\nPDF Content:\n${contextText}\n\nQuestion:\n${question}.Answer should be short and onpoint . Elaborate only if the user asks for more details.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
      console.log("response getting from contextAICALL:", response)
    return response.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I could not generate a response right now.";
  } catch (error) {
    console.error("askAIWithContext failed:", error?.message || error);
    return "I could not generate a response right now.";
  }

}