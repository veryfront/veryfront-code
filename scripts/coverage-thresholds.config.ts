/**
 * Coverage Threshold Configuration
 *
 * Defines minimum code coverage requirements for different modules.
 * More critical modules require higher coverage thresholds.
 */

export interface CoverageThreshold {
  /** Minimum line coverage percentage (0-100) */
  lines: number;
  /** Optional: Minimum branch coverage percentage */
  branches?: number;
  /** Optional: Minimum function coverage percentage */
  functions?: number;
}

/**
 * Module-specific coverage thresholds
 *
 * Usage:
 * ```bash
 * deno run --allow-read scripts/check-coverage-per-module.ts
 * ```
 */
export const MODULE_THRESHOLDS: Record<string, CoverageThreshold> = {
  // Core modules - Critical, require highest coverage
  "src/core/": {
    lines: 90,
    branches: 85,
    functions: 90,
  },

  "src/core/config/": {
    lines: 95,
    branches: 90,
    functions: 95,
  },

  "src/core/errors/": {
    lines: 90,
    branches: 85,
    functions: 90,
  },

  // Rendering - High coverage required (user-facing)
  "src/rendering/": {
    lines: 85,
    branches: 80,
    functions: 85,
  },

  "src/rendering/ssr-react18.ts": {
    lines: 90,
    branches: 85,
    functions: 90,
  },

  "src/rendering/cache/": {
    lines: 90,
    branches: 85,
    functions: 90,
  },

  // Routing - High coverage required (critical path)
  "src/routing/": {
    lines: 85,
    branches: 80,
    functions: 85,
  },

  "src/routing/router.ts": {
    lines: 90,
    branches: 85,
    functions: 90,
  },

  // Server - High coverage (production-critical)
  "src/server/": {
    lines: 80,
    branches: 75,
    functions: 80,
  },

  "src/server/production-server.ts": {
    lines: 85,
    branches: 80,
    functions: 85,
  },

  // Build - Medium-high coverage
  "src/build/": {
    lines: 75,
    branches: 70,
    functions: 75,
  },

  "src/build/production/": {
    lines: 80,
    branches: 75,
    functions: 80,
  },

  // Security - Highest coverage required
  "src/security/": {
    lines: 95,
    branches: 90,
    functions: 95,
  },

  // Platform adapters - High coverage
  "src/platform/adapters/": {
    lines: 85,
    branches: 80,
    functions: 85,
  },

  // HTML generation - Medium coverage
  "src/html/": {
    lines: 80,
    branches: 75,
    functions: 80,
  },

  // CLI - Medium coverage
  "src/cli/": {
    lines: 75,
    branches: 70,
    functions: 75,
  },

  // Observability - Medium coverage
  "src/observability/": {
    lines: 75,
    branches: 70,
    functions: 75,
  },

  // Data - Medium coverage
  "src/data/": {
    lines: 80,
    branches: 75,
    functions: 80,
  },

  // Modules - Medium coverage
  "src/modules/": {
    lines: 75,
    branches: 70,
    functions: 75,
  },
};

/**
 * Default threshold for modules not explicitly listed
 */
export const DEFAULT_THRESHOLD: CoverageThreshold = {
  lines: 80,
  branches: 75,
  functions: 80,
};

/**
 * Global minimum threshold (safety net)
 * The entire codebase must meet at least this coverage
 */
export const GLOBAL_THRESHOLD: CoverageThreshold = {
  lines: 80,
  branches: 70,
  functions: 75,
};

/**
 * Files to exclude from coverage requirements
 */
export const COVERAGE_EXCLUDES = [
  "**/node_modules/**",
  "**/__tests__/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/test-*.ts",
  "**/mock-*.ts",
  "**/_test.ts",
  "**/examples/**",
  "**/fixtures/**",
];

/**
 * Get the threshold for a specific file path
 */
export function getThresholdForFile(filePath: string): CoverageThreshold {
  // Check for exact matches first
  if (MODULE_THRESHOLDS[filePath]) {
    return MODULE_THRESHOLDS[filePath];
  }

  // Check for directory matches (most specific first)
  const matchingPaths = Object.keys(MODULE_THRESHOLDS)
    .filter((pattern) => filePath.startsWith(pattern))
    .sort((a, b) => b.length - a.length); // Longest match first

  if (matchingPaths.length > 0) {
    return MODULE_THRESHOLDS[matchingPaths[0]!]!;
  }

  return DEFAULT_THRESHOLD;
}

/**
 * Check if a file should be excluded from coverage
 */
export function shouldExcludeFile(filePath: string): boolean {
  return COVERAGE_EXCLUDES.some((pattern) => {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    return regex.test(filePath);
  });
}

/**
 * Format threshold for display
 */
export function formatThreshold(threshold: CoverageThreshold): string {
  const parts = [`lines: ${threshold.lines}%`];
  if (threshold.branches) parts.push(`branches: ${threshold.branches}%`);
  if (threshold.functions) parts.push(`functions: ${threshold.functions}%`);
  return parts.join(", ");
}

/**
 * Coverage enforcement configuration
 */
export const COVERAGE_CONFIG = {
  /** Fail build if coverage drops below threshold */
  failOnBelow: true,

  /** Generate detailed report */
  detailedReport: true,

  /** Show files that don't meet their threshold */
  showFailingFiles: true,

  /** Maximum number of failing files to show */
  maxFailingFilesToShow: 20,

  /** Warn if coverage is close to threshold (within this margin) */
  warningMargin: 5, // percent
} as const;
