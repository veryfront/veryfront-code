/**
 * Local JavaScript Environment
 *
 * Executes JavaScript code in a sandboxed environment with:
 * - Controlled globals
 * - Context variable injection
 * - Nested RLM call support
 * - Stdout/stderr capture
 */

import type {
  ContextMetadata,
  EnvironmentConfig,
  EnvironmentType,
  ExecutionError,
  LoadedContext,
  NestedLLMHandler,
  NestedRLMCall,
  REPLResult,
  RLMContext,
  RLMEnvironment,
} from "../types.ts";

// Safe globals that are allowed in the sandbox
const SAFE_GLOBALS = new Set([
  // Primitives
  "undefined",
  "NaN",
  "Infinity",
  // Type constructors
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Date",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  // Functions
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURI",
  "encodeURIComponent",
  "decodeURI",
  "decodeURIComponent",
  // JSON
  "JSON",
  // Math
  "Math",
  // Collections
  "Promise",
  // Console (captured)
  "console",
  // Utilities
  "structuredClone",
]);

// Blocked globals that should never be accessible
const BLOCKED_GLOBALS = new Set([
  "eval",
  "Function",
  "Deno",
  "process",
  "require",
  "module",
  "exports",
  "globalThis",
  "window",
  "self",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "SharedWorker",
  "importScripts",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
]);

export class LocalEnvironment implements RLMEnvironment {
  readonly type: EnvironmentType = "local";
  readonly persistent: boolean;

  private locals: Record<string, unknown> = {};
  private llmHandler: NestedLLMHandler | null = null;
  private pendingRLMCalls: NestedRLMCall[] = [];
  private depth: number = 1;

  constructor(config: EnvironmentConfig = { type: "local" }) {
    this.persistent = config.persistent ?? false;
  }

  async setup(): Promise<void> {
    this.locals = {};
    this.pendingRLMCalls = [];
  }

  async teardown(): Promise<void> {
    this.locals = {};
    this.llmHandler = null;
    this.pendingRLMCalls = [];
  }

  async loadContext(context: RLMContext): Promise<LoadedContext> {
    const metadata = this.analyzeContext(context);
    const variables: Record<string, unknown> = {};

    if (typeof context === "string") {
      variables["context"] = context;
    } else if (Array.isArray(context)) {
      variables["context"] = context;
    } else if (context instanceof Map) {
      for (const [key, value] of context) {
        variables[key] = value;
      }
    } else {
      for (const [key, value] of Object.entries(context)) {
        variables[key] = value;
      }
    }

    // Merge into locals
    Object.assign(this.locals, variables);

    return { variables, metadata };
  }

  async execute(code: string): Promise<REPLResult> {
    const startTime = performance.now();
    this.pendingRLMCalls = [];

    // Capture console output
    const stdout: string[] = [];
    const stderr: string[] = [];

    const capturedConsole = {
      log: (...args: unknown[]) => stdout.push(args.map(String).join(" ")),
      info: (...args: unknown[]) => stdout.push(args.map(String).join(" ")),
      warn: (...args: unknown[]) => stderr.push(`[warn] ${args.map(String).join(" ")}`),
      error: (...args: unknown[]) => stderr.push(`[error] ${args.map(String).join(" ")}`),
      debug: (...args: unknown[]) => stdout.push(`[debug] ${args.map(String).join(" ")}`),
    };

    // Build sandbox globals
    const sandbox = this.buildSandbox(capturedConsole);

    try {
      // Execute code in sandbox
      const result = await this.executeInSandbox(code, sandbox);

      // Update locals with any new variables
      if (result.newLocals) {
        Object.assign(this.locals, result.newLocals);
      }

      const executionTimeMs = performance.now() - startTime;

      return {
        success: true,
        output: {
          stdout: stdout.join("\n"),
          stderr: stderr.join("\n"),
          returnValue: result.returnValue,
        },
        locals: { ...this.locals },
        executionTimeMs,
        nestedRLMCalls: [...this.pendingRLMCalls],
      };
    } catch (error) {
      const executionTimeMs = performance.now() - startTime;
      const execError = this.parseError(error);

      return {
        success: false,
        output: {
          stdout: stdout.join("\n"),
          stderr: stderr.join("\n") + `\n${execError.message}`,
        },
        locals: { ...this.locals },
        executionTimeMs,
        nestedRLMCalls: [...this.pendingRLMCalls],
        error: execError,
      };
    }
  }

  getLocals(): Record<string, unknown> {
    return { ...this.locals };
  }

  clearLocals(): void {
    this.locals = {};
  }

  registerLLMHandler(handler: NestedLLMHandler): void {
    this.llmHandler = handler;
  }

  setDepth(depth: number): void {
    this.depth = depth;
  }

