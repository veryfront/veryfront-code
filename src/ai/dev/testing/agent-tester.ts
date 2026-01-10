/**
 * Agent Testing Utilities
 *
 * Utilities for testing agents in development and CI/CD.
 */

import type { Agent, AgentResponse, Message } from "../../types/agent.ts";

export interface TestCase {
  /** Test name */
  name: string;

  /** Input to agent */
  input: string | Message[];

  /** Expected output pattern (regex or string) */
  expected?: RegExp | string;

  /** Expected tool calls */
  expectToolCalls?: string[];

  /** Maximum execution time (ms) */
  timeout?: number;

  /** Custom validator */
  validate?: (response: AgentResponse) => boolean | Promise<boolean>;
}

export interface TestResult {
  /** Test case name */
  name: string;

  /** Pass/fail */
  passed: boolean;

  /** Response from agent */
  response?: AgentResponse;

  /** Error if test failed */
  error?: string;

  /** Execution time */
  executionTime: number;

  /** Tool calls made */
  toolCalls: string[];
}

export interface TestSuite {
  /** Suite name */
  name: string;

  /** Test results */
  results: TestResult[];

  /** Overall pass/fail */
  passed: boolean;

  /** Total execution time */
  totalTime: number;
}

/**
 * Test an agent with multiple test cases
 *
 * @example
 * ```typescript
 * import { testAgent } from 'veryfront/ai/dev';
 *
 * const results = await testAgent(myAgent, [
 *   {
 *     name: 'Simple greeting',
 *     input: 'Hello',
 *     expected: /hello|hi|hey/i,
 *   },
 *   {
 *     name: 'Tool usage',
 *     input: 'Search for AI frameworks',
 *     expectToolCalls: ['searchWeb'],
 *   },
 * ]);
 *
 * console.log(`Passed: ${results.results.filter(r => r.passed).length}/${results.results.length}`);
 * ```
 */
export async function testAgent(
  agent: Agent,
  testCases: TestCase[],
): Promise<TestSuite> {
  const suite: TestSuite = {
    name: agent.id,
    results: [],
    passed: true,
    totalTime: 0,
  };

  const suiteStartTime = Date.now();

  for (const testCase of testCases) {
    const result = await runTestCase(agent, testCase);
    suite.results.push(result);

    if (!result.passed) {
      suite.passed = false;
    }
  }

  suite.totalTime = Date.now() - suiteStartTime;

  return suite;
}

/**
 * Run a single test case
 */
async function runTestCase(agent: Agent, testCase: TestCase): Promise<TestResult> {
  const startTime = Date.now();

  try {
    // Set timeout
    const timeout = testCase.timeout || 30000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Test timeout")), timeout);
    });

    // Execute agent
    const responsePromise = agent.generate({
      input: testCase.input,
    });

    const response = await Promise.race([responsePromise, timeoutPromise]);

    const executionTime = Date.now() - startTime;
    const toolCalls = response.toolCalls.map((tc) => tc.name);

    // Validate response
    let passed = true;
    let error: string | undefined;

    // Check expected output
    if (testCase.expected) {
      if (testCase.expected instanceof RegExp) {
        passed = testCase.expected.test(response.text);
        if (!passed) {
          error = `Output "${response.text}" does not match pattern ${testCase.expected}`;
        }
      } else {
        passed = response.text.includes(testCase.expected);
        if (!passed) {
          error = `Output does not contain expected text: "${testCase.expected}"`;
        }
      }
    }

    // Check expected tool calls
    if (passed && testCase.expectToolCalls) {
      const expectedTools = testCase.expectToolCalls;
      const missingTools = expectedTools.filter((t) => !toolCalls.includes(t));

      if (missingTools.length > 0) {
        passed = false;
        error = `Expected tool calls not found: ${missingTools.join(", ")}`;
      }
    }

    // Custom validation
    if (passed && testCase.validate) {
      try {
        passed = await testCase.validate(response);
        if (!passed) {
          error = "Custom validation failed";
        }
      } catch (err) {
        passed = false;
        error = `Custom validation error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return {
      name: testCase.name,
      passed,
      response,
      error,
      executionTime,
      toolCalls,
    };
  } catch (err) {
    return {
      name: testCase.name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - startTime,
      toolCalls: [],
    };
  }
}

/**
 * Print test results in a readable format
 */
export function printTestResults(suite: TestSuite): void {
  console.log(`\n=== Test Suite: ${suite.name} ===\n`);

  const passed = suite.results.filter((r) => r.passed).length;
  const total = suite.results.length;

  for (const [index, result] of suite.results.entries()) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${index + 1}. ${result.name}`);

    if (!result.passed && result.error) {
      console.log(`   Error: ${result.error}`);
    }

    if (result.toolCalls.length > 0) {
      console.log(`   Tools used: ${result.toolCalls.join(", ")}`);
    }

    console.log(`   Time: ${result.executionTime}ms\n`);
  }

  console.log(`Results: ${passed}/${total} passed`);
  console.log(`Total time: ${suite.totalTime}ms`);
  console.log(`Status: ${suite.passed ? "✅ PASSED" : "❌ FAILED"}\n`);
}

/**
 * Assert that an agent response contains text
 */
export function assertContains(response: AgentResponse, text: string): boolean {
  return response.text.toLowerCase().includes(text.toLowerCase());
}

/**
 * Assert that an agent called a specific tool
 */
export function assertToolCalled(response: AgentResponse, toolName: string): boolean {
  return response.toolCalls.some((tc) => tc.name === toolName);
}

/**
 * Assert that an agent completed successfully
 */
export function assertCompleted(response: AgentResponse): boolean {
  return response.status === "completed";
}
