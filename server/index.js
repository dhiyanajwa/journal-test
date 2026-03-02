// LOCATION: server/index.js
import 'dotenv/config'; // Loads .env file
import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import multer from 'multer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const app = express();
app.use(cors());
app.use(express.json());

// 1. MySQL Connection
const dbConfig = {
  host: "localhost",
  user: "root",       // <--- CHECK THIS
  password: "", // <--- CHECK THIS (empty string = no password)
  database: "journal_db",
};

// 2. Upload Configuration
const upload = multer({ storage: multer.memoryStorage() });

// 3. API: Upload PDF to MySQL
app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No file uploaded.");

    const buffer = req.file.buffer;
    const data = await pdf(buffer);
    const text = data.text;

    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
      "INSERT INTO journals (filename, content) VALUES (?, ?)",
      [req.file.originalname, text]
    );
    await connection.end();

    res.json({ message: "PDF stored in MySQL successfully" });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send("Error processing PDF: " + err.message);
  }
});

// 4. API: Get List of PDFs
app.get("/journals", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute("SELECT id, filename FROM journals");
    await connection.end();
    res.json(rows);
  } catch (error) {
    console.error("Database Error:", error);
    res.status(500).send("Database connection failed");
  }
});

// 5. LangGraph Logic
const model = new ChatOpenAI({
  model: "meta-llama/llama-3.1-8b-instruct",
  apiKey: process.env.OPENROUTER_API_KEY,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});

// Store conversation history per thread (only user and AI messages, no system)
const conversationHistory = new Map();

const graphBuilder = new StateGraph(MessagesAnnotation)
  .addNode("agent", async (state) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  })
  .addEdge("__start__", "agent")
  .addEdge("agent", "__end__");

const appGraph = graphBuilder.compile();

// 6. API: Chat with selected PDF
app.post("/chat", async (req, res) => {
  const { message, journalId, threadId } = req.body;

  try {
    if (!journalId) {
      return res.status(400).send("No journal selected. Please select a journal first.");
    }

    // Get the content for the selected journal
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute("SELECT content FROM journals WHERE id = ?", [journalId]);
    await connection.end();

    if (rows.length === 0) return res.status(404).send("Journal not found");

    const pdfContext = rows[0].content;

    // Get or initialize conversation history for this thread (only user/AI messages)
    const history = conversationHistory.get(threadId) || [];

    // Create system message with current journal content
    const systemPrompt = `You are a helpful assistant answering questions about journal articles.

    IMPORTANT: For this conversation turn, focus ONLY on the following journal content. Ignore any previous journal content that may have been discussed earlier in this conversation.

    Here is the content of the article you are currently analyzing:
    \n\n --- START JOURNAL CONTENT --- \n ${pdfContext.substring(0, 30000)} \n --- END JOURNAL CONTENT ---
    \n\n Answer the user's question based ONLY on the above content. Do not reference or use information from any other journals.`;

    const systemMessage = new SystemMessage(systemPrompt);

    // Prepare messages for the graph: system + history + new user message
    const allMessages = [systemMessage, ...history, new HumanMessage(message)];

    // Get AI response
    const result = await appGraph.invoke({ messages: allMessages });
    const botResponse = result.messages[result.messages.length - 1];

    // Update history with user message and AI response
    const updatedHistory = [...history, new HumanMessage(message), botResponse];
    conversationHistory.set(threadId, updatedHistory);

    res.json({ response: botResponse.content });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).send("Error in chat: " + error.message);
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});