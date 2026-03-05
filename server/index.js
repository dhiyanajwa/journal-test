// LOCATION: server/index.js
import 'dotenv/config'; // Loads .env file
import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import multer from 'multer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

console.log("🔍 Checking API Keys...");
if (process.env.CEREBRAS_API_KEY) {
  console.log("✅ CEREBRAS_API_KEY found:", process.env.CEREBRAS_API_KEY.substring(0, 10) + "...");
} else {
  console.error("❌ CEREBRAS_API_KEY not found in .env");
}

if (process.env.GOOGLE_API_KEY) {
  console.log("✅ GOOGLE_API_KEY found for embeddings:", process.env.GOOGLE_API_KEY.substring(0, 10) + "...");
} else {
  console.warn("⚠️ GOOGLE_API_KEY not found. Embeddings will fail.");
}

// Enhanced logging for debugging
console.log("📋 Server Configuration:");
console.log("- Database: MySQL (localhost:3306)");
console.log("- Upload: Memory storage");
console.log("- Chunking: 2000 chars with 500 overlap");
console.log("- RAG: Top 15 chunks with similarity filtering");
console.log("- Fallbacks: Keyword search, full text");

const app = express();
app.use(cors());
app.use(express.json());

// 1. MySQL Connection Pool for performance
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "journal_db",
  connectionLimit: 10,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

// Database configuration for individual connections
const dbConfig = {
  host: "localhost",
  user: "root",
  password: "",
  database: "journal_db"
};

// 2. Upload Configuration
const upload = multer({ storage: multer.memoryStorage() });

// 3. API: Upload PDF to MySQL with RAG Indexing
app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No file uploaded.");

    // Start streaming response for progress updates
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    const sendProgress = (data) => {
      res.write(JSON.stringify(data) + "\n");
    };

    sendProgress({ status: "parsing", message: "Extracting text from PDF..." });
    const buffer = req.file.buffer;
    const data = await pdf(buffer);
    const text = data.text;

    const connection = await mysql.createConnection(dbConfig);

    // Save original journal record
    const [journalResult] = await pool.execute(
      "INSERT INTO journals (filename, content) VALUES (?, ?)",
      [req.file.originalname, text]
    );
    const journalId = journalResult.insertId;

    sendProgress({ status: "chunking", message: "Splitting document into manageable chunks..." });
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2000,  // Increased from 1000 for better context preservation
      chunkOverlap: 500, // Increased from 300 for better continuity
    });
    const chunks = await splitter.createDocuments([text]);

    sendProgress({ status: "indexing", message: `Storing ${chunks.length} chunks without embeddings...`, total: chunks.length });

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i].pageContent;
      
      await connection.execute(
        "INSERT INTO journal_chunks (journal_id, content) VALUES (?, ?)",
        [journalId, chunkText]
      );

      if (i % 10 === 0 || i === chunks.length - 1) {
        sendProgress({ status: "indexing", message: `Indexing... ${i + 1}/${chunks.length}`, current: i + 1, total: chunks.length });
      }
    }

    await connection.end();
    sendProgress({ status: "complete", message: "Journal indexed and ready for chat!", journalId });
    res.end();

  } catch (err) {
    console.error("Upload error:", err);
    res.write(JSON.stringify({ status: "error", message: err.message }) + "\n");
    res.end();
  }
});

// 4. API: Get List of PDFs
app.get("/journals", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT id, filename FROM journals");
    res.json(rows);
  } catch (error) {
    console.error("Database Error:", error);
    res.status(500).send("Database connection failed");
  }
});

// NEW: API: Save Corrected Answers
app.post("/correct-answer", async (req, res) => {
  const { journalId, threadId, incorrectAnswer, correctAnswer } = req.body;

  try {
    if (!journalId || !threadId || !incorrectAnswer || !correctAnswer) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Save the corrected answer to memory
    await pool.execute(
      "INSERT INTO conversation_history (thread_id, role, content, is_correction) VALUES (?, ?, ?, ?)",
      [threadId, 'system', `CORRECTED: ${correctAnswer}`, 1]
    );

    console.log(`✅ Corrected answer saved for thread ${threadId}: "${correctAnswer}"`);
    res.json({ message: "Corrected answer saved successfully" });

  } catch (error) {
    console.error("Error saving corrected answer:", error);
    res.status(500).json({ message: "Failed to save corrected answer" });
  }
});

