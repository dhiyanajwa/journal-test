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
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { StateGraph, MessagesAnnotation, Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

console.log("🚀 !!! [SESSION B] SERVER RUNNING VERSION: LOCAL HUGGING FACE EMBEDDINGS (FREE) !!! 🚀");
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
    console.log(`📄 PDF parsed. Length: ${text.length} characters.`);

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
    console.log(`✂️ Split into ${chunks.length} chunks.`);

    const embeddings = new HuggingFaceTransformersEmbeddings({
      modelName: "Xenova/all-MiniLM-L6-v2",
    });

    sendProgress({ status: "embedding", message: `Generating and storing embeddings for ${chunks.length} chunks...`, total: chunks.length });
    console.log(`🧠 Generating local embeddings for ${chunks.length} chunks...`);

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i].pageContent;

      let vectorJson = null;
      try {
        const vector = await embeddings.embedQuery(chunkText);
        vectorJson = JSON.stringify(vector);
      } catch (embErr) {
        console.error("Embedding generation failed for chunk", i, embErr);
      }

      await connection.execute(
        "INSERT INTO journal_chunks (journal_id, content, embedding) VALUES (?, ?, ?)",
        [journalId, chunkText, vectorJson]
      );

      if (i % 10 === 0 || i === chunks.length - 1) {
        sendProgress({ status: "embedding", message: `Embedding & Indexing... ${i + 1}/${chunks.length}`, current: i + 1, total: chunks.length });
      }
    }

    await connection.end();
    console.log("✅ PDF indexing complete and stored in MySQL.");
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
        embedding JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (journal_id)
      )
    `);

    try {
      await connection.execute(`ALTER TABLE journal_chunks ADD COLUMN embedding JSON`);
      console.log("✅ Added embedding column to journal_chunks");
    } catch (e) {
      // Ignore if column already exists
    }

    console.log("✅ MySQL RAG & Persistence Tables Ready");
  } catch (err) {
    console.error("❌ Failed to initialize MySQL tables:", err.message);
  }
};
initDB();

// Cosine similarity helper
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return normA === 0 || normB === 0 ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const GraphState = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  context: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  journalId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  journalFilename: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  history: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  correctedAnswers: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  sendStatus: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => () => { },
  })
});

const retrieveNode = async (state) => {
  state.sendStatus("Embedding user question...");
  const lastMessage = state.messages[state.messages.length - 1].content;

  const embeddings = new HuggingFaceTransformersEmbeddings({
    modelName: "Xenova/all-MiniLM-L6-v2",
  });

  let questionVector = [];
  try {
    questionVector = await embeddings.embedQuery(lastMessage);
  } catch (err) {
    console.error("Failed to embed question:", err);
    return { context: "Error: Could not embed question for search." };
  }

  state.sendStatus("Searching database for relevant context...");
  const [chunkRows] = await pool.execute("SELECT content, embedding FROM journal_chunks WHERE journal_id = ?", [state.journalId]);

  let relevantContext = "";

  if (chunkRows.length > 0) {
    state.sendStatus(`Ranking ${chunkRows.length} chunks by semantic similarity...`);

    // Calculate similarities
    const scoredChunks = chunkRows.map(row => {
      let score = 0;
      if (row.embedding) {
        try {
          const chunkVector = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
          if (Array.isArray(chunkVector) && chunkVector.length === questionVector.length) {
            score = cosineSimilarity(questionVector, chunkVector);
          }
        } catch (e) {
          console.error("Failed to parse embedding", e);
        }
      }
      return { content: row.content, score: score };
    });

    const topChunks = scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, 8); // Reduced from 15 to 8 to avoid 400 error while keeping context high

    // Fallback: If top score is low, try a keyword search
    if (topChunks.length > 0 && topChunks[0].score < 0.3) {
      console.log("⚠️ Semantic score low, adding keyword results...");
      const keywords = lastMessage.split(' ').filter(w => w.length > 3);
      if (keywords.length > 0) {
        const likeQuery = keywords.map(() => "content LIKE ?").join(" OR ");
        const [kwRows] = await pool.execute(`SELECT content FROM journal_chunks WHERE journal_id = ? AND (${likeQuery}) LIMIT 5`, [state.journalId, ...keywords.map(k => `%${k}%`)]);
        kwRows.forEach(row => {
          if (!topChunks.find(c => c.content === row.content)) {
            topChunks.push({ content: row.content, score: 0.1 });
          }
        });
      }
    }

    relevantContext = topChunks.map(c => c.content).join("\n\n---\n\n");
    console.log(`🧠 Semantic search: Retrieved ${topChunks.length} chunks (Top score: ${topChunks[0]?.score?.toFixed(3) || 'N/A'})`);
  } else {
    state.sendStatus("No chunks found with embeddings, using full text fallback...");
    const [fullRows] = await pool.execute("SELECT content FROM journals WHERE id = ?", [state.journalId]);
    relevantContext = fullRows[0] ? fullRows[0].content.substring(0, 8000) : "";
  }

  return { context: relevantContext };
};

const generateNode = async (state) => {
  state.sendStatus("Generating response with Cerebras Llama 3.3...");
  const lastMessage = state.messages[state.messages.length - 1].content;

  let systemPrompt = `You are a strict and helpful assistant discussing the document: "${state.journalFilename}".

  CRITICAL RULES:
  1. You MUST use the specific information provided in the "RELEVANT CONTEXT" below to answer the user's question accurately.
  2. If the user's question asks for specific technical facts (numbers, precise names) that are NOT explicitly written in the provided context, you should reply verbatim: "Based on the available context from the document, I cannot find a specific answer to this question."
  3. However, if the answer can be reasonably inferred or summarized from the provided snippets, please do so.
  4. DO NOT invent, guess, or hallucinate quotes or facts.
  5. The user might ask a follow-up question. Use the conversation history provided to understand the context of their new question.`;

  if (state.correctedAnswers && state.correctedAnswers.length > 0) {
    systemPrompt += `\n\nIMPORTANT: The following corrections have been made in previous conversations and should be used as authoritative information over-riding the context:
    ${state.correctedAnswers.map((answer, index) => `${index + 1}. ${answer}`).join('\n')}`;
  }

  systemPrompt += `
  
  --- RELEVANT CONTEXT START ---
  ${state.context}
  --- RELEVANT CONTEXT END ---`;

  const contextualMessage = `${systemPrompt}\n\nUser Question: ${lastMessage}`;
  const allMessages = [...state.history, new HumanMessage(contextualMessage)];

  const response = await model.invoke(allMessages);
  return { messages: [response] };
};

const graphBuilder = new StateGraph(GraphState)
  .addNode("retrieve", retrieveNode)
  .addNode("generate", generateNode)
  .addEdge("__start__", "retrieve")
  .addEdge("retrieve", "generate")
  .addEdge("generate", "__end__");

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

    // Fetch History
    sendStatus("Fetching conversation history...");
    const [historyRows] = await pool.execute("SELECT role, content FROM conversation_history WHERE thread_id = ? ORDER BY created_at ASC LIMIT 10", [threadId]);

    const correctedAnswers = historyRows
      .filter(row => row.role === 'system' && row.content.startsWith('CORRECTED:'))
      .map(row => row.content.substring(10));

    const history = historyRows.map(row => {
      if (row.role === 'user') return new HumanMessage(row.content);
      if (row.role === 'assistant') return new AIMessage(row.content);
      if (row.role === 'system') return new SystemMessage(row.content);
      return new HumanMessage(row.content);
    });

    // Invoke LangGraph
    const result = await appGraph.invoke({
      messages: [new HumanMessage(message)],
      journalId,
      journalFilename,
      history,
      correctedAnswers,
      sendStatus
    });

    // The final message is the output from generating node
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