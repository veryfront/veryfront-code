/**
 * Secure Filesystem Wrapper
 *
 * Provides automatic path validation for all filesystem operations.
 * Wraps RuntimeAdapter filesystem methods with security checks.
 *
 * Features:
 * - Automatic path validation before all operations
 * - Configurable validation levels per context
 * - Protection against path traversal attacks
 * - Audit logging for security events
 * - Drop-in replacement for adapter.fs
 *
 * @module security/secure-fs
 */

import type {
  DirEntry,
  FileInfo,
  FileWatcher,
  RuntimeAdapter,
} from "@veryfront/platform/adapters/base.ts";
import { logger } from "@veryfront/utils";
import {
  sanitizePathForDisplay,
  validatePath,
  validatePathSync,
  type ValidationOptions,
  ValidationPresets,
  type ValidationResult,
} from "./path-validation.ts";

/**
 * Security context for filesystem operations
 */
export type SecurityContext =
  | "user-input" // User-provided paths (strict)
  | "static-serving" // Static file serving
  | "build" // Build-time operations (permissive)
  | "internal" // Internal framework operations
  | "route-discovery" // Route discovery operations
  | "module-loading"; // Module loading operations

/**
 * Secure filesystem wrapper configuration
 */
export interface SecureFsConfig {
  /** Base directory to restrict operations to */
  baseDir: string;

  /** Runtime adapter to wrap */
  adapter: RuntimeAdapter;

  /** Security context (determines validation strictness) */
  context?: SecurityContext;

  /** Custom validation options (overrides context preset) */
  validationOptions?: Partial<ValidationOptions>;

  /** Whether to throw on validation errors (default: true) */
  throwOnError?: boolean;

  /** Callback for security events */
  onSecurityEvent?: (event: SecurityEvent) => void;
}

/**
 * Security event for auditing
 */
export interface SecurityEvent {
  type: "validation-failed" | "validation-passed" | "operation-blocked";
  operation: string;
  path: string;
  error?: string;
  code?: string;
  timestamp: Date;
}

/**
 * Get validation options for a security context
 */
function getContextValidationOptions(
  context: SecurityContext,
  baseDir: string,
): ValidationOptions {
  switch (context) {
    case "user-input":
      return ValidationPresets.userInput(baseDir);
    case "static-serving":
      return ValidationPresets.static(baseDir);
    case "build":
      return ValidationPresets.build(baseDir);
    case "route-discovery":
      return {
        baseDir,
        level: "normal",
        allowedDirs: ["app", "pages", "routes", "api"],
        followSymlinks: false,
        allowAbsolute: false,
      };
    case "module-loading":
      return {
        baseDir,
        level: "normal",
        allowedDirs: [
          "app",
          "pages",
          "components",
          "lib",
          "modules",
          "server",
          "client",
          "shared",
          "islands",
        ],
        followSymlinks: false,
        allowAbsolute: true, // Allow node_modules, etc.
      };
    case "internal":
    default:
      return ValidationPresets.internal(baseDir);
  }
}

/**
 * Secure filesystem wrapper
 *
 * Drop-in replacement for adapter.fs with automatic path validation.
 */
export class SecureFs {
  private config: Required<SecureFsConfig>;
  private validationOptions: ValidationOptions;

  constructor(config: SecureFsConfig) {
    this.config = {
      context: "internal",
      throwOnError: true,
      onSecurityEvent: () => {},
      validationOptions: {},
      ...config,
    };

    const contextOptions = getContextValidationOptions(
      this.config.context,
      this.config.baseDir,
    );

    this.validationOptions = {
      ...contextOptions,
      ...this.config.validationOptions,
      baseDir: this.config.baseDir,
      adapter: this.config.adapter,
    };
  }

  /**
   * Validate a path before operation
   */
  private async validatePathForOperation(
    path: string,
    operation: string,
  ): Promise<ValidationResult> {
    const result = await validatePath(path, this.validationOptions);

    // Emit security event
    this.config.onSecurityEvent({
      type: result.valid ? "validation-passed" : "validation-failed",
      operation,
      path: sanitizePathForDisplay(path, this.config.baseDir),
      error: result.error,
      code: result.code,
      timestamp: new Date(),
    });

    // Throw if validation failed and throwOnError is true
    if (!result.valid && this.config.throwOnError) {
      throw new SecurityError(
        `Path validation failed for ${operation}: ${result.error}`,
        result.code,
        path,
      );
    }

    return result;
  }

  /**
   * Validate a path synchronously
   */
  private validatePathSync(path: string, operation: string): ValidationResult {
    const result = validatePathSync(path, this.validationOptions);

    // Emit security event
    this.config.onSecurityEvent({
      type: result.valid ? "validation-passed" : "validation-failed",
      operation,
      path: sanitizePathForDisplay(path, this.config.baseDir),
      error: result.error,
      code: result.code,
      timestamp: new Date(),
    });

    // Throw if validation failed and throwOnError is true
    if (!result.valid && this.config.throwOnError) {
      throw new SecurityError(
        `Path validation failed for ${operation}: ${result.error}`,
        result.code,
        path,
      );
    }

    return result;
  }

