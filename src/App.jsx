import React, { useState, useEffect, useRef } from "react";
import {
  Container,
  Typography,
  Box,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
  List,
  ListItem,
  ListItemText,
  Divider,
  Alert,
  Snackbar,
} from "@mui/material";
import { UploadFile, Send, Chat, Menu, ChevronLeft, Person, SmartToy, ArrowUpward, ArrowDownward, DeleteOutline } from "@mui/icons-material";
import { IconButton } from "@mui/material";

function App() {
  const [journals, setJournals] = useState([]);
  const [file, setFile] = useState(null);
  const [chatSessions, setChatSessions] = useState([]); // List of all sessions
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [selectedJournal, setSelectedJournal] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [typingStatus, setTypingStatus] = useState("");
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "info" });

  const scrollRef = useRef(null);
  const scrollEndRef = useRef(null);

  // Helper for generating UUIDs
  const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "session-" + Math.random().toString(36).substr(2, 9);
  };

  // Function to parse basic markdown formatting
  const parseMarkdown = (text) => {
    if (!text) return "";
    let html = text.trim(); // 1. Trim leading/trailing spaces & newlines

    // 2. Bold: **text** -> <strong>text</strong>
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 3. Italic: *text* -> <em>text</em>
    html = html.replace(/(?<!\S)\*([^\s*][^*]*?[^\s*]|[^\s*])\*(?!\S)/g, '<em>$1</em>');

    // 4. Bullet points: * item -> • item
    html = html.replace(/^(\s*)\*\s+(.*)$/gm, '$1• $2');

    // 5. Handle multiple newlines (paragraph distance)
    html = html.replace(/\n\n+/g, '<div style="margin-bottom: 12px"></div>');

    // 6. Single newlines -> <br/>
    html = html.replace(/\n/g, '<br/>');

    return html;
  };

  // 1. Initial Hydration
  useEffect(() => {
    const savedSessions = localStorage.getItem("chat_sessions");
    const urlParams = new URLSearchParams(window.location.search);
    const urlThreadId = urlParams.get("thread");

    let initialSessions = [];
    if (savedSessions) {
      try {
        initialSessions = JSON.parse(savedSessions);
        setChatSessions(initialSessions);
      } catch (e) {
        console.error("Failed to parse saved sessions", e);
      }
    }

    // Determine initial active thread: URL > Latest Saved > New
    let initialThreadId = urlThreadId;
    if (!initialThreadId && initialSessions.length > 0) {
      initialThreadId = initialSessions[0].threadId;
    }

    if (initialThreadId) {
      const activeSession = initialSessions.find(s => s.threadId === initialThreadId);
      if (activeSession) {
        setActiveThreadId(activeSession.threadId);
        setMessages(activeSession.messages || []);
        setSelectedJournal(activeSession.selectedJournal || null);
        setSnackbar({ open: true, message: "Session Resumed", severity: "success" });
      } else if (urlThreadId) {
        // Thread in URL but not in storage (maybe shared link?)
        handleNewChat(urlThreadId);
      }
    } else {
      handleNewChat();
    }

    fetchJournals();
  }, []);

  // 2. Auto-Save to LocalStorage
  useEffect(() => {
    if (chatSessions.length > 0) {
      localStorage.setItem("chat_sessions", JSON.stringify(chatSessions));
    }
  }, [chatSessions]);

  // 3. Sync Active Thread to URL
  useEffect(() => {
    if (activeThreadId) {
      const url = new URL(window.location);
      if (url.searchParams.get("thread") !== activeThreadId) {
        url.searchParams.set("thread", activeThreadId);
        window.history.replaceState({}, "", url);
      }
    }
  }, [activeThreadId]);

  // 4. Auto-Scroll to bottom on new messages
  useEffect(() => {
    if (scrollEndRef.current) {
      scrollEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping]);

  const scrollToTop = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const scrollToBottom = () => {
    if (scrollEndRef.current) {
      scrollEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const fetchJournals = async () => {
    const res = await fetch("http://localhost:3001/journals");
    const data = await res.json();
    setJournals(data);
  };

  const handleDeleteJournal = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this journal and all its indexed data?")) return;

    try {
      const res = await fetch(`http://localhost:3001/journals/delete/${id}`, { method: "POST" });
      if (res.ok) {
        setSnackbar({ open: true, message: "Journal deleted", severity: "success" });
        fetchJournals();
        if (selectedJournal === id) {
          setSelectedJournal(null);
          updateActiveSession({ selectedJournal: null });
        }
      } else {
        const data = await res.json();
        setSnackbar({ open: true, message: "Error: " + data.message, severity: "error" });
      }
    } catch (error) {
      setSnackbar({ open: true, message: "Delete failed: " + error.message, severity: "error" });
    }
  };

  const handleNewChat = (specificId = null) => {
    const newId = specificId || generateUUID();
    const newSession = {
      threadId: newId,
      title: "New Chat",
      lastUpdated: new Date().toISOString(),
      messages: [],
      selectedJournal: null
    };

    setChatSessions(prev => [newSession, ...prev]);
    setActiveThreadId(newId);
    setMessages([]);
    setSelectedJournal(null);
  };

  const switchThread = (threadId) => {
    const session = chatSessions.find(s => s.threadId === threadId);
    if (session) {
      setActiveThreadId(threadId);
      setMessages(session.messages || []);
      setSelectedJournal(session.selectedJournal || null);
    }
  };

  const updateActiveSession = (updates) => {
    setChatSessions(prev => prev.map(s =>
      s.threadId === activeThreadId
        ? { ...s, ...updates, lastUpdated: new Date().toISOString() }
        : s
    ));
  };

  const [uploadStatus, setUploadStatus] = useState({ status: "", message: "", current: 0, total: 0 });

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("pdf", file);

    setUploadStatus({ status: "uploading", message: "Sending file to server...", current: 0, total: 0 });

    try {
      const response = await fetch("http://localhost:3001/upload", {
        method: "POST",
        body: formData
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(line => line.trim());

        for (const line of lines) {
          try {
            if (line.startsWith('{')) {
              const data = JSON.parse(line);
              setUploadStatus(data);

              if (data.status === "complete") {
                fetchJournals();
                setSnackbar({ open: true, message: "Upload and Indexing successful!", severity: "success" });
                setTimeout(() => setUploadStatus({ status: "", message: "", current: 0, total: 0 }), 3000);
              }
              if (data.status === "error") {
                setSnackbar({ open: true, message: "Upload failed: " + data.message, severity: "error" });
              }
            } else {
              // Non-JSON line (could be a raw error message from server)
              console.warn("Received non-JSON progress line:", line);
              setUploadStatus({ status: "error", message: "Server error occurred during processing." });
            }
          } catch (e) {
            console.error("Error parsing progress chunk", e);
          }
        }
      }
    } catch (error) {
      console.error("Upload failed:", error);
      setUploadStatus({ status: "error", message: "Connection error" });
    }
  };

  const handleSend = async () => {
    if (!input) return;
    if (!selectedJournal) {
      setSnackbar({ open: true, message: "Please select a journal first.", severity: "warning" });
      return;
    }

    const userMsg = { role: "user", text: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");

    // Update session title on first message
    const firstMsg = chatSessions.find(s => s.threadId === activeThreadId)?.messages?.length === 0;
    const titleUpdate = firstMsg ? { title: input.substring(0, 30) + (input.length > 30 ? "..." : "") } : {};
    updateActiveSession({ messages: newMessages, selectedJournal, ...titleUpdate });

    setIsTyping(true);
    setTypingStatus("Starting...");
    try {
      const res = await fetch("http://localhost:3001/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          journalId: selectedJournal,
          threadId: activeThreadId
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        const errorMsg = { role: "bot", text: "Error: " + errText };
        setMessages(prev => {
          const updated = [...prev, errorMsg];
          updateActiveSession({ messages: updated });
          return updated;
        });
        setIsTyping(false);
        setTypingStatus("");
        return;
      }

      // Read NDJSON stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResponse = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "status") {
              setTypingStatus(parsed.status);
            } else if (parsed.type === "response") {
              finalResponse = parsed.response;
            } else if (parsed.type === "error") {
              finalResponse = "Error: " + parsed.message;
            }
          } catch (e) {
            // skip malformed lines
          }
        }
      }

      const botMsg = { role: "bot", text: finalResponse || "Sorry, I couldn't generate a response." };
      setMessages(prev => {
        const updated = [...prev, botMsg];
        updateActiveSession({ messages: updated });
        return updated;
      });
    } catch (err) {
      const errorMsg = { role: "bot", text: "Error: " + err.message };
      setMessages(prev => {
        const updated = [...prev, errorMsg];
        updateActiveSession({ messages: updated });
        return updated;
      });
    } finally {
      setIsTyping(false);
      setTypingStatus("");
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: '#f8fafc', overflow: 'hidden' }}>
      {/* Sidebar */}
      <Box
        sx={{
          width: showSidebar ? 300 : 0,
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          bgcolor: 'white',
          borderRight: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: showSidebar ? '4px 0 15px rgba(0,0,0,0.03)' : 'none',
          zIndex: 10,
          overflow: 'hidden',
          whiteSpace: 'nowrap'
        }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" sx={{ fontWeight: '800', color: 'primary.main', ml: 1 }}>
            Sessions
          </Typography>
          <IconButton onClick={() => setShowSidebar(false)} size="small">
            <ChevronLeft />
          </IconButton>
        </Box>
        <Box sx={{ px: 2, pb: 2 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<Chat />}
            onClick={() => handleNewChat()}
            sx={{
              borderRadius: '12px',
              py: 1.5,
              fontWeight: '700',
              textTransform: 'none',
              boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)'
            }}
          >
            New Chat
          </Button>
        </Box>
        <Divider sx={{ mb: 1 }} />
        <List sx={{ flexGrow: 1, overflowY: 'auto', px: 1 }}>
          {chatSessions.map((session) => (
            <ListItem
              key={session.threadId}
              button
              selected={activeThreadId === session.threadId}
              onClick={() => switchThread(session.threadId)}
              sx={{
                mb: 0.5,
                borderRadius: '12px',
                transition: 'all 0.2s',
                '&.Mui-selected': {
                  bgcolor: 'primary.50',
                  color: 'primary.main',
                  '&:hover': { bgcolor: 'primary.100' },
                  '& .MuiListItemText-secondary': { color: 'primary.400' }
                }
              }}
            >
              <ListItemText
                primary={session.title}
                secondary={new Date(session.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                primaryTypographyProps={{
                  variant: 'body2',
                  fontWeight: activeThreadId === session.threadId ? '700' : '500',
                  noWrap: true
                }}
                secondaryTypographyProps={{ variant: 'caption', sx: { opacity: 0.7 } }}
              />
            </ListItem>
          ))}
        </List>
      </Box>

      {/* Main Content Area */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>

        {/* Top bar for mobile/collapsed view */}
        {!showSidebar && (
          <Box sx={{ p: 1, position: 'absolute', top: 8, left: 8, zIndex: 5 }}>
            <IconButton
              onClick={() => setShowSidebar(true)}
              sx={{ bgcolor: 'white', border: '1px solid #e2e8f0', '&:hover': { bgcolor: '#f1f5f9' } }}
            >
              <Menu />
            </IconButton>
          </Box>
        )}

        <Box
          ref={scrollRef}
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
            p: { xs: 2, md: 4 },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            scrollBehavior: 'smooth'
          }}
        >
          <Box sx={{ maxWidth: 1200, width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>

            <header style={{ marginBottom: '16px' }}>
              <Typography variant="h4" align="center" sx={{ fontWeight: '900', color: '#1e293b', letterSpacing: '-0.5px' }}>
                LangGraph Studio
              </Typography>
              <Typography variant="body2" align="center" color="text.secondary">
                Multiple Sessions • Persistent Memory • Groq Llama 3.3 Versatile
              </Typography>
            </header>

            {/* Config Box (Upload + Select) - STICKY */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              gap: 3,
              position: 'sticky',
              top: { xs: -16, md: -32 }, // Inverse of parent padding
              zIndex: 5,
              bgcolor: '#f8fafc',
              pb: 2,
              mx: -2,
              px: 2,
              pt: 1
            }}>
              <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0', borderRadius: '16px', bgcolor: 'white', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: '800', mb: 1.5, color: '#64748b', textTransform: 'uppercase' }}>
                  1. Context
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <Button
                    variant="outlined"
                    component="label"
                    size="small"
                    startIcon={<UploadFile />}
                    sx={{ borderRadius: '10px', textTransform: 'none' }}
                  >
                    Select PDF
                    <input type="file" hidden onChange={(e) => setFile(e.target.files[0])} accept=".pdf" />
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleUpload}
                    disabled={!file}
                    sx={{ borderRadius: '10px', textTransform: 'none' }}
                  >
                    Upload
                  </Button>
                  {file && <Typography variant="caption" sx={{ color: 'primary.main', noWrap: true }}>{file.name}</Typography>}
                </Box>
                {uploadStatus.status && (
                  <Box sx={{ mt: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption" sx={{ color: uploadStatus.status === 'error' ? 'error.main' : 'primary.main', fontWeight: 'bold' }}>
                        {uploadStatus.message}
                      </Typography>
                      {uploadStatus.total > 0 && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {Math.round((uploadStatus.current / uploadStatus.total) * 100)}%
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ width: '100%', height: 4, bgcolor: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                      <Box
                        sx={{
                          width: uploadStatus.total > 0 ? `${(uploadStatus.current / uploadStatus.total) * 100}%` : '100%',
                          height: '100%',
                          bgcolor: uploadStatus.status === 'error' ? 'error.main' : 'primary.main',
                          transition: 'width 0.3s ease',
                          animation: (!uploadStatus.total && uploadStatus.status !== 'complete') ? 'shimmer 1.5s infinite linear' : 'none'
                        }}
                      />
                    </Box>
                    <style>{`
                      @keyframes shimmer {
                        0% { opacity: 0.5; }
                        50% { opacity: 1; }
                        100% { opacity: 0.5; }
                      }
                    `}</style>
                  </Box>
                )}
              </Paper>

              <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0', borderRadius: '16px', bgcolor: 'white', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: '800', mb: 1.5, color: '#64748b', textTransform: 'uppercase' }}>
                  2. Journal
                </Typography>
                <FormControl fullWidth size="small">
                  <InputLabel>Active Database</InputLabel>
                  <Select
                    value={selectedJournal || ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      setSelectedJournal(val);
                      updateActiveSession({ selectedJournal: val });
                    }}
                    label="Active Database"
                    sx={{ borderRadius: '10px' }}
                  >
                    <MenuItem value=""><em>None</em></MenuItem>
                    {journals.map((j) => (
                      <MenuItem key={j.id} value={j.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>
                          {j.filename}
                        </span>
                        <IconButton
                          size="small"
                          onClick={(e) => handleDeleteJournal(j.id, e)}
                          sx={{
                            flexShrink: 0,
                            color: 'rgba(0,0,0,0.2)',
                            '&:hover': { color: 'error.main', bgcolor: 'rgba(211, 47, 47, 0.04)' }
                          }}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Paper>
            </Box>

            {/* Chat Area */}
            <Paper
              elevation={0}
              sx={{
                flexGrow: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: '600px',
                border: '1px solid #e2e8f0',
                borderRadius: '24px',
                bgcolor: '#ffffff',
                overflow: 'hidden',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)'
              }}
            >
              <Box sx={{ p: 2, borderBottom: '1px solid #f1f5f9', bgcolor: '#fcfcfc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: '700', color: '#64748b' }}>
                  Conversation ({messages.length} messages)
                </Typography>
                {selectedJournal && (
                  <Typography variant="caption" sx={{ bgcolor: 'primary.50', color: 'primary.main', px: 1.5, py: 0.5, borderRadius: '20px', fontWeight: 'bold' }}>
                    {journals.find(j => j.id === selectedJournal)?.filename}
                  </Typography>
                )}
              </Box>

              <Box sx={{ flexGrow: 1, p: 3, display: 'flex', flexDirection: 'column' }}>
                {messages.length === 0 ? (
                  <Box sx={{ m: 'auto', textAlign: 'center', opacity: 0.4 }}>
                    <SmartToy sx={{ fontSize: 60, mb: 1 }} />
                    <Typography variant="body1">Select a journal and start testing.</Typography>
                  </Box>
                ) : (
                  <List sx={{ width: '100%' }}>
                    {messages.map((msg, idx) => (
                      <ListItem
                        key={idx}
                        sx={{
                          mb: 3,
                          flexDirection: 'column',
                          alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                          padding: 0
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, gap: 1, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                          {msg.role === 'user' ? <Person sx={{ fontSize: 16, color: '#94a3b8' }} /> : <SmartToy sx={{ fontSize: 16, color: 'primary.main' }} />}
                          <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            {msg.role === 'user' ? 'You' : 'Assistant'}
                          </Typography>
                        </Box>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2.5,
                            maxWidth: '85%',
                            borderRadius: msg.role === "user" ? '20px 4px 20px 20px' : '4px 20px 20px 20px',
                            bgcolor: msg.role === "user" ? "primary.main" : "#f1f5f9",
                            color: msg.role === "user" ? "white" : "#334155",
                            lineHeight: 1.6
                          }}
                        >
                          <div dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.text || "") }} style={{ fontSize: '0.95rem' }} />
                          {!msg.text && msg.role === 'bot' && (
                            <Typography variant="body2" sx={{ fontStyle: 'italic', opacity: 0.6 }}>
                              Generated an empty response.
                            </Typography>
                          )}
                        </Paper>
                      </ListItem>
                    ))}
                    {isTyping && (
                      <ListItem sx={{ flexDirection: 'column', alignItems: 'flex-start', padding: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, gap: 1 }}>
                          <SmartToy sx={{ fontSize: 16, color: 'primary.main' }} />
                          <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            {typingStatus || "Thinking..."}
                          </Typography>
                        </Box>
                        <Box sx={{ p: 2, display: 'flex', gap: 1 }}>
                          <span className="dot-flashing"></span>
                          <style>{`
                          .dot-flashing {
                            width: 8px; height: 8px; border-radius: 5px; background-color: #94a3b8; color: #94a3b8;
                            animation: dot-flashing 1s infinite linear alternate; animation-delay: 0.5s;
                          }
                          @keyframes dot-flashing {
                            0% { background-color: #94a3b8; }
                            50%, 100% { background-color: #ebeef1; }
                          }
                        `}</style>
                        </Box>
                      </ListItem>
                    )}
                    {/* Anchor for auto-scroll */}
                    <div ref={scrollEndRef} />
                  </List>
                )}
              </Box>

              {/* Input Area */}
              <Box sx={{ p: 3, bgcolor: '#fcfcfc', borderTop: '1px solid #f1f5f9' }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', bgcolor: 'white', p: 1, borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                  <TextField
                    fullWidth
                    variant="standard"
                    multiline
                    maxRows={4}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message..."
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    InputProps={{ disableUnderline: true, sx: { px: 2, py: 0.5, fontSize: '0.95rem' } }}
                  />
                  <IconButton
                    onClick={handleSend}
                    disabled={!input || !selectedJournal}
                    sx={{
                      bgcolor: 'primary.main',
                      color: 'white',
                      '&:hover': { bgcolor: 'primary.dark' },
                      '&.Mui-disabled': { bgcolor: '#e2e8f0', color: '#94a3b8' },
                      borderRadius: '12px',
                      p: 1.5
                    }}
                  >
                    <Send fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
            </Paper>
          </Box>
        </Box>

        {/* Floating Navigation Buttons */}
        <Box sx={{
          position: 'fixed',
          bottom: 100,
          right: { xs: 20, md: 40 },
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          zIndex: 100
        }}>
          <IconButton
            onClick={scrollToTop}
            sx={{
              bgcolor: 'rgba(30, 41, 59, 0.7)',
              color: 'white',
              '&:hover': { bgcolor: 'rgba(30, 41, 59, 0.9)' },
              backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          >
            <ArrowUpward fontSize="small" />
          </IconButton>
          <IconButton
            onClick={scrollToBottom}
            sx={{
              bgcolor: 'rgba(30, 41, 59, 0.7)',
              color: 'white',
              '&:hover': { bgcolor: 'rgba(30, 41, 59, 0.9)' },
              backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          >
            <ArrowDownward fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ borderRadius: '12px' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default App;
