/**
 * Test wrapper command
 *
 * Runs deno test and transforms output to structured JSON.
 *
 * @module cli/commands/test
 */

export interface TestResult {
  success: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration_ms: number;
  };
  failures: Array<{
    file: string;
    test: string;
    error: string;
    line?: number;
  }>;
}

export function parseTestOutput(output: string, exitCode: number): TestResult {
  const lines = output.split("\n");
  const noTestModules = lines.some((line) => line.trim() === "error: No test modules found");

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs = 0;

  for (const line of lines) {
    const summaryMatch = line.match(/(\d+)\s+passed\s*\|\s*(\d+)\s+failed/);
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1] ?? "0", 10);
      failed = parseInt(summaryMatch[2] ?? "0", 10);
    }

    const durationMatch = line.match(/\((\d+\.?\d*)s\)/);
    if (durationMatch) {
      durationMs = Math.round(parseFloat(durationMatch[1] ?? "0") * 1000);
    }

    const skippedMatch = line.match(/(\d+)\s+ignored/);
    if (skippedMatch) {
      skipped = parseInt(skippedMatch[1] ?? "0", 10);
    }
  }

  const failures: TestResult["failures"] = [];
  const failureRegex = /^(.*?)\s+\.\.\.\s+FAILED/;
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];
    if (!currentLine) continue;
    const match = currentLine.match(failureRegex);
    if (match) {
      const testName = (match[1] ?? "").trim();
      let error = "";
      let file = "";
      let line: number | undefined;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const lineText = lines[j];
        if (!lineText) continue;
        const fileLine = lineText.match(/at\s+(.*?):(\d+)/);
        if (fileLine?.[1] && fileLine[2]) {
          file = fileLine[1];
          line = parseInt(fileLine[2], 10);
        }
        if (lineText.includes("Error:") || lineText.includes("assert")) {
          error = lineText.trim();
        }
      }
      failures.push({ file, test: testName, error, line });
    }
  }

  const total = passed + failed + skipped;
  const isEmptyNoTestRun = noTestModules && total === 0 && failures.length === 0;

  return {
    success: exitCode === 0 || isEmptyNoTestRun,
    summary: {
      total,
      passed,
      failed,
      skipped,
      duration_ms: durationMs,
    },
    failures,
  };
}
