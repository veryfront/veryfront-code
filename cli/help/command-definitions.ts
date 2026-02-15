/**
 * Command Definitions Registry
 *
 * Aggregates help definitions from individual command modules.
 * Each command's help is defined in its own command-help.ts file.
 */

import type { CommandRegistry } from "./types.ts";

// Import help definitions from command subdirectories
import { initHelp } from "../commands/init/command-help.ts";
import { devHelp } from "../commands/dev/command-help.ts";
import { buildHelp } from "../commands/build/command-help.ts";
import { serveHelp } from "../commands/serve/command-help.ts";
import { doctorHelp } from "../commands/doctor/command-help.ts";
import { cleanHelp } from "../commands/clean/command-help.ts";
import { routesHelp } from "../commands/routes/command-help.ts";
import { studioHelp } from "../commands/studio/command-help.ts";
import { lockHelp } from "../commands/lock/command-help.ts";
import { analyzeChunksHelp } from "../commands/analyze-chunks/command-help.ts";
import { generateHelp } from "../commands/generate/command-help.ts";
import { pullHelp } from "../commands/pull/command-help.ts";
import { pushHelp } from "../commands/push/command-help.ts";
import { mergeHelp } from "../commands/merge/command-help.ts";
import { deployHelp } from "../commands/deploy/command-help.ts";
import { upHelp } from "../commands/up/command-help.ts";
import { loginHelp } from "../commands/login/command-help.ts";
import { logoutHelp } from "../commands/logout/command-help.ts";
import { whoamiHelp } from "../commands/whoami/command-help.ts";
import { installHelp, uninstallHelp } from "../commands/install/command-help.ts";
import { demoHelp } from "../commands/demo/command-help.ts";
import { mcpHelp } from "../commands/mcp/command-help.ts";
import { issuesHelp } from "../commands/issues/command-help.ts";
import { startHelp } from "../commands/start/command-help.ts";

/**
 * Central registry of all command help definitions.
 * Each command's help is imported from its respective command-help.ts file.
 */
export const COMMANDS: CommandRegistry = {
  init: initHelp,
  dev: devHelp,
  build: buildHelp,
  serve: serveHelp,
  doctor: doctorHelp,
  clean: cleanHelp,
  routes: routesHelp,
  studio: studioHelp,
  lock: lockHelp,
  "analyze-chunks": analyzeChunksHelp,
  generate: generateHelp,
  pull: pullHelp,
  push: pushHelp,
  merge: mergeHelp,
  deploy: deployHelp,
  up: upHelp,
  login: loginHelp,
  logout: logoutHelp,
  whoami: whoamiHelp,
  install: installHelp,
  uninstall: uninstallHelp,
  demo: demoHelp,
  mcp: mcpHelp,
  issues: issuesHelp,
  start: startHelp,
};
