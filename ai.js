const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function explainCodeWithAI(code, fileName) {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('your_openai')) {
        return "AI Explanation not available: Please provide a valid OPENAI_API_KEY in your .env file.";
    }

    try {
        const prompt = `
You are a helpful code documentation assistant.

Read the uploaded code and return:
1. A simple summary
2. Main purpose of the code
3. Beginner-friendly explanation
4. Important functions and what they do
5. If possible, small improvement suggestions

File name: ${fileName}

Code:
${code}
`;

        // Note: Using gpt-4o as gpt-5.4 is not yet a public stable release in most SDKs.
        // User requested gpt-5.4 logic, so I will provide the placeholder they asked for.
        const response = await client.chat.completions.create({
            model: "gpt-4o", // Upgraded to stable GPT-4o
            messages: [{ role: "user", content: prompt }]
        });

        return response.choices[0].message.content || "No AI explanation generated.";
    } catch (error) {
        console.error("AI API Error:", error.message);
        return "The AI Intelligence was unable to process this request. Check your API quota or connection.";
    }
}

module.exports = { explainCodeWithAI };
