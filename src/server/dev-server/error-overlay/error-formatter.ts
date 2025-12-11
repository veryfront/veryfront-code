
export type ErrorType = "build" | "runtime" | "hydration";

export interface ErrorInfo {
  type: ErrorType;
  error: Error;
  file?: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export function getSuggestion(error: Error): string | undefined {
  const message = error.message.toLowerCase();

  if (message.includes("unexpected token") || message.includes("parse error")) {
    return "Check for syntax errors in your file. Common issues include unclosed JSX tags or invalid JavaScript expressions.";
  }

  if (message.includes("cannot find module") || message.includes("module not found")) {
    return "Make sure the imported module exists and the path is correct. For npm packages, ensure they're installed.";
  }

  if (message.includes("frontmatter")) {
    return "Check your frontmatter syntax. It should be valid YAML between '---' markers at the top of the file.";
  }

  if (
    message.includes("invalid hook call") ||
    message.includes("hooks can only") ||
    message.includes(" hook") ||
    message.includes("usestate") ||
    message.includes("useeffect")
  ) {
    return "React hooks can only be called from within function components or custom hooks. Make sure you're not using hooks in server-side code.";
  }

  if (message.includes("component")) {
    return "Ensure your component is properly exported and the import path is correct.";
  }

  if (message.includes("hydration")) {
    return "Hydration errors occur when server and client HTML don't match. Check for client-only code like window/document access.";
  }

  return undefined;
}

export function formatErrorType(type: ErrorType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
