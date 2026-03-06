import mysql from 'mysql2/promise';

const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",
    database: "journal_db",
});

async function check() {
    const [journals] = await pool.execute("SELECT id, filename FROM journals ORDER BY id DESC LIMIT 1");
    if (journals.length === 0) {
        console.log("No journals found");
        process.exit(0);
    }
    const journalId = journals[0].id;
    const [chunks] = await pool.execute("SELECT COUNT(*) as count FROM journal_chunks WHERE journal_id = ?", [journalId]);
    const [examples] = await pool.execute("SELECT content, embedding FROM journal_chunks WHERE journal_id = ? LIMIT 2", [journalId]);

    console.log(`Journal: ${journals[0].filename} (ID: ${journalId})`);
    console.log(`Total chunks: ${chunks[0].count}`);
    examples.forEach((ex, i) => {
        const emb = JSON.parse(ex.embedding);
        console.log(`Chunk ${i + 1} embedding length: ${emb ? emb.length : 'NULL'}`);
        console.log(`Chunk ${i + 1} preview: ${ex.content.substring(0, 50)}...`);
    });
    process.exit(0);
}
check();
