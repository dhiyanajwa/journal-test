import 'dotenv/config';

async function test(model) {
    try {
        const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.CEREBRAS_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: "Hi" }]
            })
        });
        console.log(`Model ${model}: Status ${res.status}`);
        const text = await res.text();
        console.log(`Response: ${text.substring(0, 100)}`);
    } catch (e) {
        console.log(`Failed for ${model}:`, e.message);
    }
}

async function run() {
    await test("llama3.1-8b");
    await test("llama-3.3-70b");
}
run();
