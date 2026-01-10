export interface ParsedStackFrame {
  raw: string;
  file?: string;
  line?: number;
  column?: number;
  function?: string;
}

/** Parse error stack trace into structured frames */
export function parseStackTrace(stack: string): ParsedStackFrame[] {
  if (!stack) return [];

  const frames: ParsedStackFrame[] = [];
  for (const line of stack.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) frames.push({ raw: trimmed });
  }
  return frames;
}

/** Format stack trace for display */
export function formatStackTrace(stack: string): string {
  return stack || "";
}

/** Check if stack trace is available */
export function hasStackTrace(error: Error): boolean {
  return !!error.stack;
}
