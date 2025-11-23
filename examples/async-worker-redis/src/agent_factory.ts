import { agent, initializeProviders, tool } from "veryfront/ai";
import { z } from "zod";

// Try to initialize real providers
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

let hasProviders = false;
if (OPENAI_KEY || ANTHROPIC_KEY) {
  initializeProviders({
    openai: OPENAI_KEY ? { apiKey: OPENAI_KEY } : undefined,
    anthropic: ANTHROPIC_KEY ? { apiKey: ANTHROPIC_KEY } : undefined,
  });
  hasProviders = true;
}

// Define a tool for the agent
const calculator = tool({
  id: "calculator",
  description: "Perform mathematical calculations",
  inputSchema: z.object({
    expression: z.string().describe("The math expression to evaluate"),
  }),
  execute: ({ expression }: { expression: string }) => {
    // Safety: simple eval for demo purposes only
    // In production use a math parser
    return String(eval(expression));
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
