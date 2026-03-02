import React, { useState, useEffect } from "react";
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
import { UploadFile, Send, Chat } from "@mui/icons-material";

function App() {
  const [journals, setJournals] = useState([]);
  const [file, setFile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [selectedJournal, setSelectedJournal] = useState(null); // Selected journal for chat
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "info" });

  // Create a unique session ID for LangGraph memory
  const [sessionId] = useState("session-" + Math.random().toString(36).substr(2, 9));

  // Function to parse basic markdown formatting
  const parseMarkdown = (text) => {
    if (!text) return "";
    let html = text;

    // Handle bold text **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Handle italic text *text* (avoiding matching bullet points by checking no leading/trailing space inside)
    html = html.replace(/(?<!\S)\*([^\s*][^*]*?[^\s*]|[^\s*])\*(?!\S)/g, '<em>$1</em>');

    // Handle bullet points (* at start of line -> •)
    html = html.replace(/^(\s*)\*\s+(.*)$/gm, '$1• $2');

    // Handle line breaks
    html = html.replace(/\n/g, '<br/>');

    return html;
  };

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

    try {
      await fetch("http://localhost:3001/upload", {
        method: "POST",
        body: formData,
      });
      // Could add a success snackbar here
      fetchJournals();
    } catch (error) {
      // Could add an error snackbar here
      console.error("Upload failed:", error);
    }
  };

  const getCurrentMessages = () => {
    return messages;
  };

  const handleSend = async () => {
    if (!input) return;
    if (!selectedJournal) {
      setSnackbar({
        open: true,
        message: "Please select a journal first.",
        severity: "warning"
      });
      return;
    }

    const userMsg = { role: "user", text: input };
    setMessages([...messages, userMsg]);
    setInput("");

    const threadId = sessionId; // Persistent thread for continuous memory across journals

    try {
      const res = await fetch("http://localhost:3001/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          journalId: selectedJournal,
          threadId: threadId // Persistent thread for continuous memory across journals
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        setMessages((prev) => [...prev, { role: "bot", text: "Error: " + errText }]);
        return;
      }

      const data = await res.json();
      setMessages((prev) => [...prev, { role: "bot", text: data.response }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "bot", text: "Error: " + err.message }]);
    }
  };

  return (
    <Box
      sx={{
        maxWidth: 800,
        width: '100%',
        margin: '0 auto',
        py: 4,
        px: 2,
        backgroundColor: 'white',
        borderRadius: 2,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <Typography variant="h4" component="h1" gutterBottom align="center" sx={{ mb: 4 }}>
        <Chat sx={{ mr: 1, verticalAlign: 'middle' }} />
        LangGraph Journal Memory Test
      </Typography>

      {/* Upload Section */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom align="center" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          1. Upload Journal (PDF)
        </Typography>
        <Box
          sx={{
            p: 3,
            backgroundColor: 'white',
            borderRadius: 2,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
            border: '1px solid #e0e0e0'
          }}
        >
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              component="label"
              startIcon={<UploadFile />}
              sx={{ borderRadius: 2 }}
            >
              Choose PDF
              <input
                type="file"
                hidden
                onChange={(e) => setFile(e.target.files[0])}
                accept=".pdf"
              />
            </Button>
            {file && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {file.name}
              </Typography>
            )}
            <Button
              variant="contained"
              onClick={handleUpload}
              disabled={!file}
              startIcon={<UploadFile />}
              sx={{ borderRadius: 2 }}
            >
              Upload to Database
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Journal Selector */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom align="center" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          2. Select Journal for Chat
        </Typography>
        <Box
          sx={{
            p: 3,
            backgroundColor: 'white',
            borderRadius: 2,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
            border: '1px solid #e0e0e0'
          }}
        >
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Select a journal</InputLabel>
            <Select
              value={selectedJournal || ""}
              onChange={(e) => setSelectedJournal(e.target.value ? parseInt(e.target.value) : null)}
              label="Select a journal"
              sx={{ borderRadius: 2 }}
            >
              <MenuItem value="">
                <em>-- Select a journal --</em>
              </MenuItem>
              {journals.map((j) => (
                <MenuItem key={j.id} value={j.id}>
                  {j.filename}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {selectedJournal && (
            <Alert severity="info" sx={{ mt: 1, borderRadius: 2, justifyContent: 'center' }}>
              Currently chatting with: <strong>{journals.find(j => j.id === selectedJournal)?.filename}</strong>
            </Alert>
          )}
        </Box>
      </Box>

      {/* Chat Section */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom align="center" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          Chat History
        </Typography>
        <Box
          sx={{
            p: 3,
            backgroundColor: 'white',
            borderRadius: 2,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
            border: '1px solid #e0e0e0'
          }}
        >
          <Box
            sx={{
              height: 400,
              overflowY: 'auto',
              border: 1,
              borderColor: 'grey.300',
              borderRadius: 1,
              p: 2,
              bgcolor: 'grey.50',
              '&::-webkit-scrollbar': {
                width: '8px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'grey.100',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'grey.400',
                borderRadius: '4px',
                '&:hover': {
                  backgroundColor: 'grey.500',
                },
              },
            }}
          >
            {getCurrentMessages().length === 0 ? (
              <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 10 }}>
                No messages yet. Select a journal and start chatting!
              </Typography>
            ) : (
              <List sx={{ width: '100%' }}>
                {getCurrentMessages().map((msg, idx) => (
                  <ListItem
                    key={idx}
                    sx={{
                      justifyContent: 'center',
                      mb: 1
                    }}
                  >
                    <Paper
                      elevation={1}
                      sx={{
                        p: 2,
                        maxWidth: '80%',
                        bgcolor: msg.role === "user" ? "primary.main" : "grey.100",
                        color: msg.role === "user" ? "white" : "text.primary",
                        borderRadius: 2,
                        border: msg.role === "user" ? '2px solid' : 'none',
                        borderColor: msg.role === "user" ? "primary.dark" : "transparent"
                      }}
                    >
                      <Typography
                        variant="body1"
                        align="left"
                        component="div"
                        dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.text || "") }}
                      />
                    </Paper>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Box>
      </Box>

      {/* Input Section */}
      <Box
        sx={{
          p: 3,
          backgroundColor: 'white',
          borderRadius: 2,
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e0e0e0'
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', alignItems: 'center' }}>
          <TextField
            fullWidth
            variant="outlined"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about the selected journal..."
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />
          <Button
            variant="contained"
            onClick={handleSend}
            disabled={!input || !selectedJournal}
            startIcon={<Send />}
            sx={{ minWidth: 100, borderRadius: 2 }}
          >
            Send
          </Button>
        </Box>
      </Box>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%', borderRadius: 2 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default App;
