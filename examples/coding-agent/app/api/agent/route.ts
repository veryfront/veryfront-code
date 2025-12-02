/**
 * Coding Agent API Route
 *
 * Uses Veryfront's autodiscovery to automatically register tools from ai/tools/
 */

import { agent, discoverAll, getProviderFromModel, initializeProviders } from "veryfront/ai";

// Helper to load .env file manually
async function loadEnvFile(): Promise<Record<string, string>> {
  try {
    const envPath = `${Deno.cwd()}/.env`;
    const content = await Deno.readTextFile(envPath);
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
  } catch {
    return {};
  }
}

const MODEL_ID = "anthropic/claude-3-5-sonnet-latest";

// Load .env and initialize providers at MODULE level (before any requests)
const env = await loadEnvFile();
const apiKey = env.ANTHROPIC_API_KEY || Deno.env.get("ANTHROPIC_API_KEY") || "";
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
  baseDir: Deno.cwd(),
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

      system: `You are an expert coding assistant with comprehensive capabilities.

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
3. **Explain Your Work**: Always explain what you're doing and why
4. **Ask for Confirmation**: Request approval before:
   - Deleting files
   - Making large-scale changes

Be helpful, thorough, and always prioritize code quality and maintainability.`,

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
    const stream = await codingAgent.stream({
      messages,
    });
    console.log("[POST] Stream created successfully, type:", typeof stream);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
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
