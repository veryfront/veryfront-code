import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExtensionContext } from "veryfront/extensions";
import type { HTMLHeadLocator } from "veryfront/extensions/parser";
import extParse5 from "./index.ts";

const CONSERVATIVE_LOCATION = {
  ok: true,
  placement: {
    contentStart: 0,
    importMapInsertion: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    endInsertion: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    importMapPreludeEndOffset: 0,
    moduleResolutionOrdering: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    authoredImportMapState: {
      status: "invalid",
      reason: "unusable-element",
    },
    hasLocatedStartTag: false,
    hasLocatedEndTag: false,
  },
} as const;

describe("ext-parser-parse5", () => {
  it("declares the HTMLHeadLocator contract", () => {
    const extension = extParse5();

    assertEquals(extension.name, "ext-parser-parse5");
    assertEquals(extension.version, "0.1.0");
    assertEquals(extension.contracts?.provides, ["HTMLHeadLocator"]);
    assertEquals(extension.capabilities, []);
  });

  it("provides a working bounded locator through a real extension context", async () => {
    let providedLocator: HTMLHeadLocator | undefined;
    const ctx: ExtensionContext = {
      config: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      get: () => undefined,
      require: () => {
        throw new Error("require is unused");
      },
      provide: (contract, implementation) => {
        if (contract === "HTMLHeadLocator") {
          providedLocator = implementation as HTMLHeadLocator;
        }
      },
    };

    const extension = extParse5();
    await extension.setup?.(ctx);

    assert(providedLocator);
    assertEquals(
      providedLocator.locate("a".repeat(8_388_608)),
      CONSERVATIVE_LOCATION,
    );
    assertEquals(providedLocator.locate("a".repeat(8_388_609)), {
      ok: false,
      reason: "input-too-large",
    });
  });
});
