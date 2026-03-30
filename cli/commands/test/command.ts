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

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs = 0;

  for (const line of lines) {
    const summaryMatch = line.match(/(\d+)\s+passed\s*\|\s*(\d+)\s+failed/);
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1], 10);
      failed = parseInt(summaryMatch[2], 10);
    }

    const durationMatch = line.match(/\((\d+\.?\d*)s\)/);
    if (durationMatch) {
      durationMs = Math.round(parseFloat(durationMatch[1]) * 1000);
    }

    const skippedMatch = line.match(/(\d+)\s+ignored/);
    if (skippedMatch) {
      skipped = parseInt(skippedMatch[1], 10);
    }
  }

  const failures: TestResult["failures"] = [];
  const failureRegex = /^(.*?)\s+\.\.\.\s+FAILED/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(failureRegex);
    if (match) {
      const testName = match[1].trim();
      let error = "";
      let file = "";
      let line: number | undefined;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const fileLine = lines[j].match(/at\s+(.*?):(\d+)/);
        if (fileLine) {
          file = fileLine[1];
          line = parseInt(fileLine[2], 10);
        }
        if (lines[j].includes("Error:") || lines[j].includes("assert")) {
          error = lines[j].trim();
        }
      }
      failures.push({ file, test: testName, error, line });
    }
  }

  return {
    success: exitCode === 0,
    summary: {
      total: passed + failed + skipped,
      passed,
      failed,
      skipped,
      duration_ms: durationMs,
    },
    failures,
  };
}
