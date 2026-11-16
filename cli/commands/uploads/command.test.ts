import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { uploadsCommand } from "./command.ts";
import {
  assertRefusesUnlinkedFolder,
  UNLINKED_PROJECT_DIR,
  withUnlinkedProjectEnv,
} from "../../test-utils/unlinked-project.ts";

describe("uploadsCommand in a folder with no linked project", () => {
  it("stops before the API for every subcommand", async () => {
    await assertRefusesUnlinkedFolder(uploadsCommand, { _: ["uploads", "list"] });
    await assertRefusesUnlinkedFolder(uploadsCommand, {
      _: ["uploads", "pull", "guide.pdf"],
      "output-dir": "out",
    });
    await assertRefusesUnlinkedFolder(uploadsCommand, {
      _: ["uploads", "put", "guide.pdf"],
      from: "guide.pdf",
    });
    await assertRefusesUnlinkedFolder(uploadsCommand, { _: ["uploads", "delete", "guide.pdf"] });
  });

  it("uses --project", async () => {
    const requests = await withUnlinkedProjectEnv(() =>
      uploadsCommand({
        _: ["uploads", "list"],
        "project-dir": UNLINKED_PROJECT_DIR,
        project: "support-desk",
        json: true,
      }), { VERYFRONT_API_KEY: "test-token" });
    assertEquals(requests, ["/projects/support-desk/uploads"]);
  });
});
