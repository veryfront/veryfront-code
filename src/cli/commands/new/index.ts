/**
 * New command - Lightning-fast project creation
 */

export { NewArgsSchema, newCommand, parseNewArgs } from "./command.ts";
export type { NewOptions } from "./command.ts";
export { handleNewCommand } from "./handler.ts";
export { scaffoldProjectFast } from "./fast-scaffold.ts";
export { reserveProjectSlug } from "./reserve-slug.ts";
