/**
 * Veryfront AI - Basic Example
 *
 * Demonstrates:
 * - Platform detection
 * - Tool creation and registration
 * - Agent creation and execution
 * - Tool calling
 * - Non-streaming vs streaming responses
 */

// Platform
import { detectPlatform, getPlatformCapabilities, getPlatformWarnings } from 'veryfront';

// Providers
import { initializeProviders } from 'veryfront/provider';

// Agent & Tool factories
import { agent } from 'veryfront/agent';
import { tool, registerTool } from 'veryfront/tool';

// MCP
import { getMCPStats } from 'veryfront/mcp';

import { z } from 'zod';

// ============================================================================
// Helpers for Cross-Platform Compatibility (Deno/Node)
// ============================================================================

function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  }
  // @ts-ignore - process global
  if (typeof process !== 'undefined' && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

function writeStdout(text: string) {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    Deno.stdout.writeSync(new TextEncoder().encode(text));
  }
  // @ts-ignore - process global
  else if (typeof process !== 'undefined' && process.stdout) {
    // @ts-ignore - process global
    process.stdout.write(text);
  } else {
    console.log(text);
  }
}

// ============================================================================
// 1. Platform Detection
// ============================================================================

console.log('=== Platform Detection ===');
const platform = detectPlatform();
const capabilities = getPlatformCapabilities();
const warnings = getPlatformWarnings();

console.log(`Platform: ${platform}`);
console.log(`Display Name: ${capabilities.displayName}`);
console.log(`Can run MCP Server: ${capabilities.canRunMCPServer}`);
console.log(`Max Agent Steps: ${capabilities.maxAgentSteps}`);
console.log(`Has File System: ${capabilities.hasFileSystem}`);

if (warnings.length > 0) {
  console.log('\nWarnings:');
  warnings.forEach((w) => console.log(`  - ${w}`));
}

// ============================================================================
// 2. Initialize Providers
// ============================================================================

console.log('\n=== Provider Initialization ===');

initializeProviders({
  openai: {
    apiKey: getEnv('OPENAI_API_KEY') || 'sk-test',
  },
  anthropic: {
    apiKey: getEnv('ANTHROPIC_API_KEY') || 'sk-ant-test',
  },
});

console.log('Providers initialized');

// ============================================================================
// 3. Create Tools
// ============================================================================

console.log('\n=== Tool Creation ===');

const calculatorTool = tool({
  id: 'calculator',
  description: 'Perform basic arithmetic operations',
  inputSchema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  execute: async ({ operation, a, b }) => {
    console.log(`  [Tool] Calculating: ${a} ${operation} ${b}`);

    switch (operation) {
      case 'add':
        return { result: a + b };
      case 'subtract':
        return { result: a - b };
      case 'multiply':
        return { result: a * b };
      case 'divide':
        if (b === 0) {
          throw new Error('Cannot divide by zero');
        }
        return { result: a / b };
    }
  },
});

// Register tool
registerTool('calculator', calculatorTool);

console.log('Tool "calculator" created and registered');

// ============================================================================
// 4. Create Agent
// ============================================================================

console.log('\n=== Agent Creation ===');

const mathAgent = agent({
  id: 'mathAssistant',
  model: 'openai/gpt-4o',
  system: `You are a helpful math assistant.
When the user asks a math question, use the calculator tool to compute the answer.
Always show your work and explain the result.`,

  tools: {
    calculator: true, // Use registered tool
  },

  maxSteps: 5,
  streaming: false,
});

console.log('Agent "mathAssistant" created');
console.log(`  Model: ${mathAgent.config.model}`);
console.log(`  Max Steps: ${mathAgent.config.maxSteps}`);
console.log(`  Tools: ${Object.keys(mathAgent.config.tools || {}).join(', ')}`);

// ============================================================================
// 5. Show MCP Stats
// ============================================================================

console.log('\n=== MCP Registry Stats ===');
const stats = getMCPStats();
console.log(`  Tools: ${stats.tools}`);
console.log(`  Resources: ${stats.resources}`);
console.log(`  Prompts: ${stats.prompts}`);
console.log(`  Total: ${stats.total}`);

// ============================================================================
// 6. Execute Agent (if API key is set)
// ============================================================================

const apiKey = getEnv('OPENAI_API_KEY');

if (apiKey && apiKey !== 'sk-test') {
  console.log('\n=== Agent Execution (Non-Streaming) ===');
  console.log('Asking: "What is 123 multiplied by 456?"');

  try {
    const response = await mathAgent.generate({
      input: 'What is 123 multiplied by 456?',
    });

    console.log('\nResponse:');
    console.log(`  Text: ${response.text}`);
    console.log(`  Status: ${response.status}`);
    console.log(`  Messages: ${response.messages.length}`);
    console.log(`  Tool Calls: ${response.toolCalls.length}`);

    if (response.toolCalls.length > 0) {
      console.log('\nTool Calls:');
      response.toolCalls.forEach((tc) => {
        console.log(`  - ${tc.name}(${JSON.stringify(tc.args)})`);
        console.log(`    Status: ${tc.status}`);
        console.log(`    Result: ${JSON.stringify(tc.result)}`);
      });
    }

    if (response.usage) {
      console.log('\nUsage:');
      console.log(`  Prompt Tokens: ${response.usage.promptTokens}`);
      console.log(`  Completion Tokens: ${response.usage.completionTokens}`);
      console.log(`  Total Tokens: ${response.usage.totalTokens}`);
    }
  } catch (error) {
    console.error('\nError:', error);
  }

  // ============================================================================
  // 7. Execute Agent with Streaming
  // ============================================================================

  console.log('\n=== Agent Execution (Streaming) ===');
  console.log('Asking: "What is 789 divided by 3?"');
  console.log('Note: This will demonstrate tool calling in streaming mode\n');
  console.log('Streaming response:\n');

  try {
    // Create a fresh agent instance for streaming to avoid memory conflicts
    const streamingAgent = agent({
      id: 'mathAssistantStreaming',
      model: 'openai/gpt-4o',
      system: `You are a helpful math assistant.
When the user asks a math question, use the calculator tool to compute the answer.
Always show your work and explain the result.`,

      tools: {
        calculator: true,
      },

      maxSteps: 5,
      streaming: false,
    });

    let fullText = '';
    const toolCalls: any[] = [];

    // stream() returns a ReadableStream that needs to be consumed
    const stream = await streamingAgent.stream({
      input: 'What is 789 divided by 3?',
      onChunk: (chunk) => {
        // Print each chunk as it arrives
        writeStdout(chunk);
        fullText += chunk;
      },
      onToolCall: (toolCall) => {
        console.log(`\n\n  [Tool Call] ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
        toolCalls.push(toolCall);
      },
    });

    // Consume the stream (it's in SSE format with JSON chunks)
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Process the stream chunk
      decoder.decode(value, { stream: true });
    }

    console.log('\n\nStreaming Complete:');
    console.log(`  Total Text Length: ${fullText.length} chars`);
    console.log(`  Tool Calls: ${toolCalls.length}`);

    if (toolCalls.length > 0) {
      console.log('\nTool Call Details:');
      toolCalls.forEach((tc) => {
        console.log(`  - ${tc.name}: ${tc.status}`);
      });
    }
  } catch (error) {
    console.error('\nStreaming Error:', error);
  }
} else {
  console.log('\n=== Skipping Agent Execution ===');
  console.log('Set OPENAI_API_KEY to test agent execution');
  console.log('Example: export OPENAI_API_KEY=sk-...');
}

console.log('\n=== Example Complete ===');
