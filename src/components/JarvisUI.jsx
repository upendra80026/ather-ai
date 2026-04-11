import React from "react";
import "./JarvisAnimations.css";

function JarvisUI() {
  return (
    <div className="jarvis-container">
      <div className="core-glow"></div>
      <div className="pulse-ring ring1"></div>
      <div className="pulse-ring ring2"></div>
      <div className="pulse-ring ring3"></div>
      <div className="voice-wave wave1"></div>
      <div className="voice-wave wave2"></div>
    </div>
  );
}

export default JarvisUI;