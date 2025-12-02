/**
 * Phase 7 Example: Developer Tools
 *
 * Demonstrates:
 * - Agent testing utilities
 * - Tool testing utilities
 * - Agent inspection and debugging
 * - Registry overview
 */

import {
  agent,
  tool,
  initializeProviders,
  registerTool,
} from 'veryfront/ai';

import {
  testAgent,
  printTestResults,
  testTool,
  printToolTestResults,
  inspectAgent,
  printInspectionReport,
  printRegistryOverview,
} from 'veryfront/ai/dev';

import { z } from 'zod';

//Helpers for Cross-Platform Compatibility (Deno/Node)
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

console.log('=== Phase 7: Developer Tools ===\n');

// Initialize providers
initializeProviders({
  openai: {
    apiKey: getEnv('OPENAI_API_KEY') || 'sk-test',
  },
});

// ============================================================================
// 1. Create and Test a Tool
// ============================================================================

console.log('=== 1. Tool Testing ===\n');

const calculatorTool = tool({
  id: 'calculator',
  description: 'Perform basic math',
  inputSchema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  execute: async ({ operation, a, b }) => {
    switch (operation) {
      case 'add':
        return { result: a + b };
      case 'subtract':
        return { result: a - b };
      case 'multiply':
        return { result: a * b };
      case 'divide':
        if (b === 0) throw new Error('Cannot divide by zero');
        return { result: a / b };
    }
  },
});

registerTool('calculator', calculatorTool);

// Test the tool
const toolTestResults = await testTool(calculatorTool, [
  {
    name: 'Addition',
    input: { operation: 'add', a: 2, b: 3 },
    expectedOutput: { result: 5 },
  },
  {
    name: 'Subtraction',
    input: { operation: 'subtract', a: 10, b: 4 },
    expectedOutput: { result: 6 },
  },
  {
    name: 'Multiplication',
    input: { operation: 'multiply', a: 7, b: 6 },
    expectedOutput: { result: 42 },
  },
  {
    name: 'Division',
    input: { operation: 'divide', a: 20, b: 4 },
    expectedOutput: { result: 5 },
  },
  {
    name: 'Division by zero',
    input: { operation: 'divide', a: 10, b: 0 },
    shouldThrow: true,
    expectedError: /cannot divide by zero/i,
  },
]);

printToolTestResults('calculator', toolTestResults);

// ============================================================================
// 2. Create and Test an Agent
// ============================================================================

console.log('=== 2. Agent Testing ===\n');

const mathAgent = agent({
  id: 'mathAgent',
  model: 'openai/gpt-4o',
  system: 'You are a math assistant. Use the calculator tool for computations.',
  tools: {
    calculator: true,
  },
  maxSteps: 3,
  memory: {
    type: 'buffer',
    maxMessages: 5,
  },
});

console.log('Created math agent with calculator tool\n');

const apiKey = getEnv('OPENAI_API_KEY');

if (apiKey && apiKey !== 'sk-test') {
  // Test the agent
  const agentTestResults = await testAgent(mathAgent, [
    {
      name: 'Simple greeting',
      input: 'Hello',
      expected: /hello|hi|hey/i,
      timeout: 10000,
    },
    {
      name: 'Math calculation',
      input: 'What is 25 times 4?',
      expectToolCalls: ['calculator'],
      validate: (response) => {
        // Check if result contains 100
        return response.text.includes('100');
      },
      timeout: 15000,
    },
  ]);

  printTestResults(agentTestResults);

  // ============================================================================
  // 3. Inspect Agent Execution
  // ============================================================================

  console.log('=== 3. Agent Inspection ===\n');

  const inspectionReport = await inspectAgent(
    mathAgent,
    'Calculate 15 + 27'
  );

  printInspectionReport(inspectionReport);
} else {
  console.log('Skipping agent tests (set OPENAI_API_KEY to run)\n');
}

// ============================================================================
// 4. Registry Overview
// ============================================================================

console.log('=== 4. Registry Overview ===');

printRegistryOverview();

console.log('=== Phase 7 Example Complete ===\n');
console.log('Phase 7 Features Demonstrated:');
console.log('✅ Tool testing with multiple test cases');
console.log('✅ Agent testing with expectations');
console.log('✅ Agent inspection and debugging');
console.log('✅ Registry overview');
console.log('✅ Test result formatting');
