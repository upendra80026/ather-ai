import React, { useEffect, useRef } from "react";

function ChatBox({ messages }) {
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat-box">
      {messages.length === 0 && (
        <div className="ai">Say something to begin the conversation.</div>
      )}
      {messages.map((msg) => (
        <div key={msg.id} className={msg.role === "user" ? "user" : "ai"}>
          {msg.text}
        </div>
      ))}
      <div ref={chatEndRef} />
    </div>
  );
}

export default ChatBox;