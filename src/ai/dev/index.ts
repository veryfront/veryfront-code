/**
 * Developer Tools Module
 *
 * Testing, debugging, and development utilities.
 *
 * @module veryfront/ai/dev
 * @example
 * ```typescript
 * import { testAgent, inspectAgent, printTestResults } from 'veryfront/ai/dev';
 *
 * // Test an agent
 * const results = await testAgent(myAgent, [
 *   { name: 'Test 1', input: 'Hello', expected: /hi|hello/i },
 * ]);
 *
 * printTestResults(results);
 *
 * // Inspect agent execution
 * const report = await inspectAgent(myAgent, 'Debug this');
 * printInspectionReport(report);
 * ```
 */

// Testing utilities
export * from "./testing/index.ts";

// Debugging utilities
export * from "./debug/index.ts";
