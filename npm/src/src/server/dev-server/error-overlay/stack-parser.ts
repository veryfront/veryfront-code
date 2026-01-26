export interface ParsedStackFrame {
  raw: string;
  file?: string;
  line?: number;
  column?: number;
  function?: string;
}

export function parseStackTrace(stack: string): ParsedStackFrame[] {
  if (!stack) return [];

  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => ({ raw }));
}

export function formatStackTrace(stack: string): string {
  return stack || "";
}

export function hasStackTrace(error: Error): boolean {
  return Boolean(error.stack);
}
