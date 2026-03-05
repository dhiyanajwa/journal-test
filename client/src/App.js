// LOCATION: client/src/App.js
import React, { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [journals, setJournals] = useState([]);
  const [file, setFile] = useState(null);
  const [messages, setMessages] = useState({});
  const [input, setInput] = useState("");
  const [chatSessions, setChatSessions] = useState({}); // Track chat session IDs per journal
  const [selectedJournal, setSelectedJournal] = useState(null); // Selected journal for chat
  const [correctionMode, setCorrectionMode] = useState(null); // {messageIndex, originalText}

  // Create a unique session ID for LangGraph memory
  const [sessionId] = useState("session-" + Math.random().toString(36).substr(2, 9));

  useEffect(() => {
    fetchJournals();
  }, []);

  const fetchJournals = async () => {
    const res = await fetch("http://localhost:3001/journals");
    const data = await res.json();
    setJournals(data);
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("pdf", file);

    await fetch("http://localhost:3001/upload", {
      method: "POST",
      body: formData,
    });
    alert("Uploaded!");
    fetchJournals();
  };

  const getCurrentMessages = () => {
    return messages[selectedJournal] || [];
  };

  const handleSend = async () => {
    if (!input) return;
    if (!selectedJournal) {
      alert("Please select a journal first.");
      return;
    }

    // Ensure this journal has a chat session
    if (!chatSessions[selectedJournal]) {
      setChatSessions({
        ...chatSessions,
        [selectedJournal]: Date.now().toString()
      });
    }

    const userMsg = { role: "user", text: input };
    const currentMsgs = messages[selectedJournal] || [];
    setMessages({
      ...messages,
      [selectedJournal]: [...currentMsgs, userMsg]
    });
    setInput("");

    const chatSessionId = chatSessions[selectedJournal] || Date.now().toString();
    const threadId = `${sessionId}-${selectedJournal}-${chatSessionId}`;

    try {
      const res = await fetch("http://localhost:3001/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          journalId: selectedJournal,
          threadId: threadId // Unique thread per journal chat session
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        setMessages((prev) => ({
          ...prev,
          [selectedJournal]: [...(prev[selectedJournal] || []), { role: "bot", text: "Error: " + errText }]
        }));
        return;
      }

      const data = await res.json();
      setMessages((prev) => ({
        ...prev,
        [selectedJournal]: [...(prev[selectedJournal] || []), { role: "bot", text: data.response }]
      }));
    } catch (err) {
      setMessages((prev) => ({
        ...prev,
        [selectedJournal]: [...(prev[selectedJournal] || []), { role: "bot", text: "Error: " + err.message }]
      }));
    }
  };

  const handleCorrectAnswer = async (messageIndex, originalText) => {
    const correctAnswer = prompt("Please provide the correct answer:", originalText);
    if (correctAnswer && correctAnswer.trim() !== "" && correctAnswer.trim() !== originalText) {
      try {
        const chatSessionId = chatSessions[selectedJournal] || Date.now().toString();
        const threadId = `${sessionId}-${selectedJournal}-${chatSessionId}`;

        await fetch("http://localhost:3001/correct-answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            journalId: selectedJournal,
            threadId: threadId,
            incorrectAnswer: originalText,
            correctAnswer: correctAnswer.trim()
          })
        });

        // Update the message with the corrected answer
        const currentMsgs = messages[selectedJournal] || [];
        const updatedMsgs = currentMsgs.map((msg, idx) => 
          idx === messageIndex ? { ...msg, text: correctAnswer.trim(), corrected: true } : msg
        );
        
        setMessages({
          ...messages,
          [selectedJournal]: updatedMsgs
        });

        alert("Corrected answer saved to memory!");
      } catch (err) {
        console.error("Error saving corrected answer:", err);
        alert("Failed to save corrected answer. Please try again.");
      }
    }
  };



  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>LangGraph Journal Memory Test</h1>
      
      {/* Upload Section */}
      <div style={{ marginBottom: "20px", border: "1px solid #ccc", padding: "10px" }}>
        <h3>1. Upload Journal (PDF)</h3>
        <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        <button onClick={handleUpload}>Upload to MySQL</button>
      </div>

      {/* Journal Selector */}
      <div style={{ marginBottom: "20px", border: "1px solid #ccc", padding: "10px" }}>
        <h3>2. Select Journal for Chat</h3>
        <select
          value={selectedJournal || ""}
          onChange={(e) => setSelectedJournal(e.target.value ? parseInt(e.target.value) : null)}
          style={{ width: "100%", padding: "8px", marginBottom: "10px" }}
        >
          <option value="">-- Select a journal --</option>
          {journals.map((j) => (
            <option key={j.id} value={j.id}>
              {j.filename}
            </option>
          ))}
        </select>
        {selectedJournal && (
          <p style={{ margin: "5px 0", color: "#666" }}>
            Currently chatting with: <strong>{journals.find(j => j.id === selectedJournal)?.filename}</strong>
          </p>
        )}
      </div>

      {/* Chat Section */}
      <div style={{ border: "1px solid #ddd", height: "400px", overflowY: "scroll", padding: "10px" }}>
        {getCurrentMessages().map((msg, idx) => (
          <div key={idx} style={{ textAlign: msg.role === "user" ? "right" : "left", margin: "10px" }}>
            <div style={{ position: "relative" }}>
              <span style={{
                background: msg.role === "user" ? "#007bff" : (msg.corrected ? "#28a745" : "#f1f1f1"),
                color: msg.role === "user" ? "white" : (msg.corrected ? "white" : "black"),
                padding: "8px",
                borderRadius: "5px",
                display: "inline-block"
              }}>
                {msg.text}
              </span>
              {msg.role === "bot" && !msg.corrected && (
                <button
                  onClick={() => handleCorrectAnswer(idx, msg.text)}
                  style={{
                    position: "absolute",
                    top: "-10px",
                    right: "-10px",
                    fontSize: "12px",
                    padding: "4px 8px",
                    backgroundColor: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "15px",
                    cursor: "pointer",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                    zIndex: 10
                  }}
                  title="Correct this answer"
                >
                  ✏️ Correct
                </button>
              )}
              {msg.corrected && (
                <span style={{
                  position: "absolute",
                  top: "-10px",
                  right: "-10px",
                  fontSize: "12px",
                  color: "#28a745",
                  fontWeight: "bold",
                  backgroundColor: "white",
                  padding: "2px 6px",
                  borderRadius: "10px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
                }}>
                  ✓ Corrected
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "10px" }}>
        <input
          style={{ width: "80%", padding: "10px" }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about the selected journal..."
        />
        <button style={{ width: "15%", padding: "10px" }} onClick={handleSend}>Send</button>
      </div>
    </div>
  );
}

export default App;