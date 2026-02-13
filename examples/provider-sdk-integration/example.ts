/**
 * AI SDK Provider Integration Example
 *
 * Demonstrates:
 * - Auto-initialized providers from environment variables
 * - Custom provider registration with registerModelProvider()
 * - OpenAI-compatible services (OpenRouter, Ollama) via base URL override
 * - Using agents with different providers
 */

import { agent } from 'veryfront/agent';
import { registerModelProvider } from 'veryfront/provider';
import { tool, registerTool } from 'veryfront/tool';
import { createOpenAI } from '@ai-sdk/openai';

import { z } from 'zod';

// Helpers for Cross-Platform Compatibility (Deno/Node)
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

console.log('=== AI SDK Provider Integration Example ===\n');

// ============================================================================
// 1. Auto-Initialized Providers (Zero Config)
// ============================================================================

console.log('=== 1. Auto-Initialized Providers ===\n');

console.log('Veryfront auto-detects providers from environment variables:');
console.log('  OPENAI_API_KEY      → "openai" provider');
console.log('  ANTHROPIC_API_KEY   → "anthropic" provider');
console.log('  GOOGLE_API_KEY      → "google" provider');
console.log('');
console.log('No setup code needed — just set env vars and use agent():\n');
console.log('  agent({ model: "openai/gpt-4o" })');
console.log('  agent({ model: "anthropic/claude-sonnet-4-20250514" })');
console.log('  agent({ model: "google/gemini-2.0-flash" })\n');

// ============================================================================
// 2. OpenAI Base URL Override (OpenRouter, Azure, etc.)
// ============================================================================

console.log('=== 2. OpenAI-Compatible Services ===\n');

console.log('Use OPENAI_BASE_URL to point the "openai" provider elsewhere:');
console.log('');
console.log('  # OpenRouter');
console.log('  OPENAI_API_KEY=sk-or-v1-...');
console.log('  OPENAI_BASE_URL=https://openrouter.ai/api/v1');
console.log('');
console.log('  # Then use any OpenRouter model:');
console.log('  agent({ model: "openai/meta-llama/llama-3.1-405b" })\n');

// ============================================================================
// 3. Custom Provider Registration (Advanced)
// ============================================================================

console.log('=== 3. Custom Provider Registration ===\n');

// Register a custom provider for Ollama (local models)
const ollamaKey = getEnv('OLLAMA_API_KEY');
if (ollamaKey || true) {
  // registerModelProvider() accepts a factory: (modelId) => LanguageModel
  registerModelProvider('ollama', (modelId) => {
    return createOpenAI({
      apiKey: 'ollama', // Ollama doesn't need a real key
      baseURL: 'http://localhost:11434/v1',
    })(modelId);
  });

  console.log('Registered "ollama" provider');
  console.log('  Uses @ai-sdk/openai with custom baseURL');
  console.log('  Usage: agent({ model: "ollama/llama3.2" })\n');
}

// ============================================================================
// 4. Create Agent with Auto-Detected Provider
// ============================================================================

console.log('=== 4. Using Agents ===\n');

// Create tool (works with any provider)
const weatherTool = tool({
  id: 'getWeather',
  description: 'Get current weather',
  inputSchema: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => {
    return { city, temperature: 72, condition: 'Sunny' };
  },
});

registerTool('getWeather', weatherTool);

const apiKey = getEnv('OPENAI_API_KEY');

if (apiKey) {
  console.log('Testing with OpenAI provider...\n');

  const myAgent = agent({
    model: 'openai/gpt-4o',
    system: 'You are a helpful assistant.',
    tools: { getWeather: true },
  });

  try {
    const result = await myAgent.generate({
      input: 'What is the weather in Tokyo?',
    });
    console.log(`Response: ${result.text}`);
    console.log(`Tool Calls: ${result.toolCalls.length}\n`);
  } catch (error) {
    console.error('Error:', error);
  }
} else {
  console.log('Skipping live test (set OPENAI_API_KEY)\n');
}

// ============================================================================
// Summary
// ============================================================================

console.log('=== Summary ===\n');

console.log('Provider Setup Options:\n');

console.log('1. Auto-Initialized (Recommended)');
console.log('   Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY');
console.log('   Providers are auto-detected on first use\n');

console.log('2. Base URL Override');
console.log('   Set OPENAI_BASE_URL for OpenAI-compatible services');
console.log('   Works with OpenRouter, Azure OpenAI, Ollama, etc.\n');

console.log('3. Custom Registration');
console.log('   Use registerModelProvider() for full control');
console.log('   Accepts any AI SDK LanguageModel factory\n');

console.log('Veryfront Features (Work with All Providers):');
console.log('  Auto-discovery: ai/tools/ → auto-register');
console.log('  MCP server: veryfront dev --mcp');
console.log('  Multi-agent workflows: createWorkflow()');
console.log('  Agent composition: agentAsTool()');
console.log('  Memory strategies: conversation, buffer, summary');
console.log('  Production middleware: rate limit, cache, cost, security\n');