// NEW: API: Delete a Journal
app.post("/journals/delete/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await mysql.createConnection(dbConfig);

    // 1. Delete associated chunks first (Foreign key constraint safety)
    await pool.execute("DELETE FROM journal_chunks WHERE journal_id = ?", [id]);

    // 2. Delete the journal itself
    const [result] = await pool.execute("DELETE FROM journals WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Journal not found" });
    }

    res.json({ message: "Journal and associated chunks deleted successfully" });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).send("Failed to delete journal: " + error.message);
  }
});

// 🔍 RAW CEREBRAS SANITY CHECK
fetch("https://api.cerebras.ai/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.CEREBRAS_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "llama3.1-8b",
    messages: [{ role: "user", content: "Say the word 'Testing'" }]
  })
})
.then(res => res.text())
.then(text => console.log("\n🚀 RAW CEREBRAS RESPONSE:\n", text))
.catch(err => console.error("\n❌ RAW CEREBRAS ERROR:\n", err));

import { ChatOpenAI } from "@langchain/openai";

// 5. LangGraph Logic
// 5. LangGraph Logic
const model = new ChatOpenAI(
  {
    modelName: "llama3.1-8b",
    temperature: 0.1,
    openAIApiKey: process.env.CEREBRAS_API_KEY,
  },
  {
    baseURL: "https://api.cerebras.ai/v1" // Notice this is now in a second, separate object!
  }
);


