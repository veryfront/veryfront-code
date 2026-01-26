/**
 * Agent Testing Utilities
 *
 * Utilities for testing agents in development and CI/CD.
 *
 * @module veryfront/agent/testing
 */
import * as dntShim from "../../../_dnt.shims.js";
/**
 * Test an agent with multiple test cases
 *
 * @example
 * ```typescript
 * import { testAgent } from 'veryfront/agent/testing';
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
export async function testAgent(agent, testCases) {
    const suiteStartTime = Date.now();
    const results = [];
    let passed = true;
    for (const testCase of testCases) {
        const result = await runTestCase(agent, testCase);
        results.push(result);
        if (!result.passed)
            passed = false;
    }
    return {
        name: agent.id,
        results,
        passed,
        totalTime: Date.now() - suiteStartTime,
    };
}
/**
 * Run a single test case
 */
async function runTestCase(agent, testCase) {
    const startTime = Date.now();
    try {
        const timeoutMs = testCase.timeout ?? 30000;
        const timeoutPromise = new Promise((_, reject) => {
            dntShim.setTimeout(() => reject(new Error("Test timeout")), timeoutMs);
        });
        const responsePromise = agent.generate({ input: testCase.input });
        const response = await Promise.race([responsePromise, timeoutPromise]);
        const executionTime = Date.now() - startTime;
        const toolCalls = response.toolCalls.map((tc) => tc.name);
        const validation = await validateTestCase(testCase, response, toolCalls);
        return {
            name: testCase.name,
            passed: validation.passed,
            response,
            error: validation.error,
            executionTime,
            toolCalls,
        };
    }
    catch (error) {
        return {
            name: testCase.name,
            passed: false,
            error: error instanceof Error ? error.message : String(error),
            executionTime: Date.now() - startTime,
            toolCalls: [],
        };
    }
}
async function validateTestCase(testCase, response, toolCalls) {
    const expected = testCase.expected;
    if (expected) {
        if (expected instanceof RegExp) {
            const passed = expected.test(response.text);
            if (!passed) {
                return {
                    passed: false,
                    error: `Output "${response.text}" does not match pattern ${expected}`,
                };
            }
        }
        else {
            const passed = response.text.includes(expected);
            if (!passed) {
                return {
                    passed: false,
                    error: `Output does not contain expected text: "${expected}"`,
                };
            }
        }
    }
    const expectedTools = testCase.expectToolCalls;
    if (expectedTools) {
        const missingTools = expectedTools.filter((t) => !toolCalls.includes(t));
        if (missingTools.length > 0) {
            return {
                passed: false,
                error: `Expected tool calls not found: ${missingTools.join(", ")}`,
            };
        }
    }
    if (testCase.validate) {
        try {
            const passed = await testCase.validate(response);
            if (!passed)
                return { passed: false, error: "Custom validation failed" };
        }
        catch (error) {
            return {
                passed: false,
                error: `Custom validation error: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    return { passed: true };
}
/**
 * Print test results in a readable format
 */
export function printTestResults(suite) {
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
export function assertContains(response, text) {
    return response.text.toLowerCase().includes(text.toLowerCase());
}
/**
 * Assert that an agent called a specific tool
 */
export function assertToolCalled(response, toolName) {
    return response.toolCalls.some((tc) => tc.name === toolName);
}
/**
 * Assert that an agent completed successfully
 */
export function assertCompleted(response) {
    return response.status === "completed";
}
