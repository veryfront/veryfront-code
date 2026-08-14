/**
 * The demo's dev-server step.
 *
 * Lives apart from `demo.ts` so the address the demo shows and opens can be
 * tested without booting a dev server, a browser, or stdin.
 *
 * @module cli/commands/demo/dev-step
 */

import { brand, dim, success } from "#cli/ui";
import type { DevCommandResult } from "../dev/index.ts";
import { serverDisplayUrl } from "../dev/server-url.ts";

export interface DemoDevStepDeps {
  /** Starts the dev server. */
  start: () => Promise<DevCommandResult>;
  /** Opens the demo's browser at the given URL. */
  open: (url: string) => Promise<unknown>;
  /** Resolves when the viewer asks for the dev server to stop. */
  waitForStop: () => Promise<unknown>;
  /** Writes one line of demo output. */
  log: (line: string) => void;
}

/**
 * Shows the running dev server, opens it, then stops it on request.
 *
 * Both the printed URL and the opened URL come from the address and port the
 * server actually bound. `veryfront dev` asks for 3000 but falls forward when
 * that is taken, and it binds a literal address rather than the name
 * `localhost` - so keying off either the requested port or the name would send
 * the viewer to whatever process caused the collision instead of to the demo.
 */
export async function runDemoDevStep(deps: DemoDevStepDeps): Promise<void> {
  const result = await deps.start();
  await result.ready;

  const serverUrl = serverDisplayUrl(result.bindAddress, result.port);

  deps.log(`  ${success("●")} ${brand(`${serverUrl}/`)}`);
  deps.log("");

  deps.log(`  ${dim("Opening browser...")}`);
  try {
    await deps.open(serverUrl);
  } catch {
    // Ignore if browser can't be opened
  }

  deps.log("");
  deps.log(`  ${dim("Press Enter to stop the dev server and continue...")}`);

  await deps.waitForStop();

  deps.log("");
  deps.log(`  ${dim("Stopping dev server...")}`);
  await result.stop();
  await result.done;
}
