import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  askAI,
  askAIWithContext,
  buildConversationSummary,
  planAssistantAction,
  recordConversationTurn,
  rememberPlannerDecision,
  rememberToolAction,
  rememberUserMessage,
} from "../gemini";
import { extractPdfText } from "../pdfUtils";
import { findYouTubeMusicLink } from "../tavily";
import { DataContext } from "./DataContext";

const PDF_NOT_FOUND_MESSAGE = "I could not find that in the uploaded PDF.";
const SITE_URL_MAP = {
  google: "https://www.google.com",
  youtube: "https://www.youtube.com",
  instagram: "https://www.instagram.com",
  whatsapp: "https://web.whatsapp.com",
  facebook: "https://www.facebook.com",
};

function sanitizeMusicTerm(text) {
  return text
    .replace(/\b(song|songs|music|track|video|official|youtube)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMusicIntent(message) {
  const lower = message.toLowerCase();
  const hasPlayIntent = /\b(play|start|put on|listen to|open)\b/.test(lower);
  if (!hasPlayIntent) return null;

  const cleaned = message
    .replace(/\b(play|start|put on|listen to|open)\b/gi, "")
    .replace(/\b(on youtube|youtube)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  const wantsPlaylist = /\b(playlist|mix|top songs|best songs)\b/i.test(cleaned);

  const byPattern = cleaned.match(/(.+?)\s+by\s+(.+)/i);
  if (byPattern) {
    const songName = sanitizeMusicTerm(byPattern[1]);
    const artistName = sanitizeMusicTerm(byPattern[2]);
    if (songName && artistName) {
      return { rawQuery: cleaned, songName, artistName, wantsPlaylist };
    }
  }

  const artistPattern = cleaned.match(/(?:music|songs?|tracks?|playlist|mix)\s+(?:of|from|by)\s+(.+)/i);
  if (artistPattern) {
    const artistName = sanitizeMusicTerm(artistPattern[1]);
    if (artistName) {
      return { rawQuery: cleaned, songName: "", artistName, wantsPlaylist };
    }
  }

  return {
    rawQuery: sanitizeMusicTerm(cleaned),
    songName: "",
    artistName: "",
    wantsPlaylist,
  };
}

function buildMusicIntentFromPlan(plan, fallbackMessage) {
  const params = plan?.params || {};
  const songName = sanitizeMusicTerm(params.songName || "");
  const artistName = sanitizeMusicTerm(params.artistName || "");
  const queryFromPlan = sanitizeMusicTerm(params.query || "");
  const wantsPlaylist = Boolean(params.wantsPlaylist);

  let rawQuery = "";
  if (songName && artistName) rawQuery = `${songName} by ${artistName}`;
  else if (queryFromPlan) rawQuery = queryFromPlan;
  else if (songName) rawQuery = songName;
  else if (artistName) rawQuery = artistName;
  else rawQuery = sanitizeMusicTerm(fallbackMessage);

  if (!rawQuery) return null;

  return { rawQuery, songName, artistName, wantsPlaylist };
}

function shouldReserveActionTab(message) {
  const lower = message.toLowerCase();
  return (
    /\b(play|start|put on|listen to|open)\b/.test(lower) ||
    (/\b(google|youtube|instagram|whatsapp|facebook)\b/.test(lower) &&
      /\b(open|start|launch|go to)\b/.test(lower))
  );
}

function isMemoryRecallQuestion(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes("what did i ask") ||
    lower.includes("what have i asked") ||
    lower.includes("what i have asked") ||
    lower.includes("what did i tell") ||
    lower.includes("what did i say") ||
    lower.includes("remember") ||
    lower.includes("earlier") ||
    lower.includes("before")
  );
}

function UserContext({ children }) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isSpeechSupported = Boolean(SpeechRecognition);

  const recognitionRef = useRef(null);
  const transcriptHandlerRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [isNarrationOn, setIsNarrationOn] = useState(true);
  const [pdfText, setPdfText] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  useEffect(() => {
    if (!SpeechRecognition) {
      recognitionRef.current = null;
      return;
    }

    const instance = new SpeechRecognition();
    instance.continuous = false;
    instance.lang = "en-US";

    instance.onstart = () => setIsListening(true);
    instance.onend = () => setIsListening(false);
    instance.onerror = () => setIsListening(false);
    instance.onresult = (e) => {
      const transcript = e.results[e.resultIndex][0].transcript;
      transcriptHandlerRef.current?.(transcript);
    };

    recognitionRef.current = instance;

    return () => {
      instance.onstart = null;
      instance.onend = null;
      instance.onerror = null;
      instance.onresult = null;
      instance.stop();
      transcriptHandlerRef.current = null;
      recognitionRef.current = null;
    };
  }, [SpeechRecognition]);

  const speak = useCallback(
    (text) => {
      if (!isNarrationOn) return;
      const speech = new SpeechSynthesisUtterance(text);
      speech.lang = "en-US";
      speech.volume = 1;
      speech.rate = 1;
      speech.pitch = 1;
      window.speechSynthesis.speak(speech);
    },
    [isNarrationOn]
  );

  const toggleNarration = useCallback(() => {
    setIsNarrationOn((prev) => {
      if (prev) {
        window.speechSynthesis.cancel();
      }
      return !prev;
    });
  }, []);

  const stopAssistant = useCallback(() => {
    window.speechSynthesis.cancel();
    const recognition = recognitionRef.current;
    if (recognition && isListening) {
      recognition.stop();
    }
  }, [isListening]);

  const startListening = useCallback(
    (onTranscript) => {
      const recognition = recognitionRef.current;
      if (!recognition || isListening) return false;

      transcriptHandlerRef.current = onTranscript;
      recognition.start();
      return true;
    },
    [isListening]
  );

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !isListening) return;
    recognition.stop();
  }, [isListening]);

  const handleCommand = useCallback(
    async (message) => {
      const msg = message.toLowerCase();

      if (isMemoryRecallQuestion(message)) {
        const summary = buildConversationSummary(12);
        rememberUserMessage(message);
        recordConversationTurn("assistant", summary);
        return summary;
      }

      let reservedTab = null;
      try {
        if (shouldReserveActionTab(message)) {
          reservedTab = window.open("about:blank", "_blank");
          if (reservedTab) {
            reservedTab.opener = null;
          }
        }
      } catch (e) {
        console.warn("Could not create reserved tab:", e);
      }

      rememberUserMessage(message);

      const plannedAction = await planAssistantAction(message, {
        hasPdfLoaded: Boolean(pdfText),
      });

      rememberPlannerDecision(
        plannedAction.intent,
        plannedAction.confidence,
        plannedAction.params || {}
      );

      if (
        plannedAction.intent === "stop_assistant" &&
        plannedAction.confidence >= 0.55
      ) {
        if (reservedTab && !reservedTab.closed) reservedTab.close();
        rememberToolAction("stop_assistant executed");
        stopAssistant();
        const stopReply = plannedAction.reply || "Stopped.";
        recordConversationTurn("assistant", stopReply);
        return stopReply;
      }

      if (
        plannedAction.intent === "open_site" &&
        plannedAction.confidence >= 0.6
      ) {
        const requestedSite = String(plannedAction.params?.site || "").toLowerCase();
        const targetUrl = SITE_URL_MAP[requestedSite];
        if (targetUrl) {
          if (reservedTab && !reservedTab.closed) {
            reservedTab.location.href = targetUrl;
          } else if (!window.open(targetUrl, "_blank")) {
            const siteDisplayName = requestedSite[0].toUpperCase() + requestedSite.slice(1);
            return `I couldn't open ${siteDisplayName} due to popup blocking. <a href='${targetUrl}' target='_blank'>Click here to open it</a>.`;
          }
          rememberToolAction(`open_site executed for ${requestedSite} -> ${targetUrl}`);
          const openReply = plannedAction.reply || `Opened ${requestedSite[0].toUpperCase()}${requestedSite.slice(1)}`;
          recordConversationTurn("assistant", openReply);
          return openReply;
        }
      }

      const plannedMusicIntent =
        plannedAction.intent === "play_music" && plannedAction.confidence >= 0.5
          ? buildMusicIntentFromPlan(plannedAction, message)
          : null;

      const musicIntent = plannedMusicIntent || parseMusicIntent(message);

      if (/\b(stop|pause)\b/.test(msg)) {
        if (reservedTab && !reservedTab.closed) reservedTab.close();
        stopAssistant();
        recordConversationTurn("assistant", "Stopped.");
        return "Stopped.";
      }

      if (musicIntent?.rawQuery) {
        rememberToolAction(`play_music resolved for query="${musicIntent.rawQuery}"`);
        const videoResult = await findYouTubeMusicLink(musicIntent);
        const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(musicIntent.rawQuery)}`;
        const targetUrl = videoResult?.url || fallbackUrl;

        if (reservedTab && !reservedTab.closed) {
          reservedTab.location.href = targetUrl;
        } else {
          try {
            const opened = window.open(targetUrl, "_blank");
            if (!opened) {
              // Popup blocked - try navigating in current window as last resort
              try {
                window.location.href = targetUrl;
              } catch (e) {
                return "I found the song, but I couldn't open it. Try allowing popups or <a href='" + targetUrl + "' target='_blank'>click here to open manually</a>.";
              }
            }
          } catch (e) {
            return "I found the song, but I couldn't open it. Try allowing popups or <a href='" + targetUrl + "' target='_blank'>click here to open manually</a>.";
          }
        }

        if (videoResult?.url) {
          rememberToolAction(`opened YouTube URL ${targetUrl} for ${videoResult.displayQuery || musicIntent.rawQuery}`);
          const playReply = `Playing on YouTube: ${videoResult.displayQuery || musicIntent.rawQuery}`;
          recordConversationTurn("assistant", playReply);
          return playReply;
        }

        rememberToolAction(`opened YouTube search URL ${targetUrl} for ${musicIntent.rawQuery}`);
        const searchReply = `Opening YouTube search for: ${musicIntent.rawQuery}`;
        recordConversationTurn("assistant", searchReply);
        return searchReply;
      }

      if (msg.includes("google")) {
        if (reservedTab && !reservedTab.closed) {
          reservedTab.location.href = "https://www.google.com";
        } else if (!window.open("https://www.google.com", "_blank")) {
          return "I couldn't open Google due to popup blocking. <a href='https://www.google.com' target='_blank'>Click here to open it</a>.";
        }
        rememberToolAction("opened Google");
        recordConversationTurn("assistant", "Opened Google");
        return "Opened Google";
      }

      if (msg.includes("youtube")) {
        if (reservedTab && !reservedTab.closed) {
          reservedTab.location.href = "https://www.youtube.com";
        } else if (!window.open("https://www.youtube.com", "_blank")) {
          return "I couldn't open YouTube due to popup blocking. <a href='https://www.youtube.com' target='_blank'>Click here to open it</a>.";
        }
        rememberToolAction("opened YouTube");
        recordConversationTurn("assistant", "Opened YouTube");
        return "Opened YouTube";
      }

      if (msg.includes("instagram")) {
        if (reservedTab && !reservedTab.closed) {
          reservedTab.location.href = "https://www.instagram.com";
        } else if (!window.open("https://www.instagram.com", "_blank")) {
          return "I couldn't open Instagram due to popup blocking. <a href='https://www.instagram.com' target='_blank'>Click here to open it</a>.";
        }
        rememberToolAction("opened Instagram");
        recordConversationTurn("assistant", "Opened Instagram");
        return "Opened Instagram";
      }

      if (msg.includes("whatsapp")) {
        if (reservedTab && !reservedTab.closed) {
          reservedTab.location.href = "https://web.whatsapp.com";
        } else if (!window.open("https://web.whatsapp.com", "_blank")) {
          return "I couldn't open WhatsApp due to popup blocking. <a href='https://web.whatsapp.com' target='_blank'>Click here to open it</a>.";
        }
        rememberToolAction("opened WhatsApp Web");
        recordConversationTurn("assistant", "Opened WhatsApp Web");
        return "Opened WhatsApp Web";
      }

      if (msg.includes("facebook")) {
        if (reservedTab && !reservedTab.closed) {
          reservedTab.location.href = "https://www.facebook.com";
        } else if (!window.open("https://www.facebook.com", "_blank")) {
          return "I couldn't open Facebook due to popup blocking. <a href='https://www.facebook.com' target='_blank'>Click here to open it</a>.";
        }
        rememberToolAction("opened Facebook");
        recordConversationTurn("assistant", "Opened Facebook");
        return "Opened Facebook";
      }

      let reply;
      if (pdfText) {
        const pdfReply = await askAIWithContext(message, pdfText);
        if (pdfReply?.trim() === PDF_NOT_FOUND_MESSAGE) {
          reply = await askAI(message);
        } else {
          reply = pdfReply;
        }
      } else {
        reply = await askAI(message);
      }

      if (reservedTab && !reservedTab.closed) {
        reservedTab.close();
      }

      return reply;
    },
    [pdfText, stopAssistant]
  );

  const uploadPdf = useCallback(async (file) => {
    if (!file) return "No PDF selected.";

    const lowerName = file.name?.toLowerCase() || "";
    const hasPdfMime = file.type === "application/pdf";
    const hasPdfExtension = lowerName.endsWith(".pdf");

    if (!hasPdfMime && !hasPdfExtension) {
      return "Please upload a valid PDF file.";
    }

    setIsPdfLoading(true);

    try {
      const text = await extractPdfText(file);
      if (!text) {
        setPdfText("");
        setPdfName("");
        return "Could not extract text from this PDF.";
      }

      setPdfText(text);
      setPdfName(file.name);
      return `PDF uploaded: ${file.name}. You can now ask questions.`;
    } catch (error) {
      setPdfText("");
      setPdfName("");
      if (error?.message?.toLowerCase().includes("password")) {
        return "This PDF is password-protected. Please upload an unlocked PDF.";
      }

      return "Failed to read this PDF. Try another PDF or export your resume again as PDF.";
    } finally {
      setIsPdfLoading(false);
    }
  }, []);

  const clearPdf = useCallback(() => {
    setPdfText("");
    setPdfName("");
  }, []);

  const contextValue = useMemo(
    () => ({
      isListening,
      isNarrationOn,
      isSpeechSupported,
      pdfName,
      isPdfLoading,
      uploadPdf,
      clearPdf,
      stopAssistant,
      toggleNarration,
      startListening,
      stopListening,
      speak,
      handleCommand,
    }),
    [
      isListening,
      isNarrationOn,
      isSpeechSupported,
      pdfName,
      isPdfLoading,
      uploadPdf,
      clearPdf,
      stopAssistant,
      toggleNarration,
      startListening,
      stopListening,
      speak,
      handleCommand,
    ]
  );

  return <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>;
}

export default UserContext;
