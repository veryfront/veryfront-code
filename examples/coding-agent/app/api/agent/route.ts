/**
 * Coding Agent API Route
 *
 * Uses the Claude Agent SDK — all tools (Bash, Read, Write, Edit, Glob, Grep,
 * WebSearch, WebFetch) are built-in. No manual tool implementations needed.
 *
 * Authentication: Uses your local Claude Code installation's auth.
 * No ANTHROPIC_API_KEY required.
 */

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid request: messages array required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Build prompt with conversation context
    const lastMessage = messages[messages.length - 1];
    const history = messages.slice(0, -1);

    let prompt = lastMessage.content;
    if (history.length > 0) {
      const context = history
        .map((m: { role: string; content: string }) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
        )
        .join("\n\n");
      prompt = `Previous conversation:\n${context}\n\nNow respond to: ${lastMessage.content}`;
    }

    // Dynamic import — only loads when handling requests
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    const conversation = query({
      prompt,
      options: {
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "acceptEdits",
        maxTurns: 15,
        systemPrompt: `You are a coding assistant for this project. You have full access to:
- Read and write files
- Run bash commands
- Search the codebase with glob/grep
- Search the web

Be helpful, thorough, and explain what you're doing.
When making changes, always read the file first to understand existing code.
After changes, verify them by reading the file or running tests.`,
      },
    });

    // Stream SDK results as SSE events (compatible with frontend parser)
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const message of conversation) {
            if (message.type === "assistant") {
              for (const block of message.message.content) {
                if (block.type === "text" && block.text) {
                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ type: "text-delta", textDelta: block.text })}\n\n`,
                  ));
                } else if (block.type === "tool_use") {
                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ type: "tool-call", toolName: block.name, args: block.input })}\n\n`,
                  ));
                }
              }
            }

            if (message.type === "result") {
              if (message.subtype !== "success" && "errors" in message) {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: "error", error: (message as { errors: string[] }).errors.join("\n") })}\n\n`,
                ));
              }
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`,
          ));
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

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
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
