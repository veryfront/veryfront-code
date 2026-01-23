// Helper for Cross-Platform CWD
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

import { agent } from "veryfront/agent";
import { initializeProviders } from "veryfront/provider";
import { tool } from "veryfront/tool";
import { z } from "zod";

// Try to initialize real providers
const OPENAI_KEY = getEnv("OPENAI_API_KEY");
const ANTHROPIC_KEY = getEnv("ANTHROPIC_API_KEY");

let hasProviders = false;
if (OPENAI_KEY || ANTHROPIC_KEY) {
  initializeProviders({
    openai: OPENAI_KEY ? { apiKey: OPENAI_KEY } : undefined,
    anthropic: ANTHROPIC_KEY ? { apiKey: ANTHROPIC_KEY } : undefined,
  });
  hasProviders = true;
}

/**
 * Safe math expression evaluator.
 * Only allows numbers, basic operators, parentheses, and whitespace.
 */
function safeMathEval(expression: string): number {
  const sanitized = expression.replace(/\s+/g, '');
  const safePattern = /^[\d+\-*/().]+$/;

  if (!safePattern.test(sanitized)) {
    throw new Error('Expression contains invalid characters');
  }

  // Validate balanced parentheses
  let depth = 0;
  for (const char of sanitized) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) throw new Error('Unbalanced parentheses');
  }
  if (depth !== 0) throw new Error('Unbalanced parentheses');

  // Use Function constructor with validated input
  const fn = new Function(`return (${sanitized})`);
  const result = fn();
  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Result is not a valid number');
  }
  return result;
}

// Define a tool for the agent
const calculator = tool({
  id: "calculator",
  description: "Perform mathematical calculations",
  inputSchema: z.object({
    expression: z.string().describe("The math expression to evaluate"),
  }),
  execute: ({ expression }: { expression: string }) => {
    return String(safeMathEval(expression));
  },
});

export async function executeAgent(input: string, agentId: string): Promise<string> {
  if (!hasProviders) {
    // Simulation mode if no keys
    console.log(`[Worker] No API keys found. Simulating agent '${agentId}'...`);
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Fake work
    return `[SIMULATED] Agent '${agentId}' processed: "${input}". (Set OPENAI_API_KEY to run real models)`;
  }

  console.log(`[Worker] Running real agent '${agentId}'...`);

  // Create agent on the fly (stateless worker pattern)
  // In a real app, you might cache this or load config from DB based on agentId
  const myAgent = agent({
    model: "openai/gpt-4o-mini", // Default to fast model
    system: "You are a helpful background worker agent.",
    tools: { calculator },
  });

  const result = await myAgent.generate({ input });
  return result.text;
}
