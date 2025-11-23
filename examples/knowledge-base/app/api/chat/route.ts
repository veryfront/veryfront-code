import { agent, initializeProviders, tool } from "veryfront/ai";
import { z } from "zod";

// Initialize providers
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
if (OPENAI_API_KEY) {
  initializeProviders({
    openai: { apiKey: OPENAI_API_KEY },
  });
}

// Load Knowledge Base (in-memory for demo)
// In production, use a real Vector DB (Pinecone, Weaviate, pgvector, etc.)
interface Chunk {
  id: string;
  source: string;
  content: string;
  embedding: number[];
}

let knowledgeBase: Chunk[] = [];
try {
  const data = await Deno.readTextFile(new URL("../../knowledge.json", import.meta.url));
  knowledgeBase = JSON.parse(data);
  console.log(`[RAG] Loaded ${knowledgeBase.length} chunks from knowledge base.`);
} catch (_e) {
  console.warn("[RAG] Warning: knowledge.json not found. Run 'deno task ingest' first.");
}

// Vector Math: Cosine Similarity
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dotProduct += valA * valB;
    magnitudeA += valA * valA;
    magnitudeB += valB * valB;
  }
  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

// Helper to embed query (same as ingest)
async function generateEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OpenAI API Key missing");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      input: text,
      model: "text-embedding-3-small",
    }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

// RAG Tool
const searchTool = tool({
  id: "searchDocs",
  description:
    "Search the documentation knowledge base for relevant information. Use this whenever the user asks a question about Veryfront or the documentation.",
  inputSchema: z.object({
    query: z.string().describe("The search query to find relevant documentation"),
  }),
  execute: async ({ query }) => {
    if (knowledgeBase.length === 0) {
      return "Error: Knowledge base is empty. Please tell the user to run 'deno task ingest'.";
    }

    try {
      const queryEmbedding = await generateEmbedding(query);

      // Rank by similarity
      const results = knowledgeBase.map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4); // Top 4 chunks

      return JSON.stringify(
        results.map((r) => ({
          source: r.chunk.source,
          content: r.chunk.content,
          similarity: r.score.toFixed(3),
        })),
        null,
        2,
      );
    } catch (e) {
      return `Error searching knowledge base: ${e}`;
    }
  },
});

// Agent
const ragAgent = agent({
  model: "openai/gpt-4o-mini", // Fast and cheap
  system: `You are a helpful Veryfront documentation assistant. 
  ALWAYS use the 'searchDocs' tool to find information before answering questions.
  If the search results don't contain the answer, admit that you don't know based on the available documentation.
  Cite the source files provided in the search results.`,
  tools: {
    searchDocs: searchTool,
  },
});

// API Route
export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = await ragAgent.stream({
      messages, // Pass full history
    });

    // Return standard AI stream
    return new Response(result, {
      headers: { "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Agent Error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
