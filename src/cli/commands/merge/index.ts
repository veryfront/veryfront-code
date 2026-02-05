/**
 * Merge command - Merge branches
 */

export {
  getBranchByName,
  MergeArgsSchema,
  mergeBranch,
  mergeCommand,
  parseMergeArgs,
} from "./command.ts";
export type { MergeOptions } from "./command.ts";
export { handleMergeCommand } from "./handler.ts";
