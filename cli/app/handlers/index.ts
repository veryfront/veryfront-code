/**
 * App Handlers
 *
 * Centralized keyboard input handlers for different views and navigation modes.
 */

export { moveRemoteFocusDown, moveRemoteFocusUp, updateRemoteFocus } from "./remote-navigation.ts";

export {
  handleAuthKey,
  handleNewProjectKey,
  handleTemplatesKey,
  type ViewHandlerContext,
} from "./view-handlers.ts";
