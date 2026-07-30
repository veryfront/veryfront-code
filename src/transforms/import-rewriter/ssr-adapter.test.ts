import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteSSRImportsCompat, rewriteSSRImportsCompatAsync } from "./ssr-adapter.ts";

describe("ssr-adapter — side-effect and dynamic import rewriting", () => {
  const code = [
    `import AliasChild from "@/components/AliasChild";`,
    `import RelativeChild from "./RelativeChild.js";`,
    `import "@/components/AliasSideEffect";`,
    `import "./RelativeSideEffect.js";`,
    `const AliasDynamic = import("@/components/AliasDynamic");`,
    `const RelativeDynamic = import("./RelativeDynamic.js");`,
  ].join("\n");
  const options = {
    projectSlug: "demo",
    branch: "main",
    cacheBuster: "source-a",
  };
  const expected = [
    `import AliasChild from "/_vf_modules/components/AliasChild.js?ssr=true&project=demo&branch=main&v=source-a";`,
    `import RelativeChild from "./RelativeChild.js?ssr=true&project=demo&branch=main&v=source-a";`,
    `import "/_vf_modules/components/AliasSideEffect.js?ssr=true&project=demo&branch=main&v=source-a";`,
    `import "./RelativeSideEffect.js?ssr=true&project=demo&branch=main&v=source-a";`,
    `const AliasDynamic = import("/_vf_modules/components/AliasDynamic.js?ssr=true&project=demo&branch=main&v=source-a");`,
    `const RelativeDynamic = import("./RelativeDynamic.js?ssr=true&project=demo&branch=main&v=source-a");`,
  ].join("\n");

  it("rewrites all alias and relative import forms synchronously", () => {
    assertEquals(rewriteSSRImportsCompat(code, options), expected);
  });

  it("rewrites all alias and relative import forms asynchronously", async () => {
    assertEquals(await rewriteSSRImportsCompatAsync(code, options), expected);
  });
});

describe("ssr-adapter — individual import form coverage", () => {
  const opts = { projectSlug: "p", branch: "b", cacheBuster: "v1" };

  it('rewrites alias side-effect import: import "@/x.js"', () => {
    const result = rewriteSSRImportsCompat(`import "@/x.js";`, opts);
    assertEquals(result, `import "/_vf_modules/x.js?ssr=true&project=p&branch=b&v=v1";`);
  });

  it('rewrites alias dynamic import: import("@/x.js")', () => {
    const result = rewriteSSRImportsCompat(`const m = import("@/x.js");`, opts);
    assertEquals(result, `const m = import("/_vf_modules/x.js?ssr=true&project=p&branch=b&v=v1");`);
  });

  it('rewrites relative side-effect import: import "./y.js"', () => {
    const result = rewriteSSRImportsCompat(`import "./y.js";`, opts);
    assertEquals(result, `import "./y.js?ssr=true&project=p&branch=b&v=v1";`);
  });

  it('rewrites relative dynamic import: import("../z.js")', () => {
    const result = rewriteSSRImportsCompat(`const m = import("../z.js");`, opts);
    assertEquals(result, `const m = import("../z.js?ssr=true&project=p&branch=b&v=v1");`);
  });

  it("rewrites alias side-effect import asynchronously", async () => {
    const result = await rewriteSSRImportsCompatAsync(`import "@/x.js";`, opts);
    assertEquals(result, `import "/_vf_modules/x.js?ssr=true&project=p&branch=b&v=v1";`);
  });

  it("rewrites relative dynamic import asynchronously", async () => {
    const result = await rewriteSSRImportsCompatAsync(`const m = import("../z.js");`, opts);
    assertEquals(result, `const m = import("../z.js?ssr=true&project=p&branch=b&v=v1");`);
  });
});

describe("ssr-adapter — bare import matcher edge cases", () => {
  const opts = { projectSlug: "p", branch: "b", cacheBuster: "v1" };

  it("rewrites a bare import with no whitespace after from (minified output)", () => {
    const result = rewriteSSRImportsCompat(`import x from"lodash";`, opts);
    assertEquals(
      result,
      `import x from "https://esm.sh/lodash?external=react&target=es2022";`,
    );
  });

  it("keeps mixed-case protocol URLs external", () => {
    const code = `import x from "HTTPS://example.com/mod.js";`;
    assertEquals(rewriteSSRImportsCompat(code, opts), code);
  });
});
