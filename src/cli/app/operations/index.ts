/**
 * App Operations
 *
 * Business operations for the CLI app, such as project creation.
 */

export {
  createProject,
  createProjectFromExample,
  type ProjectCreationContext,
  promptForExampleProject,
  promptForProjectName,
} from "./project-creation.ts";
