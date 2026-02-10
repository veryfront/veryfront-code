import type { StyleRule } from "../types.ts";
import { identifierCasingRule } from "./identifier-casing.ts";
import { noDefaultExportRule } from "./no-default-export.ts";
import { noExplicitPublicRule } from "./no-explicit-public.ts";

export const STYLE_RULES: StyleRule[] = [
  noDefaultExportRule,
  noExplicitPublicRule,
  identifierCasingRule,
];
