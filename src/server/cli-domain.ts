/**
 * Private hosted-domain identity port for the Veryfront CLI.
 *
 * This module is available through an exact internal import-map alias only. It
 * lets credential-bearing CLI flows reuse the server's canonical hostname
 * rules without importing the full `veryfront/server` graph or duplicating
 * security-sensitive domain semantics.
 *
 * @internal
 */

export { type ParsedDomain, parseProjectDomain } from "./utils/domain-parser.ts";
