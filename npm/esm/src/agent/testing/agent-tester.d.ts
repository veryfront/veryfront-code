import type { Agent, AgentResponse, Message } from "../types.js";
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
export declare function testAgent(agent: Agent, testCases: TestCase[]): Promise<TestSuite>;
/**
 * Print test results in a readable format
 */
export declare function printTestResults(suite: TestSuite): void;
/**
 * Assert that an agent response contains text
 */
export declare function assertContains(response: AgentResponse, text: string): boolean;
/**
 * Assert that an agent called a specific tool
 */
export declare function assertToolCalled(response: AgentResponse, toolName: string): boolean;
/**
 * Assert that an agent completed successfully
 */
export declare function assertCompleted(response: AgentResponse): boolean;
//# sourceMappingURL=agent-tester.d.ts.map