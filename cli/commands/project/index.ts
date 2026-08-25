export {
  buildProjectDeleteUrl,
  deleteRemoteProject,
  parseProjectDeleteArgs,
  projectCommand,
} from "./command.ts";
export type { ProjectDeleteOptions } from "./command.ts";
export { handleProjectCommand } from "./handler.ts";