  async readFile(path: string): Promise<string> {
    const validation = await this.validatePathForOperation(path, "readFile");
    if (!validation.valid || !validation.canonicalPath) {
      throw new SecurityError("Invalid path", validation.code, path);
    }
    return await this.config.adapter.fs.readFile(validation.canonicalPath);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const validation = await this.validatePathForOperation(path, "readFileBytes");
    if (!validation.valid || !validation.canonicalPath) {
      throw new SecurityError("Invalid path", validation.code, path);
    }

    const reader = this.config.adapter.fs.readFileBytes;
    if (reader) {
      return await reader.call(this.config.adapter.fs, validation.canonicalPath);
    }

    const content = await this.config.adapter.fs.readFile(validation.canonicalPath);
    return new TextEncoder().encode(content);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const validation = await this.validatePathForOperation(path, "writeFile");
    if (!validation.valid || !validation.canonicalPath) {
      throw new SecurityError("Invalid path", validation.code, path);
    }
    await this.config.adapter.fs.writeFile(validation.canonicalPath, content);
  }

  async stat(path: string): Promise<FileInfo> {
    const validation = await this.validatePathForOperation(path, "stat");
    if (!validation.valid || !validation.canonicalPath) {
      throw new SecurityError("Invalid path", validation.code, path);
    }
    return await this.config.adapter.fs.stat(validation.canonicalPath);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const validation = await this.validatePathForOperation(path, "mkdir");
    if (!validation.valid || !validation.canonicalPath) {
      throw new SecurityError("Invalid path", validation.code, path);
    }
    await this.config.adapter.fs.mkdir(validation.canonicalPath, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const validation = await this.validatePathForOperation(path, "remove");
    if (!validation.valid || !validation.canonicalPath) {
      throw new SecurityError("Invalid path", validation.code, path);
    }
    await this.config.adapter.fs.remove(validation.canonicalPath, options);
  }

  async exists(path: string): Promise<boolean> {
    const validation = await this.validatePathForOperation(path, "exists");
    if (!validation.valid || !validation.canonicalPath) {
      return false;
    }
    return await this.config.adapter.fs.exists(validation.canonicalPath);
  }

  readDir(path: string): AsyncIterable<DirEntry> {
    const validation = this.validatePathSync(path, "readDir");
    if (!validation.valid || !validation.canonicalPath) {
      throw new SecurityError("Invalid path", validation.code, path);
    }
    return this.config.adapter.fs.readDir(validation.canonicalPath);
  }

  async makeTempDir(prefix: string): Promise<string> {
    return await this.config.adapter.fs.makeTempDir(prefix);
  }

  watch(
    paths: string | string[],
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): FileWatcher {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    const validatedPaths: string[] = [];

    for (const path of pathArray) {
      const validation = this.validatePathSync(path, "watch");
      if (validation.valid && validation.canonicalPath) {
        validatedPaths.push(validation.canonicalPath);
      } else if (this.config.throwOnError) {
        throw new SecurityError("Invalid path", validation.code, path);
      }
    }

    if (validatedPaths.length === 0) {
      throw new SecurityError(
        "No valid paths to watch",
        "NO_VALID_PATHS",
        paths.toString(),
      );
    }

    return this.config.adapter.fs.watch(
      validatedPaths.length === 1 ? validatedPaths[0]! : validatedPaths,
      options,
    );
  }

  /**
   * Get underlying adapter (use with caution)
   * This bypasses security checks
   */
  getUnsafeAdapter(): RuntimeAdapter {
    logger.warn(
      "[SecureFs] Using unsafe adapter - security checks bypassed!",
    );
    return this.config.adapter;
  }

  /**
   * Update validation options at runtime
   */
  updateValidationOptions(options: Partial<ValidationOptions>): void {
    this.validationOptions = {
      ...this.validationOptions,
      ...options,
    };
  }

  /**
   * Change security context
   */
  setContext(context: SecurityContext): void {
    const contextOptions = getContextValidationOptions(
      context,
      this.config.baseDir,
    );
    this.validationOptions = {
      ...contextOptions,
      ...this.config.validationOptions,
      adapter: this.config.adapter,
    };
    this.config.context = context;
  }
}

/**
 * Security error thrown by SecureFs
 */
export class SecurityError extends Error {
  constructor(
    message: string,
    public code?: string,
    public path?: string,
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Create a secure filesystem wrapper
 *
 * @example
 * ```typescript
 * const secureFs = createSecureFs({
 *   baseDir: ctx.projectDir,
 *   adapter: ctx.adapter,
 *   context: "user-input",
 *   onSecurityEvent: (event) => {
 *     if (event.type === "validation-failed") {
 *       console.error(`Security: Blocked ${event.operation} on ${event.path}`);
 *     }
 *   }
 * });
 *
 * // Use like adapter.fs but with automatic validation
 * const content = await secureFs.readFile("app/page.tsx");
 * ```
 */
export function createSecureFs(config: SecureFsConfig): SecureFs {
  return new SecureFs(config);
}

/**
 * Wrap an existing adapter with security
 *
 * @example
 * ```typescript
 * const originalAdapter = ctx.adapter;
 * const secureAdapter = wrapAdapterWithSecurity(originalAdapter, {
 *   baseDir: ctx.projectDir,
 *   context: "build",
 * });
 *
 * // secureAdapter.fs is now a SecureFs instance
 * ```
 */
export function wrapAdapterWithSecurity(
  adapter: RuntimeAdapter,
  options: Omit<SecureFsConfig, "adapter">,
): RuntimeAdapter & { secureFs: SecureFs } {
  const secureFs = createSecureFs({
    ...options,
    adapter,
  });

  // Create a new adapter with secure fs
  return {
    ...adapter,
    fs: secureFs,
    secureFs, // Keep reference to SecureFs for advanced usage
  };
}
