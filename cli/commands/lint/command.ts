/**
 * Lint wrapper command
 *
 * Runs deno lint and transforms output to structured JSON.
 *
 * @module cli/commands/lint
 */

export interface LintDiagnostic {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

export interface LintResult {
  success: boolean;
  diagnostics: LintDiagnostic[];
  summary: {
    total: number;
    files_checked: number;
  };
}

export function parseLintJsonOutput(output: string, exitCode: number): LintResult {
  try {
    const parsed = JSON.parse(output);
    const diagnostics: LintDiagnostic[] = (parsed.diagnostics ?? []).map(
      (d: {
        filename?: string;
        range?: { start?: { line?: number; col?: number } };
        code?: string;
        message?: string;
      }) => ({
        file: d.filename ?? "",
        line: d.range?.start?.line ?? 0,
        col: d.range?.start?.col ?? 0,
        code: d.code ?? "",
        message: d.message ?? "",
      }),
    );

    return {
      success: exitCode === 0,
      diagnostics,
      summary: {
        total: diagnostics.length,
        files_checked: new Set(diagnostics.map((d) => d.file)).size,
      },
    };
  } catch {
    return {
      success: exitCode === 0,
      diagnostics: [],
      summary: { total: 0, files_checked: 0 },
    };
  }
}
