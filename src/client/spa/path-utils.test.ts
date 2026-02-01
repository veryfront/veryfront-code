import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { pathToModuleUrl } from "./path-utils.ts";

describe("client/spa/path-utils", () => {
  describe("pathToModuleUrl", () => {
    const cases: Array<[string, string, string]> = [
      ["pages/index.tsx", "/_vf_modules", "/_vf_modules/pages/index.js"],
      ["components/Button.tsx", "/_vf_modules", "/_vf_modules/components/Button.js"],
      ["app/layout.tsx", "/_vf_modules", "/_vf_modules/app/layout.js"],
      ["lib/utils.ts", "/_vf_modules", "/_vf_modules/lib/utils.js"],
      ["layouts/main.tsx", "/_vf_modules", "/_vf_modules/layouts/main.js"],
      ["components/Card.jsx", "/_vf_modules", "/_vf_modules/components/Card.js"],
      ["pages/about.mdx", "/_vf_modules", "/_vf_modules/pages/about.js"],
      ["utils/helper.ts", "/_vf_modules", "/_vf_modules/utils/helper.js"],
      ["some/module", "/_vf_modules", "/_vf_modules/some/module.js"],
      ["utils/helper.js", "/_vf_modules", "/_vf_modules/utils/helper.js"],
      ["/project/pages/index.tsx", "/_vf_modules", "/_vf_modules/pages/index.js"],
      ["pages/home.tsx", "/custom", "/custom/pages/home.js"],
    ];

    for (const [input, baseUrl, expected] of cases) {
      it(`should convert ${input} with base ${baseUrl}`, () => {
        assertEquals(pathToModuleUrl(input, baseUrl), expected);
      });
    }
  });
});