  private buildSandbox(console: typeof capturedConsole): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
      console,
      // Inject current locals
      ...this.locals,
    };

    // Add safe globals
    for (const name of SAFE_GLOBALS) {
      if (name === "console") continue; // Already added
      sandbox[name] = (globalThis as Record<string, unknown>)[name];
    }

    // Add LLM query function for nested calls
    sandbox["llm_query"] = this.createLLMQueryFunction();
    sandbox["rlm_query"] = this.createLLMQueryFunction(); // Alias

    // Block dangerous globals
    for (const name of BLOCKED_GLOBALS) {
      sandbox[name] = undefined;
    }

    return sandbox;
  }

  private createLLMQueryFunction(): (query: string) => Promise<string> {
    return async (query: string): Promise<string> => {
      if (!this.llmHandler) {
        throw new Error("LLM handler not registered");
      }

      const result = await this.llmHandler(query, this.depth + 1);
      this.pendingRLMCalls.push(result);

      return result.response;
    };
  }

  private async executeInSandbox(
    code: string,
    sandbox: Record<string, unknown>
  ): Promise<{ returnValue?: unknown; newLocals?: Record<string, unknown> }> {
    // Create function with sandbox as scope
    // Note: This is not truly sandboxed - production should use vm or worker
    const keys = Object.keys(sandbox);
    const values = Object.values(sandbox);

    // Check if code is a simple expression (no semicolons except at end, no statements)
    const trimmedCode = code.trim();
    const isSimpleExpression = !trimmedCode.includes("\n") &&
      !trimmedCode.match(/^(let|const|var|if|for|while|switch|try|class|function|throw|return)\s/) &&
      !trimmedCode.includes(";");

    let wrappedCode: string;
    if (isSimpleExpression) {
      // Simple expression - return directly
      wrappedCode = `return (async () => { return (${trimmedCode}); })()`;
    } else {
      // Multi-statement code - wrap and try to capture last expression
      // Split into lines and try to return the last non-empty line if it's an expression
      const lines = trimmedCode.split("\n").filter(l => l.trim());
      const lastLine = lines[lines.length - 1]?.trim() ?? "";

      // Check if last line is a standalone expression (not a statement keyword)
      const isLastLineExpression = lastLine &&
        !lastLine.match(/^(let|const|var|if|for|while|switch|try|class|function|return|throw|break|continue|debugger)\s/) &&
        !lastLine.startsWith("throw ") &&
        !lastLine.endsWith("{") &&
        !lastLine.endsWith("}");

      if (isLastLineExpression && lines.length > 1) {
        // Insert return before last line
        const bodyLines = lines.slice(0, -1).join("\n");
        wrappedCode = `return (async () => { ${bodyLines}\n return (${lastLine.replace(/;$/, "")}); })()`;
      } else if (lines.length === 1 && isLastLineExpression) {
        wrappedCode = `return (async () => { return (${lastLine.replace(/;$/, "")}); })()`;
      } else {
        wrappedCode = `return (async () => { ${trimmedCode} })()`;
      }
    }

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction(...keys, wrappedCode);

    const returnValue = await fn(...values);

    // Extract new locals (variables that were assigned)
    // This is a simplified version - full implementation would parse the AST
    const newLocals: Record<string, unknown> = {};

    // Look for variable assignments in the code
    const assignmentRegex = /(?:let|const|var)\s+(\w+)\s*=/g;
    let match;
    while ((match = assignmentRegex.exec(code)) !== null) {
      const varName = match[1];
      if (varName && sandbox[varName] !== undefined) {
        newLocals[varName] = sandbox[varName];
      }
    }

    return { returnValue, newLocals };
  }

  private parseError(error: unknown): ExecutionError {
    if (error instanceof Error) {
      const execError: ExecutionError = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };

      // Try to extract line/column from stack
      const stackMatch = error.stack?.match(/:(\d+):(\d+)/);
      if (stackMatch) {
        execError.line = parseInt(stackMatch[1], 10);
        execError.column = parseInt(stackMatch[2], 10);
      }

      return execError;
    }

    return {
      name: "Error",
      message: String(error),
    };
  }

  private analyzeContext(context: RLMContext): ContextMetadata {
    let type: ContextMetadata["type"];
    let keys: string[] | undefined;
    let totalSize: number;

    if (typeof context === "string") {
      type = "string";
      totalSize = context.length;
    } else if (Array.isArray(context)) {
      type = "array";
      totalSize = JSON.stringify(context).length;
    } else if (context instanceof Map) {
      type = "map";
      keys = Array.from(context.keys());
      totalSize = JSON.stringify(Object.fromEntries(context)).length;
    } else {
      type = "object";
      keys = Object.keys(context);
      totalSize = JSON.stringify(context).length;
    }

    // Rough token estimate: ~4 chars per token
    const estimatedTokens = Math.ceil(totalSize / 4);

    return { type, keys, totalSize, estimatedTokens };
  }
}

const capturedConsole = {
  log: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
  debug: (..._args: unknown[]) => {},
};
