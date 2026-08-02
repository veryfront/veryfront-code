import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, mkdir, realPath, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import {
  bindExtensionEntrypoint,
  captureExtensionOwner,
  revalidateBoundExtensionEntrypoint,
} from "./entrypoint-identity.ts";

describe("native extension entrypoint identity", () => {
  it("captures, binds, and revalidates with the active runtime filesystem", async () => {
    const temporaryDirectory = await makeTempDir({ prefix: "vf-runtime-binding-" });
    try {
      const ownerPath = join(temporaryDirectory, "owner");
      const targetPath = join(ownerPath, "index.ts");
      await mkdir(ownerPath);
      await writeTextFile(targetPath, "export default 1;\n");

      const owner = await captureExtensionOwner(ownerPath);
      const binding = await bindExtensionEntrypoint(owner, "./index.ts");
      await revalidateBoundExtensionEntrypoint(binding);

      assertEquals(binding.path, await realPath(targetPath));
      if (isNode || isBun) {
        assertEquals(typeof owner.identity.dev, "bigint");
        assertEquals(typeof owner.identity.ino, "bigint");
        assertEquals(typeof binding.targetIdentity.dev, "bigint");
        assertEquals(typeof binding.targetIdentity.ino, "bigint");
      }
    } finally {
      await remove(temporaryDirectory, { recursive: true });
    }
  });
});
