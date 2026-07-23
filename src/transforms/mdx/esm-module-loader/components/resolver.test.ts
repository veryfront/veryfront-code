import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { extractComponentImports, resolveComponents } from "./resolver.ts";

describe("MDX component resolver", () => {
  it("extracts live default component imports without parsing comments or strings", () => {
    const imports = extractComponentImports(`
import Button from "../components/Button.tsx";
// import Ghost from "../components/Ghost";
/* import Hidden from "./components/Hidden"; */
const example = 'import Quoted from "../components/Quoted";';
import { Named } from "../components/Named";
import Card
  from "./components/Card.jsx";
`);

    assertEquals(
      imports,
      new Map([
        ["Button", "Button"],
        ["Card", "Card"],
      ]),
    );
  });

  it("uses the request adapter and propagates operational scan failures", async () => {
    const adapter = {
      fs: {
        readDir() {
          throw Object.assign(new Error("adapter permission denied"), { code: "EACCES" });
        },
      },
    } as unknown as RuntimeAdapter;

    await assertRejects(
      () => resolveComponents(new Map([["Button", "Button"]]), "/project", adapter),
      Error,
      "adapter permission denied",
    );
  });
});
