// test-apis.ts
import axios from 'axios';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Step 1: Call APIs
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `I am a local restaurant business owner and I want to find my competitors in the area. 
      The location is 300 W Campbell Rd #100, Richardson, TX 75080`,
    });
    console.log(response.text);

    // Step 2: Co-join data
    // const combinedData = {
    //   fromApi1: api1Res.data,
    //   fromApi2: api2Res.data.results.filter(item => item.active) // Example processing
    // };

    // Step 3: AI analysis (e.g., analyze patterns)
    // const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
    // const aiPrompt = `Analyze this combined data: ${JSON.stringify(combinedData)}. Look for correlations.`;
    // const aiResponse = await openai.chat.completions.create({
    //   model: 'gpt-4', // or Grok if integrated
    //   messages: [{ role: 'user', content: aiPrompt }]
    // });
    // console.log('AI Analysis:', aiResponse.choices[0].message.content);

    // Step 4: Intermittent DB store (e.g., only if analysis flags something)
    // if (aiResponse.choices[0].message.content.includes('interesting')) {
    //   await pool.query('INSERT INTO analysis_results (data, timestamp) VALUES ($1, NOW())', [JSON.stringify(combinedData)]);
    //   console.log('Stored in DB');
    // }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // pool.end();
  }
}

main();