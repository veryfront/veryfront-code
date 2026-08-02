import { join } from "#veryfront/compat/path";
import { writeTextFile } from "#veryfront/compat/fs.ts";

/** Install a discovered, generation-owned allow policy for action integration tests. */
export async function installTestRscActionAuthorization(
  projectDir: string,
): Promise<void> {
  await writeTextFile(
    join(projectDir, "rsc-action-authorization.extension.ts"),
    `export default () => ({
      name: "test-rsc-action-authorization",
      version: "1.0.0",
      capabilities: [],
      contracts: { provides: ["RscActionAuthorizationProvider"] },
      setup(context) {
        context.provide("RscActionAuthorizationProvider", {
          authorize: () => true,
        });
      },
    });\n`,
  );
}
