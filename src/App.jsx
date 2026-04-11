import React, { useContext, useState } from "react";
 import "./App.css";
import JarvisUI from "./components/JarvisUI";
import ChatBox from "./components/ChatBox";
import { CiMicrophoneOn } from "react-icons/ci";
import { DataContext } from "./context/DataContext";

function App() {
    const {
          isListening,
       isNarrationOn,
         isSpeechSupported,
     pdfName,
      isPdfLoading,
     uploadPdf,
    clearPdf,
    toggleNarration,
     startListening,
     stopListening,
    handleCommand,
    speak,
  } = useContext(DataContext);
 const [messages, setMessages] = useState([]);
   const [question, setQuestion] = useState("");
    const [isAsking, setIsAsking] = useState(false);
  
  const createMessageId = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  async function askAndReply(inputText) {
    const text = inputText.trim();
    if (!text || isAsking) return;

    setMessages((prev) => [
      ...prev,
      { id: createMessageId(), role: "user", text },
    ]);

    setIsAsking(true);
    try {
      const reply = await handleCommand(text);
      
      setMessages((prev) => [
        ...prev,
        { id: createMessageId(), role: "ai", text: reply },
      ]);
      
      speak(reply);
    } catch {
      const errorMsg = "I could not process that question right now.";
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "ai",
          text: errorMsg,
        },
      ]);
      speak(errorMsg);
    } finally {
      setIsAsking(false);
    }
  }

  async function handlePdfUpload(event) {
    const file = event.target.files?.[0];
     const statusMessage = await uploadPdf(file);

    setMessages((prev) => [
      ...prev,
       { id: createMessageId(), role: "ai", text: statusMessage },
    ]);

    speak(statusMessage);
    event.target.value = "";
  }

  function handleClearPdf() {
    clearPdf();
      const msg = "PDF removed. I will answer generally now.";
    setMessages((prev) => [
      ...prev,
      {
        id: createMessageId(),
        role: "ai",
        text: msg,
      },
    ]);
    speak(msg);
  }

  function handleMicClick() {
    if (isListening) {
      stopListening();
      return;
    }

    startListening(async (transcript) => {
      await askAndReply(transcript);
    });
  }

  function handleQuestionSubmit(event) {
    event.preventDefault();
     const text = question.trim();
    if (!text || isAsking) return;

    setQuestion("");
    askAndReply(text);
  }

  return (
    <div className="main">
      <h1 className="app-title">AetherAI</h1>
      <JarvisUI />
      <button
        className={`mic-button ${isListening ? "listening" : ""}`}
        onClick={handleMicClick}
       disabled={!isSpeechSupported}
        title={
          isSpeechSupported
            ? "Click to start or stop listening"
            : "Speech recognition is not available in this browser"
        }
      >
        <CiMicrophoneOn size={35} />
      </button>
      <p className="listening-hint">
        {isSpeechSupported
          ? isListening
            ? "Listening... click mic to stop"
            : "Click mic to start listening"
          : "Speech recognition not supported in this browser"}
      </p>

      <button
        className={`speaker-toggle ${isNarrationOn ? "" : "off"}`}
        onClick={toggleNarration}
        type="button"
        title={isNarrationOn ? "Turn off AI narration" : "Turn on AI narration"}
      >
        {isNarrationOn ? "Speaker: On" : "Speaker: Off"}
      </button>

      <div className="pdf-tools">
        <label className="pdf-upload-label" htmlFor="pdf-upload-input">
          {isPdfLoading ? "Processing PDF..." : "Upload PDF"}
        </label>
        <input
          id="pdf-upload-input"
          type="file"
           accept="application/pdf"
          onChange={handlePdfUpload}
          disabled={isPdfLoading}
          className="pdf-upload-input"
        />

        {pdfName && (
          <div className="pdf-status">
            <span className="pdf-name">Using PDF: {pdfName}</span>
            <button className="clear-pdf-btn" onClick={handleClearPdf}>
              Remove PDF
            </button>
          </div>
        )}
      </div>

      <form className="ask-form" onSubmit={handleQuestionSubmit}>
        <input
          className="ask-input"
          type="text"
          placeholder={
            pdfName
              ? "Ask question from your uploaded PDF"
              : "Ask your question"
          }
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={isAsking}
        />
        <button className="ask-btn" type="submit" disabled={isAsking}>
          {isAsking ? "Thinking..." : "Ask"}
        </button>
      </form>
      
      <ChatBox messages={messages} />
    </div>
  );
}

export default App;