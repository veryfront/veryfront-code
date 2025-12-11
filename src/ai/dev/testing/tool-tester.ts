
import type { Tool } from "../../types/tool.ts";

export interface ToolTestCase {
  name: string;

  input: any;

  expectedOutput?: any;

  validate?: (result: any) => boolean | Promise<boolean>;

  shouldThrow?: boolean;

  expectedError?: RegExp | string;
}

export interface ToolTestResult {
  name: string;

  passed: boolean;

  result?: any;

  error?: string;

  executionTime: number;
}

export async function testTool(
  tool: Tool,
  testCases: ToolTestCase[],
): Promise<ToolTestResult[]> {
  const results: ToolTestResult[] = [];

  for (const testCase of testCases) {
    const result = await runToolTest(tool, testCase);
    results.push(result);
  }

  return results;
}

async function runToolTest(
  tool: Tool,
  testCase: ToolTestCase,
): Promise<ToolTestResult> {
  const startTime = Date.now();

  try {
    const result = await tool.execute(testCase.input);
    const executionTime = Date.now() - startTime;

    if (testCase.shouldThrow) {
      return {
        name: testCase.name,
        passed: false,
        error: "Expected tool to throw error but it succeeded",
        executionTime,
      };
    }

    let passed = true;
    let error: string | undefined;

    if (testCase.expectedOutput !== undefined) {
      passed = deepMatch(result, testCase.expectedOutput);
      if (!passed) {
        error = `Output mismatch. Expected: ${JSON.stringify(testCase.expectedOutput)}, Got: ${
          JSON.stringify(result)
        }`;
      }
    }

    if (passed && testCase.validate) {
      try {
        passed = await testCase.validate(result);
        if (!passed) {
          error = "Custom validation failed";
        }
      } catch (err) {
        passed = false;
        error = `Validation error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return {
      name: testCase.name,
      passed,
      result,
      error,
      executionTime,
    };
  } catch (err) {
    const executionTime = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (testCase.shouldThrow) {
      let passed = true;
      let error: string | undefined;

      if (testCase.expectedError) {
        if (testCase.expectedError instanceof RegExp) {
          passed = testCase.expectedError.test(errorMessage);
        } else {
          passed = errorMessage.includes(testCase.expectedError);
        }

        if (!passed) {
          error =
            `Error message mismatch. Expected pattern: ${testCase.expectedError}, Got: ${errorMessage}`;
        }
      }

      return {
        name: testCase.name,
        passed,
        error,
        executionTime,
      };
    }

    return {
      name: testCase.name,
      passed: false,
      error: `Unexpected error: ${errorMessage}`,
      executionTime,
    };
  }
}

function deepMatch(actual: any, expected: any): boolean {
  if (expected === actual) return true;
  if (typeof expected !== "object" || expected === null) return false;
  if (typeof actual !== "object" || actual === null) return false;

  for (const key in expected) {
    if (!(key in actual)) return false;

    const expectedValue = expected[key];
    const actualValue = actual[key];

    if (typeof expectedValue === "object" && expectedValue !== null) {
      if (!deepMatch(actualValue, expectedValue)) return false;
    } else {
      if (actualValue !== expectedValue) return false;
    }
  }

  return true;
}

export function printToolTestResults(
  toolId: string,
  results: ToolTestResult[],
): void {
  console.log(`\n=== Tool Tests: ${toolId} ===\n`);

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((result, index) => {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${index + 1}. ${result.name}`);

    if (!result.passed && result.error) {
      console.log(`   Error: ${result.error}`);
    }

    if (result.result !== undefined) {
      console.log(`   Result: ${JSON.stringify(result.result)}`);
    }

    console.log(`   Time: ${result.executionTime}ms\n`);
  });

  console.log(`Results: ${passed}/${total} passed`);
  console.log(`Status: ${passed === total ? "✅ ALL PASSED" : "❌ SOME FAILED"}\n`);
}
