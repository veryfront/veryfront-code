
import type { Agent, AgentResponse, Message } from "../../types/agent.ts";

export interface TestCase {
  name: string;

  input: string | Message[];

  expected?: RegExp | string;

  expectToolCalls?: string[];

  timeout?: number;

  validate?: (response: AgentResponse) => boolean | Promise<boolean>;
}

export interface TestResult {
  name: string;

  passed: boolean;

  response?: AgentResponse;

  error?: string;

  executionTime: number;

  toolCalls: string[];
}

export interface TestSuite {
  name: string;

  results: TestResult[];

  passed: boolean;

  totalTime: number;
}

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

async function runTestCase(agent: Agent, testCase: TestCase): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const timeout = testCase.timeout || 30000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Test timeout")), timeout);
    });

    const responsePromise = agent.generate({
      input: testCase.input,
    });

    const response = await Promise.race([responsePromise, timeoutPromise]);

    const executionTime = Date.now() - startTime;
    const toolCalls = response.toolCalls.map((tc) => tc.name);

    let passed = true;
    let error: string | undefined;

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

    if (passed && testCase.expectToolCalls) {
      const expectedTools = testCase.expectToolCalls;
      const missingTools = expectedTools.filter((t) => !toolCalls.includes(t));

      if (missingTools.length > 0) {
        passed = false;
        error = `Expected tool calls not found: ${missingTools.join(", ")}`;
      }
    }

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

export function printTestResults(suite: TestSuite): void {
  console.log(`\n=== Test Suite: ${suite.name} ===\n`);

  const passed = suite.results.filter((r) => r.passed).length;
  const total = suite.results.length;

  suite.results.forEach((result, index) => {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${index + 1}. ${result.name}`);

    if (!result.passed && result.error) {
      console.log(`   Error: ${result.error}`);
    }

    if (result.toolCalls.length > 0) {
      console.log(`   Tools used: ${result.toolCalls.join(", ")}`);
    }

    console.log(`   Time: ${result.executionTime}ms\n`);
  });

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
