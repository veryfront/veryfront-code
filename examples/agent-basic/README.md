# Veryfront AI - Basic Example

This example demonstrates the core AI functionality:

- Creating a simple agent
- Defining tools
- Executing agent with tool calling
- Platform detection

## Setup

1. Set your API key (choose one method):

**Option A: Environment variable**
```bash
export OPENAI_API_KEY=sk-...
```

**Option B: .env file (recommended)**
```bash
# Copy the example and edit it
cp ../../.env.example .env

# Then edit .env and add your API key:
# OPENAI_API_KEY=sk-your-actual-key-here
```

2. Run the example:

```bash
deno run --allow-net --allow-env --allow-read example.ts
```

Note: `--allow-read` permission is needed to load .env files

## What It Does

1. Detects the current platform (Deno/Node/Bun/CF Workers)
2. Creates a simple calculator tool
3. Creates an agent that can use the calculator
4. Executes the agent with a math question (non-streaming)
5. Executes the agent with streaming to show real-time responses
6. Shows the agent's reasoning and tool usage
7. Compares non-streaming vs streaming approaches

## Streaming vs Non-Streaming

The example demonstrates both modes:

**Non-Streaming (`agent.generate()`)**
- Waits for complete response before returning
- Simpler API, easier to work with
- Best for: batch processing, server-side tasks, testing

**Streaming (`agent.stream()`)**
- Returns chunks as they're generated
- Real-time user feedback
- Better perceived performance
- Best for: chat UIs, interactive applications, long responses

Both modes now support:
- Tool calling and execution
- Multi-step reasoning
- Full agent loop with tool results

## Files

- `example.ts` - Main example code with both streaming and non-streaming
- `tools/calculator.ts` - Calculator tool definition
- `agents/math-assistant.ts` - Math assistant agent