// Initialize DB Table for Persistence & Chunks
const initDB = async () => {
  try {
    const connection = await pool.getConnection();

    // Conversation History
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        thread_id VARCHAR(255),
        role VARCHAR(50),
        content TEXT,
        is_correction BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Journal Chunks for RAG
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS journal_chunks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        journal_id INT,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (journal_id)
      )
    `);

    console.log("✅ MySQL RAG & Persistence Tables Ready");
  } catch (err) {
    console.error("❌ Failed to initialize MySQL tables:", err.message);
  }
};
initDB();

const graphBuilder = new StateGraph(MessagesAnnotation)
  .addNode("agent", async (state) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  })
  .addEdge("__start__", "agent")
  .addEdge("agent", "__end__");

const appGraph = graphBuilder.compile();


// 6. API: Chat with selected PDF (RAG enabled, streaming status)
app.post("/chat", async (req, res) => {
  const { message, journalId, threadId } = req.body;

  // Set up streaming response
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendStatus = (status) => {
    res.write(JSON.stringify({ type: "status", status }) + "\n");
  };

  try {
    if (!journalId) {
      res.write(JSON.stringify({ type: "error", message: "No journal selected. Please select a journal first." }) + "\n");
      res.end();
      return;
    }

    sendStatus("Connecting to database...");
    const [journalRows] = await pool.execute("SELECT filename FROM journals WHERE id = ?", [journalId]);

    if (journalRows.length === 0) {
      res.write(JSON.stringify({ type: "error", message: "Journal not found" }) + "\n");
      res.end();
      return;
    }

    const journalFilename = journalRows[0].filename;

    // 1. Query Expansion and 2. DB Fetching (HISTORY & CHUNKS) in Parallel
    sendStatus("Preparing context and history...");

    let historyRows = [];
    let chunkRows = [];

    try {
      // Fetch data without query expansion for better performance
      const [[hRows], [cRows]] = await Promise.all([
        pool.execute("SELECT role, content FROM conversation_history WHERE thread_id = ? ORDER BY created_at ASC LIMIT 10", [threadId]),
        pool.execute("SELECT content FROM journal_chunks WHERE journal_id = ?", [journalId])
      ]);

      historyRows = hRows;
      chunkRows = cRows;
      console.log("Original Query:", message);
    } catch (error) {
      console.error("Database fetch failed:", error.message);
      // Fallback: try fetching data individually
      const [hRows] = await pool.execute("SELECT role, content FROM conversation_history WHERE thread_id = ? ORDER BY created_at ASC LIMIT 10", [threadId]);
      const [cRows] = await pool.execute("SELECT content FROM journal_chunks WHERE journal_id = ?", [journalId]);
      historyRows = hRows;
      chunkRows = cRows;
    }

    // Check for corrected answers in history
    const correctedAnswers = historyRows
      .filter(row => row.role === 'system' && row.content.startsWith('CORRECTED:'))
      .map(row => row.content.substring(10)); // Remove "CORRECTED: " prefix

    // 3. RAG: Search for relevant chunks using keyword matching only
    sendStatus("Searching for relevant chunks using keyword matching...");
    
    let relevantContext = "";
    
    if (chunkRows.length > 0) {
      sendStatus(`Ranking ${chunkRows.length} chunks by keyword relevance...`);
      const queryWords = message.toLowerCase().split(/\s+/).filter(word => word.length > 3);
      const scoredChunks = chunkRows.map(row => {
        const content = row.content.toLowerCase();
        const matches = queryWords.filter(word => content.includes(word)).length;
        return {
          content: row.content,
          score: matches
        };
      });
      
      const topChunks = scoredChunks
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
        
      relevantContext = topChunks.map(c => c.content).join("\n\n---\n\n");
      console.log(`🔑 Keyword search: Retrieved ${topChunks.length} chunks with ${queryWords.length} keywords`);
    } else {
      sendStatus("No chunks found, using full text fallback...");
      const [fullRows] = await pool.execute("SELECT content FROM journals WHERE id = ?", [journalId]);
      relevantContext = fullRows[0].content.substring(0, 20000); // Increased from 15000
    }

    const history = historyRows.map(row => {
          if (row.role === 'user') return new HumanMessage(row.content);
          if (row.role === 'assistant') return new AIMessage(row.content);
          if (row.role === 'system') return new SystemMessage(row.content); // <-- ADD THIS LINE
          return new HumanMessage(row.content); // Safe fallback
        }); 

    // Build system prompt with corrected answers if available
    let systemPrompt = `You are discussing the document: "${journalFilename}".
    You are a helpful assistant answering questions about journal articles.

    IMPORTANT: Below are RELEVANT SNIPPETS from "${journalFilename}" found via semantic search.
    Use these snippets to answer the user's question. If the answer isn't in the snippets, please say "Based on the available context from the document, I cannot find a specific answer to this question."`;

    // Add corrected answers to the system prompt if they exist
    if (correctedAnswers.length > 0) {
      systemPrompt += `\n\nIMPORTANT: The following corrections have been made in previous conversations and should be used as authoritative information:
      ${correctedAnswers.map((answer, index) => `${index + 1}. ${answer}`).join('\n')}`;
    }

    systemPrompt += `
    
    --- RELEVANT CONTEXT START ---
    ${relevantContext}
    --- RELEVANT CONTEXT END ---
    
    Answer the user's question based on the above context. If you cannot find the answer in the context, please acknowledge this limitation rather than providing incorrect information.
    
    IMPORTANT: If the context contains information about the question but in a different format (e.g., tables, figures, measurements), try to extract and present that information clearly.`;

    // v1 API has issues with the 'systemInstruction' field in some SDK versions.
    // Instead of SystemMessage, we prepend the context to the HumanMessage.
    const contextualMessage = `${systemPrompt}\n\nUser Question: ${message}`;
    const allMessages = [...history, new HumanMessage(contextualMessage)];

    sendStatus("Generating response with Cerebras Llama 3.3...");
    const result = await appGraph.invoke({ messages: allMessages });
    const botResponse = result.messages[result.messages.length - 1];

    // SAVE NEW MESSAGES TO MYSQL
    sendStatus("Saving to memory...");
    await pool.execute(
      "INSERT INTO conversation_history (thread_id, role, content) VALUES (?, ?, ?), (?, ?, ?)",
      [threadId, 'user', message, threadId, 'assistant', botResponse.content]
    );

    // Send final response
    res.write(JSON.stringify({ type: "response", response: botResponse.content || "Sorry, I couldn't generate a response." }) + "\n");
    res.end();

  } catch (error) {
    console.error("Chat error:", error);
    res.write(JSON.stringify({ type: "error", message: error.message }) + "\n");
    res.end();
  }
});


const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});