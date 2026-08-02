import { join } from "#veryfront/compat/path";
import { writeTextFile } from "#veryfront/compat/fs.ts";

/** Install a discovered, generation-owned allow policy for action integration tests. */
export async function installTestRscActionAuthorization(
  projectDir: string,
): Promise<void> {
  await writeTextFile(
    join(projectDir, "rsc-action-authorization.extension.ts"),
    `import { RscActionAuthorizationProviderName } from "veryfront/extensions/auth";

    export default () => ({
      name: "test-rsc-action-authorization",
      version: "1.0.0",
      capabilities: [],
      contracts: { provides: [RscActionAuthorizationProviderName] },
      setup(context) {
        context.provide(RscActionAuthorizationProviderName, {
          authorize: () => true,
        });
      },
    });\n`,
  );
}
