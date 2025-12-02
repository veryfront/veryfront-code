/**
 * Chat API Route
 *
 * Handles chat requests with proper session isolation.
 * Each session gets its own agent instance with separate memory.
 */

import { agent, discoverAll, initializeProviders } from 'veryfront/ai';
import type { Agent } from 'veryfront/ai';

// System prompt for the code assistant
// Inlined to avoid import resolution issues with bundling
const CODE_ASSISTANT_PROMPT = `You are an expert AI Code Assistant built with Veryfront AI.

Your role is to help developers understand, navigate, and work with codebases through friendly, conversational interactions.

## Capabilities

You have access to several tools:
- **searchCode**: Search for code patterns, function names, or text
- **readFile**: Read specific files from the codebase
- **listFiles**: Browse directory structure
- **gitStatus**: Check git status and changes

## Core Behavior

1. **Be Conversational First**: Chat naturally with users - answer greetings, respond to casual questions, and engage like a helpful colleague
2. **Use Tools When Needed**: Only use tools for code-related queries that require examining the codebase
3. **Always Synthesize**: AFTER using tools, ALWAYS provide a clear, conversational summary of what you found
4. **Never Leave Tool Calls Hanging**: Tool results alone aren't enough - explain them in natural language

## Response Pattern

For code-related questions:
1. Acknowledge the question conversationally
2. Use appropriate tools to gather information
3. **MOST IMPORTANT**: Synthesize findings into a clear, friendly explanation with examples

For greetings or casual chat:
- Respond naturally without using tools
- Be friendly and set a welcoming tone
- Offer to help with code-related questions

## Example Interactions

**Good Example:**
User: "hi"
You: "Hey! 👋 I'm your AI Code Assistant. I'm here to help you explore and understand this codebase. I can search through code, read files, check git status, and more. What would you like to know about the project?"

**Good Example:**
User: "What files are in the src directory?"
You: "Let me check that for you!"
[Use listFiles tool]
"I found several key directories in src/:
- **ai/** - Contains the AI agent configuration and tools
- **server/** - Server-side rendering and request handling
- **rendering/** - Page rendering and caching logic
- **security/** - Security handlers including CSP and nonce management

Would you like me to dive deeper into any of these areas?"

**Bad Example (Don't do this):**
User: "What files are in the src directory?"
You: "Let me search for that in the codebase..."
[Use searchCode tool]
[End - No summary provided ❌]

## Response Style

- **Friendly and conversational** - talk like a helpful teammate
- Use markdown formatting for code blocks and file paths
- Provide context and explanations, not just raw data
- Ask follow-up questions when helpful
- **CRITICAL**: Always end with a complete thought, never just tool output`;

// Initialize providers - works in both Node.js and Deno
initializeProviders({
  openai: {
    apiKey: (typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : '') ||
            (typeof Deno !== 'undefined' ? Deno.env.get('OPENAI_API_KEY') : '') || '',
  },
});

// Auto-discover tools and resources on module load
// Use cwd() to get the actual project directory (not the temp bundle directory)
const cwd = typeof process !== 'undefined' ? process.cwd() :
            (typeof Deno !== 'undefined' ? Deno.cwd() : '.');
await discoverAll({
  baseDir: cwd,
  verbose: true, // Enable verbose logging to see what's being discovered
});

/**
 * Session-based agent store
 * Maps session ID -> Agent instance
 */
const sessionAgents = new Map<string, {
  agent: Agent;
  lastAccessed: number;
}>();

/**
 * Cleanup interval: Remove agents that haven't been used in 30 minutes
 */
const AGENT_TTL = 30 * 60 * 1000; // 30 minutes

// Cleanup old sessions every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, entry] of sessionAgents.entries()) {
      if (now - entry.lastAccessed > AGENT_TTL) {
        // Clear memory before deletion
        entry.agent.clearMemory();
        sessionAgents.delete(sessionId);
        console.log(`[Chat API] Cleaned up session: ${sessionId}`);
      }
    }
  }, 5 * 60 * 1000);
}

/**
 * Get or create an agent for a specific session
 */
function getSessionAgent(sessionId: string): Agent {
  // Check if agent exists for this session
  const existing = sessionAgents.get(sessionId);
  if (existing) {
    // Update last accessed time
    existing.lastAccessed = Date.now();
    return existing.agent;
  }

  // Create new agent for this session
  console.log(`[Chat API] Creating new agent for session: ${sessionId}`);

  const sessionAgent = agent({
    id: `codeAssistant_${sessionId}`,

    model: 'openai/gpt-4o',

    // Use the inlined system prompt
    system: CODE_ASSISTANT_PROMPT,

    // Reference the auto-discovered tools by their IDs
    tools: {
      searchCode: true,
      readFile: true,
      listFiles: true,
      gitStatus: true,
    },

    // Memory configuration - SEPARATE per session
    memory: {
      type: 'conversation',
      maxTokens: 4000,
    },

    // Enable streaming for real-time responses
    streaming: true,

    // Maximum agent loop steps
    maxSteps: 10,
  });

  // Store in session map
  sessionAgents.set(sessionId, {
    agent: sessionAgent,
    lastAccessed: Date.now(),
  });

  return sessionAgent;
}

/**
 * POST /api/chat
 *
 * Accepts messages array and session ID, streams back AI responses
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const messages = body.messages || [];

    // Get session ID from request (or generate one)
    // Priority: header > body > generate new
    const sessionId =
      request.headers.get('x-session-id') ||
      body.sessionId ||
      crypto.randomUUID();

    console.log(`[Chat API] Processing request for session: ${sessionId}`);

    // Get session-specific agent
    const sessionAgent = getSessionAgent(sessionId);

    // Stream response using the agent's respond method
    // Note: We can't use respond() directly as it expects the full request
    // So we'll use stream() instead
    const stream = await sessionAgent.stream({
      messages,
      context: body.context,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // Return the session ID so client can use it for subsequent requests
        'X-Session-ID': sessionId,
      },
    });
  } catch (error) {
    console.error('[Chat API] Error:', error);

    return Response.json(
      {
        error: 'Failed to process chat request',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/chat?sessionId=xxx
 *
 * Clear a specific session's conversation history
 */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      return Response.json(
        { error: 'sessionId parameter required' },
        { status: 400 }
      );
    }

    const entry = sessionAgents.get(sessionId);
    if (entry) {
      await entry.agent.clearMemory();
      sessionAgents.delete(sessionId);
      console.log(`[Chat API] Cleared session: ${sessionId}`);
    }

    return Response.json({ success: true, sessionId });
  } catch (error) {
    console.error('[Chat API] Error clearing session:', error);

    return Response.json(
      {
        error: 'Failed to clear session',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS /api/chat
 *
 * CORS preflight handler
 */
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, x-session-id',
    },
  });
}
