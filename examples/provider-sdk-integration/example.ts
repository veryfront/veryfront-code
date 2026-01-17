/**
 * AI SDK Integration Example
 *
 * Demonstrates flexibility:
 * - Use AI SDK providers (30+ options, battle-tested)
 * - Use custom providers (full control, special cases)
 * - Use both in the same app (no lock-in)
 * - Veryfront enhancements work with both
 */

// AI SDK re-exports (battle-tested)
import { openai, anthropic, streamText, generateText } from 'veryfront/provider';

// Veryfront custom providers (for special cases)
import { BaseProvider, OpenAIProvider, AnthropicProvider } from 'veryfront/provider';

// Veryfront enhancements
import { initializeProviders } from 'veryfront/provider';
import { tool, registerTool } from 'veryfront/tool';

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

console.log('=== AI SDK Integration Example ===\n');
console.log('Demonstrating flexibility: AI SDK + Custom Providers\n');

// ============================================================================
// 1. Use AI SDK Providers (Recommended)
// ============================================================================

console.log('=== 1. Using AI SDK Providers ===\n');

const apiKey = getEnv('OPENAI_API_KEY') || 'sk-test';

if (apiKey && apiKey !== 'sk-test') {
  console.log('Testing AI SDK provider (OpenAI)...\n');

  try {
    // Use AI SDK's openai provider directly
    const model = openai('gpt-4o', {
      apiKey,
    });

    const result = await generateText({
      model,
      prompt: 'Say hello in 5 words',
    });

    console.log('AI SDK OpenAI Result:');
    console.log(`  Text: ${result.text}`);
    console.log(`  Tokens: ${result.usage.totalTokens}`);
    console.log('  ✅ AI SDK provider working!\n');
  } catch (error) {
    console.error('AI SDK error:', error);
  }
} else {
  console.log('Skipping AI SDK test (set OPENAI_API_KEY)\n');
}

// ============================================================================
// 2. Use Custom Provider (Full Control)
// ============================================================================

console.log('=== 2. Using Custom Provider ===\n');

// Initialize with custom provider
initializeProviders({
  openai: {
    apiKey: apiKey,
  },
});

console.log('Custom OpenAIProvider initialized');
console.log('  Implementation: src/ai/providers/openai.ts');
console.log('  Full control over: headers, endpoints, transformations');
console.log('  Use case: Internal APIs, custom auth, special requirements\n');

// ============================================================================
// 3. Implement Custom Provider (Example: Ollama)
// ============================================================================

console.log('=== 3. Custom Provider Example (Ollama) ===\n');

class OllamaProvider extends BaseProvider {
  name = 'ollama';

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  protected getEndpoint(path: string): string {
    return `http://localhost:11434/v1${path}`;
  }

  protected transformRequest(request: any): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages,
      stream: request.stream || false,
    };
  }

  protected transformResponse(response: any): any {
    return {
      text: response.message?.content || '',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      finishReason: 'stop' as const,
    };
  }
}

console.log('Created OllamaProvider (OpenAI-compatible local model)');
console.log('  Endpoint: http://localhost:11434');
console.log('  Use case: Local models, privacy, offline\n');

// ============================================================================
// 4. Veryfront Enhancements Work with Both
// ============================================================================

console.log('=== 4. Veryfront Enhancements (Work with Both) ===\n');

// Create tool (works with AI SDK or custom providers)
const weatherTool = tool({
  id: 'getWeather',
  description: 'Get current weather',
  inputSchema: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => {
    // Mock implementation
    return {
      city,
      temperature: 72,
      condition: 'Sunny',
    };
  },
});

registerTool('getWeather', weatherTool);

console.log('✅ Tool created and registered');
console.log('  Tool: getWeather');
console.log('  Works with: AI SDK providers AND custom providers');
console.log('  Auto-discovery: YES (if in ai/tools/)');
console.log('  MCP exposed: YES (via veryfront dev --mcp)\n');

// ============================================================================
// Summary
// ============================================================================

console.log('=== Summary ===\n');
console.log('Veryfront provides THREE options:\n');

console.log('Option 1: AI SDK Providers (Recommended)');
console.log('  ✅ 30+ providers (OpenAI, Anthropic, Google, Mistral, etc.)');
console.log('  ✅ Battle-tested in production');
console.log('  ✅ Actively maintained by Vercel');
console.log('  ✅ Use: import { openai } from "veryfront/provider"\n');

console.log('Option 2: Custom Providers (Advanced)');
console.log('  ✅ Full control (internal APIs, custom auth)');
console.log('  ✅ BaseProvider class provided');
console.log('  ✅ Examples: OpenAI, Anthropic implementations');
console.log('  ✅ Use: extend BaseProvider\n');

console.log('Option 3: Hybrid (Best of Both Worlds)');
console.log('  ✅ AI SDK for standard providers');
console.log('  ✅ Custom for special cases');
console.log('  ✅ Both in same app');
console.log('  ✅ No lock-in\n');

console.log('Veryfront Enhancements (Work with All):');
console.log('  ✅ Auto-discovery (ai/tools/ → auto-register)');
console.log('  ✅ MCP server (veryfront dev --mcp)');
console.log('  ✅ Multi-agent workflows (createWorkflow)');
console.log('  ✅ Agent composition (agentAsTool)');
console.log('  ✅ Memory strategies (conversation, buffer, summary)');
console.log('  ✅ Three-layer UI (hooks, primitives, styled)');
console.log('  ✅ Production middleware (rate limit, cache, cost, security)\n');

console.log('🎉 Flexibility achieved! Use AI SDK, custom, or both.');
console.log('   No lock-in. Best of both worlds.\n');
