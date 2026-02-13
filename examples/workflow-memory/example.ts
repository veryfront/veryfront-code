/**
 * Phase 3 Example: Agent Enhancements
 *
 * Demonstrates:
 * - Conversation memory (keeps all messages)
 * - Buffer memory (keeps last N messages)
 * - Summary memory (summarizes old messages)
 * - Agent composition (agents calling other agents)
 * - Multi-agent workflows
 */

import { agent, agentAsTool, createWorkflow, registerAgent } from 'veryfront/agent';
import { tool } from 'veryfront/tool';
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

console.log('=== Phase 3: Agent Enhancements ===\n');

// ============================================================================
// 1. Memory Strategies
// ============================================================================

console.log('=== 1. Memory Strategies ===\n');

// Conversation Memory (default) - Keeps all messages
const conversationAgent = agent({
  id: 'conversationAgent',
  model: 'openai/gpt-4o',
  system: 'You are a concise assistant with perfect recall.',
  memory: {
    type: 'conversation',
    maxTokens: 4000,
  },
});

console.log('Created agent with Conversation Memory');
console.log('  Type: conversation');
console.log('  Max Tokens: 4000');
console.log('  Behavior: Keeps all messages\n');

// Buffer Memory - Keeps last N messages
const bufferAgent = agent({
  id: 'bufferAgent',
  model: 'openai/gpt-4o',
  system: 'You are a concise assistant.',
  memory: {
    type: 'buffer',
    maxMessages: 5,
  },
});

console.log('Created agent with Buffer Memory');
console.log('  Type: buffer');
console.log('  Max Messages: 5');
console.log('  Behavior: Keeps only last 5 messages\n');

// Summary Memory - Summarizes old messages
const summaryAgent = agent({
  id: 'summaryAgent',
  model: 'openai/gpt-4o',
  system: 'You are a concise assistant.',
  memory: {
    type: 'summary',
    maxMessages: 10,
  },
});

console.log('Created agent with Summary Memory');
console.log('  Type: summary');
console.log('  Max Messages: 10');
console.log('  Behavior: Summarizes when threshold exceeded\n');

// ============================================================================
// 2. Agent Composition
// ============================================================================

console.log('=== 2. Agent Composition ===\n');

// Create specialized agents
const researchAgent = agent({
  id: 'researcher',
  model: 'openai/gpt-4o',
  system: 'You are a researcher. Provide thorough, factual information.',
  memory: {
    type: 'buffer',
    maxMessages: 3,
  },
});

const writerAgent = agent({
  id: 'writer',
  model: 'openai/gpt-4o',
  system: 'You are a content writer. Write clear, engaging content.',
  memory: {
    type: 'buffer',
    maxMessages: 3,
  },
});

console.log('Created specialized agents:');
console.log('  - researcher: Finds factual information');
console.log('  - writer: Writes clear content\n');

// Register agents for composition
registerAgent('researcher', researchAgent);
registerAgent('writer', writerAgent);

// Create orchestrator that uses other agents
const orchestrator = agent({
  id: 'orchestrator',
  model: 'openai/gpt-4o',
  system: `You coordinate between specialized agents.

When asked to create content:
1. Use the researcher agent to gather information
2. Use the writer agent to create the content

Always explain what you're doing.`,

  tools: {
    research: agentAsTool(researchAgent, 'Research a topic thoroughly'),
    write: agentAsTool(writerAgent, 'Write engaging content'),
  },

  maxSteps: 5,
  memory: {
    type: 'conversation',
    maxTokens: 2000,
  },
});

console.log('Created orchestrator agent');
console.log('  Uses: researcher and writer as tools');
console.log('  Max Steps: 5');
console.log('  Memory: conversation (2000 tokens)\n');

// ============================================================================
// 3. Multi-Agent Workflow
// ============================================================================

console.log('=== 3. Multi-Agent Workflow ===\n');

const workflow = createWorkflow({
  steps: [
    {
      agent: researchAgent,
      name: 'research',
      transform: (output) => `Research findings: ${output}`,
    },
    {
      agent: writerAgent,
      name: 'write',
      transform: (output) => `Article: ${output}`,
    },
  ],
  initialContext: {
    topic: 'AI frameworks',
  },
});

console.log('Created workflow with 2 steps:');
console.log('  Step 1: Research (researchAgent)');
console.log('  Step 2: Write (writerAgent)\n');

// ============================================================================
// 4. Memory Stats
// ============================================================================

console.log('=== 4. Memory Stats (Before Use) ===\n');

const conversationStats = await conversationAgent.getMemoryStats();
console.log('Conversation Agent Memory:');
console.log(`  Messages: ${conversationStats.totalMessages}`);
console.log(`  Estimated Tokens: ${conversationStats.estimatedTokens}`);
console.log(`  Type: ${conversationStats.type}\n`);

const bufferStats = await bufferAgent.getMemoryStats();
console.log('Buffer Agent Memory:');
console.log(`  Messages: ${bufferStats.totalMessages}`);
console.log(`  Estimated Tokens: ${bufferStats.estimatedTokens}`);
console.log(`  Type: ${bufferStats.type}\n`);

const summaryStats = await summaryAgent.getMemoryStats();
console.log('Summary Agent Memory:');
console.log(`  Messages: ${summaryStats.totalMessages}`);
console.log(`  Estimated Tokens: ${summaryStats.estimatedTokens}`);
console.log(`  Type: ${summaryStats.type}\n`);

// ============================================================================
// 5. Test Workflow (if API key set)
// ============================================================================

const apiKey = getEnv('OPENAI_API_KEY');

if (apiKey && apiKey !== 'sk-test') {
  console.log('=== 5. Testing Workflow Execution ===\n');
  console.log('Input: "Explain Veryfront AI framework"\n');
  console.log('Note: This will take 10-20 seconds as each agent makes API calls...\n');

  try {
    console.log('[Step 1/2] Executing research agent...');
    const startTime = Date.now();

    const result = await workflow.execute('Explain Veryfront AI framework in 2 sentences');

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Complete] Workflow finished in ${duration}s\n`);

    console.log('Workflow Result:');
    console.log(`  Final Output: ${result.output}\n`);

    console.log('Step Results:');
    result.steps.forEach((step) => {
      console.log(`  ${step.name}:`);
      console.log(`    Skipped: ${step.skipped}`);
      if (!step.skipped) {
        console.log(`    Output: ${step.output.substring(0, 100)}...`);
      }
      console.log('');
    });
  } catch (error) {
    console.error('Workflow execution error:', error);
  }
} else {
  console.log('=== 5. Skipping Workflow Execution ===');
  console.log('Set OPENAI_API_KEY to test workflow execution\n');
}

console.log('=== Phase 3 Example Complete ===');
console.log('\nPhase 3 Features Demonstrated:');
console.log('✅ Conversation memory');
console.log('✅ Buffer memory');
console.log('✅ Summary memory');
console.log('✅ Agent composition (agentAsTool)');
console.log('✅ Multi-agent workflows');
console.log('✅ Memory management');
