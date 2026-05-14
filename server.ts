import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit for base64 images
app.use(express.json({ limit: '10mb' }));

// Lazy init Gemini
let aiClient: GoogleGenAI | null = null;
const getAI = () => {
  if (!aiClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing in environment");
    }
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
  }
  return aiClient;
};

// Extractor Endpoint
app.post("/api/extract", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "No image provided" });

    // Remove data:image/...;base64, prefix if present
    const base64Data = image.split(",")[1] || image;
    
    const ai = getAI();
    
    const prompt = `
      You are an expert receipt analyzer. Extract data from this receipt with high precision.
      
      ADHERE TO THESE RULES:
      1. SPATIAL ANCHORING: Observe the columns. Item names are usually on the left, prices on the right. 
         Ignore store logos or generic headers unless they contain the store name.
      2. MATH-VOTER LOGIC: The sum of extracted item prices MUST equal the total amount. 
         If they do not match, re-read the numbers. Prices are often JOD (Jordanian Dinars) with 3 decimal places (e.g., 1.250).
      3. PERSPECTIVE CORRECTION: Read text accurately even if the image is slanted or warped.
      4. LANGUAGE: The receipt contains Arabic and English. Extract names in the language they appear.
      5. METADATA: Find the store name, date (YYYY-MM-DD), and time (HH:MM).
      6. CATEGORIZATION: Map each item to EXACTLY one of these categories:
         Groceries, Vegetables, Fruits, Cleaning Products, Electronics, Clothing, Home & Garden, Health & Beauty, Stationery, Dining, Transportation, Entertainment, Other.
      7. MULTILINGUAL EXTRACTION: For brands and names in Arabic, extract them as they appear. 
         - brand: Look for brand names like "Nutella", "Afia" (عافية), "Nestle", etc.
         - size: Look for volume (L, ml, لتر, مل) or weight (kg, g, كغم, غم).
      
      OUTPUT FORMAT: Return ONLY a JSON object.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Data } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            storeName: { type: Type.STRING },
            date: { type: Type.STRING },
            time: { type: Type.STRING },
            total: { type: Type.NUMBER },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  price: { type: Type.NUMBER },
                  quantity: { type: Type.NUMBER },
                  category: { type: Type.STRING },
                  brand: { type: Type.STRING },
                  size: { type: Type.STRING }
                }
              }
            }
          },
          required: ["storeName", "total", "items"]
        }
      }
    });

    const result = JSON.parse(response.text);
    
    // Add usage metadata and estimated price
    const usage = response.usageMetadata;
    const inputPrice = (usage?.promptTokenCount || 0) * (0.075 / 1000000);
    const outputPrice = (usage?.candidatesTokenCount || 0) * (0.30 / 1000000);
    const estimatedPrice = inputPrice + outputPrice;

    res.json({
      ...result,
      _usage: {
        promptTokens: usage?.promptTokenCount,
        completionTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        estimatedPriceUSD: estimatedPrice
      }
    });
  } catch (error: any) {
    console.error("Extraction error:", error);
    res.status(500).json({ error: error.message || "Failed to process image" });
  }
});

// Vite middleware for development
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const __dirname = path.resolve();
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

setupVite().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
