/**
 * Tool Testing Utilities
 *
 * Utilities for testing individual tools.
 */
export async function testTool(tool, testCases) {
    const results = [];
    for (const testCase of testCases) {
        results.push(await runToolTest(tool, testCase));
    }
    return results;
}
async function runToolTest(tool, testCase) {
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
        if (testCase.expectedOutput !== undefined) {
            const passed = deepMatch(result, testCase.expectedOutput);
            return {
                name: testCase.name,
                passed,
                result,
                error: passed
                    ? undefined
                    : `Output mismatch. Expected: ${JSON.stringify(testCase.expectedOutput)}, Got: ${JSON.stringify(result)}`,
                executionTime,
            };
        }
        if (!testCase.validate) {
            return {
                name: testCase.name,
                passed: true,
                result,
                executionTime,
            };
        }
        try {
            const passed = await testCase.validate(result);
            return {
                name: testCase.name,
                passed,
                result,
                error: passed ? undefined : "Custom validation failed",
                executionTime,
            };
        }
        catch (error) {
            return {
                name: testCase.name,
                passed: false,
                result,
                error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
                executionTime,
            };
        }
    }
    catch (error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!testCase.shouldThrow) {
            return {
                name: testCase.name,
                passed: false,
                error: `Unexpected error: ${errorMessage}`,
                executionTime,
            };
        }
        if (!testCase.expectedError) {
            return {
                name: testCase.name,
                passed: true,
                executionTime,
            };
        }
        const passed = testCase.expectedError instanceof RegExp
            ? testCase.expectedError.test(errorMessage)
            : errorMessage.includes(testCase.expectedError);
        return {
            name: testCase.name,
            passed,
            error: passed
                ? undefined
                : `Error message mismatch. Expected pattern: ${testCase.expectedError}, Got: ${errorMessage}`,
            executionTime,
        };
    }
}
function deepMatch(actual, expected) {
    if (expected === actual)
        return true;
    if (typeof expected !== "object" || expected === null)
        return false;
    if (typeof actual !== "object" || actual === null)
        return false;
    const expectedObj = expected;
    const actualObj = actual;
    for (const key in expectedObj) {
        if (!(key in actualObj))
            return false;
        const expectedValue = expectedObj[key];
        const actualValue = actualObj[key];
        if (typeof expectedValue === "object" && expectedValue !== null) {
            if (!deepMatch(actualValue, expectedValue))
                return false;
            continue;
        }
        if (actualValue !== expectedValue)
            return false;
    }
    return true;
}
export function printToolTestResults(toolId, results) {
    console.log(`\n=== Tool Tests: ${toolId} ===\n`);
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    for (const [index, result] of results.entries()) {
        const icon = result.passed ? "✅" : "❌";
        console.log(`${icon} ${index + 1}. ${result.name}`);
        if (!result.passed && result.error) {
            console.log(`   Error: ${result.error}`);
        }
        if (result.result !== undefined) {
            console.log(`   Result: ${JSON.stringify(result.result)}`);
        }
        console.log(`   Time: ${result.executionTime}ms\n`);
    }
    console.log(`Results: ${passed}/${total} passed`);
    console.log(`Status: ${passed === total ? "✅ ALL PASSED" : "❌ SOME FAILED"}\n`);
}
