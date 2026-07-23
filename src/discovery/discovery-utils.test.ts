import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { filenameToId, filePathToPattern } from "./discovery-utils.ts";

describe("discovery utilities", () => {
  it("derives ids from Windows paths and every supported module extension", () => {
    assertEquals(filenameToId("C:\\project\\tools\\search-web.mjs"), "searchWeb");
    assertEquals(filenameToId("/project/tools/search-web.jsx"), "searchWeb");
  });

  it("derives resource patterns only from files within the discovery root", () => {
    assertEquals(
      filePathToPattern(
        "file:///project/resources/users/[user-id]/profile.mjs",
        "/project/resources",
      ),
      "/users/:user-id/profile",
    );

    assertThrows(
      () =>
        filePathToPattern(
          "file:///project/resources-copy/private.ts",
          "/project/resources",
        ),
      TypeError,
      "outside",
    );
  });
});
