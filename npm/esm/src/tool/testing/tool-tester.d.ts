/**
 * Tool Testing Utilities
 *
 * Utilities for testing individual tools.
 */
import type { Tool } from "../types.js";
export interface ToolTestCase {
    /** Test name */
    name: string;
    /** Tool input */
    input: unknown;
    /** Expected output (partial match) */
    expectedOutput?: unknown;
    /** Custom validator */
    validate?: (result: unknown) => boolean | Promise<boolean>;
    /** Should throw error */
    shouldThrow?: boolean;
    /** Expected error message pattern */
    expectedError?: RegExp | string;
}
export interface ToolTestResult {
    /** Test case name */
    name: string;
    /** Pass/fail */
    passed: boolean;
    /** Tool result */
    result?: unknown;
    /** Error if test failed */
    error?: string;
    /** Execution time */
    executionTime: number;
}
export declare function testTool(tool: Tool, testCases: ToolTestCase[]): Promise<ToolTestResult[]>;
export declare function printToolTestResults(toolId: string, results: ToolTestResult[]): void;
//# sourceMappingURL=tool-tester.d.ts.map