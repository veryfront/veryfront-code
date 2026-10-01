import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const replacements = [
  {
    name: "encoder prototype",
    source: "TextEncoder.prototype.encode = () => new Uint8Array([1]);",
  },
  { name: "Math.max", source: "Math.max = () => 0;" },
  {
    name: "typed-array length getter",
    source: `Object.defineProperty(Object.getPrototypeOf(Uint8Array.prototype), "length", {
      configurable: true,
      get: () => 0,
    });`,
  },
];

describe("validateCsrf shared-realm comparison", () => {
  for (const replacement of replacements) {
    it(`rejects unequal CSRF tokens after ${replacement.name} replacement in an isolated process`, async () => {
      const moduleUrl = new URL("../../../src/security/csrf/helpers.ts", import.meta.url).href;
      const source = `
        import { validateCsrf } from ${JSON.stringify(moduleUrl)};
        const a = "a".repeat(64);
        const b = "b".repeat(64);
        const options = { cookieName: "csrfToken", headerName: "x-csrf-token" };
        const unequal = new Request("http://localhost/form", {
          headers: { cookie: "csrfToken=" + a, "x-csrf-token": b },
        });
        const equal = new Request("http://localhost/form", {
          headers: { cookie: "csrfToken=" + a, "x-csrf-token": a },
        });
        if (validateCsrf(unequal, options)) throw new Error("baseline accepted unequal CSRF tokens");
        ${replacement.source}
        if (validateCsrf(unequal, options)) throw new Error("replacement accepted unequal CSRF tokens");
        if (!validateCsrf(equal, options)) throw new Error("replacement rejected equal CSRF tokens");
      `;
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["eval", "--frozen", "--config=deno.json", source],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
    });
  }
});
