const OpenAI = require("openai");

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function explainCodeWithAI(code, fileName) {
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

    const response = await client.responses.create({
        model: "gpt-5.4",
        input: prompt
    });

    return response.output_text || "No AI explanation generated.";
}

module.exports = { explainCodeWithAI };