import "../../../_helpers/contract-init.ts";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import {
  generateAppModule,
  generateImportMap,
} from "../../../../src/build/production-build/index.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";
import { VERSION } from "../../../../src/utils/version.ts";

describe(
  "Client Runtime Generation",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    describe("generateAppModule()", () => {
      it("should generate valid JavaScript code", () => {
        const code = generateAppModule();

        assert(typeof code === "string");
        assert(code.length > 0);
      });

      it("should include Veryfront version", () => {
        const code = generateAppModule();

        assertStringIncludes(code, `version = ${JSON.stringify(VERSION)}`);
      });

      it("should initialize window.__veryfront object", () => {
        const code = generateAppModule();

        assertStringIncludes(code, "window.__veryfront = window.__veryfront || {}");
        assertStringIncludes(code, "window.__veryfront.version = version");
        assertStringIncludes(code, "window.__veryfront.initialized = true");
      });

      it("should define hydrate function", () => {
        const code = generateAppModule();

        assertStringIncludes(code, "export const hydrate = async function");
        assertStringIncludes(code, "slug, options = {}");
      });

      it("should export named exports", () => {
        const code = generateAppModule();

        assertStringIncludes(code, "export const version");
        assertStringIncludes(code, "export const hydrate");
      });

      it("should not ship a duplicate logging runtime", () => {
        const code = generateAppModule();

        assert(!code.includes("console."));
      });

      it("should delegate hydration to the canonical client runtime", () => {
        const code = generateAppModule();

        assertStringIncludes(code, 'import { boot } from "./client.js"');
        assert(!code.includes("data-hydrated"));
      });

      it("should check for window object", () => {
        const code = generateAppModule();

        assertStringIncludes(code, 'typeof window !== "undefined"');
      });

      it("should not be wrapped in a duplicate IIFE runtime", () => {
        const code = generateAppModule();

        assert(!code.includes("(() => {"));
      });

      it("should handle hydration with slug parameter", () => {
        const code = generateAppModule();

        assertStringIncludes(code, "slug");
      });
    });

    describe("generateImportMap()", () => {
      it("should generate valid import map HTML", async () => {
        const html = await generateImportMap();

        assert(typeof html === "string");
        assert(html.length > 0);
      });

      it("should include script tag with importmap type", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, '<script type="importmap">');
        assertStringIncludes(html, "</script>");
      });

      it("should include React imports", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, '"react":');
        assertStringIncludes(html, "esm.sh/react@");
      });

      it("should include React DOM imports", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, '"react-dom":');
        assertStringIncludes(html, "esm.sh/react-dom@");
      });

      it("should include React DOM client import", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, '"react-dom/client":');
        assertStringIncludes(html, "/client");
      });

      it("should include JSX runtime imports", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, '"react/jsx-runtime":');
        assertStringIncludes(html, "/jsx-runtime");
      });

      it("should include JSX dev runtime imports", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, '"react/jsx-dev-runtime":');
        assertStringIncludes(html, "/jsx-dev-runtime");
      });

      it("should use React 19.2.4", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, "react@19.2.4");
        assertStringIncludes(html, "react-dom@19.2.4");
      });

      it("should have valid JSON structure", async () => {
        const html = await generateImportMap();

        const jsonMatch = html.match(/\{[\s\S]*\}/);
        assert(jsonMatch !== null);

        const jsonStr = jsonMatch[0];
        assert(() => JSON.parse(jsonStr));
      });

      it("should include imports object", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, '"imports": {');
      });

      it("should use esm.sh CDN", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, "https://esm.sh/");
      });

      it("should include comment", async () => {
        const html = await generateImportMap();

        assertStringIncludes(html, "<!-- Import map for React dependencies -->");
      });
    });

    describe("Integration scenarios", () => {
      it("should generate compatible app module and import map", async () => {
        const appCode = generateAppModule();
        const importMap = await generateImportMap();

        assert(appCode.includes("window.__veryfront"));
        assert(importMap.includes("react"));

        assertStringIncludes(appCode, "hydrate");
        assertStringIncludes(importMap, "react/jsx-runtime");
      });

      it("should use canonical dependency and runtime versions", async () => {
        const importMap = await generateImportMap();
        const appCode = generateAppModule();

        assert(importMap.includes("19.2.4"));
        assertStringIncludes(appCode, `version = ${JSON.stringify(VERSION)}`);
      });
    });
  },
);
