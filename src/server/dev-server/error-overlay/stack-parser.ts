
export interface ParsedStackFrame {
  raw: string;
  file?: string;
  line?: number;
  column?: number;
  function?: string;
}

export function parseStackTrace(stack: string): ParsedStackFrame[] {
  if (!stack) {
    return [];
  }

  const lines = stack.split("\n");
  const frames: ParsedStackFrame[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    frames.push({ raw: trimmed });
  }

  return frames;
}

export function formatStackTrace(stack: string): string {
  if (!stack) {
    return "";
  }

  return stack;
}

export function hasStackTrace(error: Error): boolean {
  return !!error.stack;
}
