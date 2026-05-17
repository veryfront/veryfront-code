/**
 * Extension system error definitions.
 *
 * @module extensions/errors
 */

import { defineError } from "#veryfront/errors/types.ts";

export const MISSING_EXTENSION_ERROR = defineError({
  slug: "missing-extension",
  category: "RUNTIME",
  status: 500,
  title: "Required extension not found",
  suggestion: "Install the missing extension package and add it to your configuration",
});

export const EXTENSION_VALIDATION_ERROR = defineError({
  slug: "extension-validation",
  category: "CONFIG",
  status: 422,
  title: "Extension validation failed",
  suggestion: "Check that the extension exports a valid name, version, and capabilities array",
});

export const CIRCULAR_DEPENDENCY_ERROR = defineError({
  slug: "extension-circular-dependency",
  category: "CONFIG",
  status: 422,
  title: "Circular dependency detected between extensions",
  suggestion: "Review the 'extends' fields in your extensions to break the cycle",
});

export const EXTENSION_CONFLICT_ERROR = defineError({
  slug: "extension-conflict",
  category: "CONFIG",
  status: 409,
  title: "Conflicting extensions detected",
  suggestion: "Remove or disable one of the conflicting extensions in your configuration",
});
