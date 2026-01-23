/**
 * Coding Agent API Route
 *
 * Uses Veryfront's autodiscovery to automatically register tools from ai/tools/
 */

import { agent } from "veryfront/agent";
import { discoverAll } from "veryfront/mcp";
import { getProviderFromModel, initializeProviders } from "veryfront/provider";

// Cross-platform environment variable helper
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

// Cross-platform CWD helper
function getCwd(): string {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.cwd();
  }
  return process.cwd();
}

// Conditional imports for file system operations
let fs: typeof import('node:fs/promises') | undefined;
let pathMod: typeof import('node:path') | undefined;

// @ts-ignore - Deno global
if (typeof Deno === 'undefined') {
  fs = await import('node:fs/promises');
  pathMod = await import('node:path');
}

// Helper to load .env file manually for Node.js
async function loadEnvFile(): Promise<Record<string, string>> {
  try {
    // @ts-ignore - Deno global
    if (typeof Deno !== 'undefined') {
      // Deno.env handles .env files automatically if --allow-env is used.
      // For explicit file reading in Deno, use Deno.readTextFile
      return {}; // Or implement Deno.readTextFile logic if needed for specific .env files
    }

    if (fs && pathMod) {
      const envPath = pathMod.join(getCwd(), '.env');
      const content = await fs.readFile(envPath, { encoding: 'utf-8' });
      const env: Record<string, string> = {};

      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts.join("=").trim();
        }
      }
      return env;
    }
    return {};
  } catch {
    return {};
  }
}

const MODEL_ID = "anthropic/claude-3-5-sonnet-latest";

// Load .env and initialize providers at MODULE level (before any requests)
const env = await loadEnvFile();
const apiKey = env.ANTHROPIC_API_KEY || getEnv("ANTHROPIC_API_KEY") || "";
console.log("[API] ANTHROPIC_API_KEY present:", apiKey ? "YES" : "NO", "length:", apiKey.length);

initializeProviders({
  anthropic: {
    apiKey,
  },
});

// Debug: Verify provider can be retrieved
try {
  const _testProvider = getProviderFromModel(MODEL_ID);
  console.log("[API] Provider initialization successful - can retrieve provider");
} catch (err) {
  console.error("[API] Provider initialization FAILED:", err);
}

// Auto-discover tools from ai/tools/ directory (done at module level)
await discoverAll({
  baseDir: getCwd(),
  verbose: true, // Enable verbose logging during development
});

export async function POST(request: Request) {
  try {
    console.log("[POST] Handler invoked");

    const { messages } = await request.json();
    console.log("[POST] Received messages:", JSON.stringify(messages));

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid request: messages array required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Debug: Check provider accessibility in request context
    console.log("[POST] Verifying provider can be retrieved");
    try {
      const _testProvider = getProviderFromModel(MODEL_ID);
      console.log("[POST] Successfully retrieved provider for model");
    } catch (err) {
      console.error("[POST] Failed to retrieve provider:", err);
    }

    // Create agent with auto-discovered tools
    // Tools are referenced by their filenames (in kebab-case)
    const codingAgent = agent({
      model: MODEL_ID,

      system: `You are a coding assistant for this project.

## Your Capabilities:

### File Operations (All Platforms)
- \`readFile\`: Read file contents
- \`writeFile\`: Create or update files
- \`listFiles\`: Browse directories (use recursive: true for deep scan)

### Web Capabilities (All Platforms)
- \`webSearch\`: Search the web for documentation, examples, solutions

## Best Practices:

1. **Understand First**: Before making changes, read relevant files to understand the codebase
2. **Search When Needed**: Use web search for:
   - Latest documentation or API references
   - Debugging error messages
   - Finding code examples
   - Checking best practices
3. **Explain Your Work**: Explain what you're doing and why
4. **Ask for Confirmation**: Request approval before:
   - Deleting files
   - Making large-scale changes

Be thorough and prioritize code quality and maintainability.`,

      // Reference auto-discovered tools by their IDs (filenames in kebab-case)
      tools: {
        readFile: true,
        writeFile: true,
        listFiles: true,
        webSearch: true,
        // Add more tools as they're discovered
      },

      maxSteps: 15,
      memory: {
        type: "conversation",
        maxTokens: 12000,
      },
    });

    // Stream response from agent
    console.log("[POST] Calling agent.stream()...");
    const result = await codingAgent.stream({
      messages,
    });
    console.log("[POST] Stream created successfully");

    // Use toDataStreamResponse() for Vercel AI SDK compatible streaming
    return result.toDataStreamResponse();
  } catch (error) {
    console.error("[API] Error:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
