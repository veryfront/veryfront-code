// Conditional imports for file system operations
let fs: typeof import('node:fs/promises') | undefined;
let pathMod: typeof import('node:path') | undefined;

// @ts-ignore - Deno global
if (typeof Deno === 'undefined') {
  fs = await import('node:fs/promises');
  pathMod = await import('node:path');
}

// Helper for Cross-Platform CWD
function getCwd(): string {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.cwd();
  }
  return process.cwd();
}

// Helper for Cross-Platform Env
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  }
  // @ts-ignore - process global
  else if (typeof process !== 'undefined' && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

// Helper for Cross-Platform exitProcess
function exitProcess(code: number) {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    Deno.exit(code);
  }
  // @ts-ignore - process global
  else if (typeof process !== 'undefined') {
    // @ts-ignore - process global
    process.exit(code);
  }
}

const DOCS_DIR = pathMod ? pathMod.join(getCwd(), 'examples/knowledge-base/docs') : new URL("../docs", import.meta.url).pathname;
const OUTPUT_FILE = pathMod ? pathMod.join(getCwd(), 'examples/knowledge-base/knowledge.json') : new URL("../knowledge.json", import.meta.url).pathname;

// OpenAI Embedding Configuration
const EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_API_KEY = getEnv("OPENAI_API_KEY");

if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is required for embedding generation.");
  exitProcess(1);
}

interface Chunk {
  id: string;
  source: string;
  content: string;
  embedding: number[];
}

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${await res.text()}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

async function main() {
  console.log(`📂 Scanning documents in ${DOCS_DIR}...`);
  const chunks: Chunk[] = [];

  let entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];

  if (fs && pathMod) {
    entries = (await fs.readdir(DOCS_DIR, { withFileTypes: true })).map(entry => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    }));
  } else {
    // @ts-ignore - Deno global
    for await (const entry of Deno.readDir(DOCS_DIR)) {
      entries.push(entry);
    }
  }

  for (const entry of entries) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      console.log(`   Processing ${entry.name}...`);
      let content: string;

      if (fs && pathMod) {
        content = await fs.readFile(pathMod.join(DOCS_DIR, entry.name), { encoding: 'utf-8' });
      } else {
        // @ts-ignore - Deno global
        content = await Deno.readTextFile(pathMod ? pathMod.join(DOCS_DIR, entry.name) : join(DOCS_DIR, entry.name));
      }

      // Simple chunking strategy: Split by double newlines (paragraphs)
      // In production, use a smarter splitter (recursive char splitter, markdown splitter)
      const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 20);

      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i]?.trim() ?? "";
        if (!paragraph) continue;

        console.log(`     - Embedding chunk ${i + 1}/${paragraphs.length}`);

        try {
          const embedding = await generateEmbedding(paragraph);
          chunks.push({
            id: `${entry.name}-${i}`,
            source: entry.name,
            content: paragraph,
            embedding,
          });
        } catch (e) {
          console.error(`     ❌ Failed to embed chunk:`, e);
        }
      }
    }
  }

  console.log(`💾 Saving ${chunks.length} vector chunks to ${OUTPUT_FILE}...`);

  if (fs) {
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(chunks, null, 2), { encoding: 'utf-8' });
  } else {
    // @ts-ignore - Deno global
    await Deno.writeTextFile(OUTPUT_FILE, JSON.stringify(chunks, null, 2));
  }

  console.log("✅ Ingestion complete!");
}

main();
