/**************************
 * Agent Testing Utilities
 *
 * Utilities for testing agents in development and CI/CD.
 *
 * @module veryfront/agent/testing
 **************************/

import type { Agent, AgentResponse, Message } from "../types.ts";

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

export async function testAgent(agent: Agent, testCases: TestCase[]): Promise<TestSuite> {
  const suiteStartTime = Date.now();
  const results = await Promise.all(testCases.map((testCase) => runTestCase(agent, testCase)));
  const passed = results.every((r) => r.passed);

  return {
    name: agent.id,
    results,
    passed,
    totalTime: Date.now() - suiteStartTime,
  };
}

async function runTestCase(agent: Agent, testCase: TestCase): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const timeoutMs = testCase.timeout ?? 30000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const response = await Promise.race<AgentResponse>([
      agent.generate({ input: testCase.input }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Test timeout")), timeoutMs);
      }),
    ]);

    clearTimeout(timeoutId);

    const executionTime = Date.now() - startTime;
    const toolCalls = response.toolCalls.map((tc) => tc.name);

    const { passed, error } = await validateTestCase(testCase, response, toolCalls);

    return {
      name: testCase.name,
      passed,
      response,
      error,
      executionTime,
      toolCalls,
    };
  } catch (error) {
    return {
      name: testCase.name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      executionTime: Date.now() - startTime,
      toolCalls: [],
    };
  }
}

async function validateTestCase(
  testCase: TestCase,
  response: AgentResponse,
  toolCalls: string[],
): Promise<{ passed: boolean; error?: string }> {
  const expected = testCase.expected;

  if (expected instanceof RegExp) {
    if (!expected.test(response.text)) {
      return {
        passed: false,
        error: `Output "${response.text}" does not match pattern ${expected}`,
      };
    }
  } else if (typeof expected === "string") {
    if (!response.text.includes(expected)) {
      return {
        passed: false,
        error: `Output does not contain expected text: "${expected}"`,
      };
    }
  }

  const expectedTools = testCase.expectToolCalls;
  if (expectedTools?.length) {
    const missingTools = expectedTools.filter((t) => !toolCalls.includes(t));
    if (missingTools.length) {
      return {
        passed: false,
        error: `Expected tool calls not found: ${missingTools.join(", ")}`,
      };
    }
  }

  if (testCase.validate) {
    try {
      const passed = await testCase.validate(response);
      if (!passed) return { passed: false, error: "Custom validation failed" };
    } catch (error) {
      return {
        passed: false,
        error: `Custom validation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { passed: true };
}

export function printTestResults(suite: TestSuite): void {
  console.log(`\n=== Test Suite: ${suite.name} ===\n`);

  const passed = suite.results.filter((r) => r.passed).length;
  const total = suite.results.length;

  for (const [index, result] of suite.results.entries()) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${index + 1}. ${result.name}`);

    if (!result.passed && result.error) console.log(`   Error: ${result.error}`);
    if (result.toolCalls.length) console.log(`   Tools used: ${result.toolCalls.join(", ")}`);

    console.log(`   Time: ${result.executionTime}ms\n`);
  }

  console.log(`Results: ${passed}/${total} passed`);
  console.log(`Total time: ${suite.totalTime}ms`);
  console.log(`Status: ${suite.passed ? "✅ PASSED" : "❌ FAILED"}\n`);
}

export function assertContains(response: AgentResponse, text: string): boolean {
  return response.text.toLowerCase().includes(text.toLowerCase());
}

export function assertToolCalled(response: AgentResponse, toolName: string): boolean {
  return response.toolCalls.some((tc) => tc.name === toolName);
}

export function assertCompleted(response: AgentResponse): boolean {
  return response.status === "completed";
}
