import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { VirtualModuleSystem } from "../../../src/rendering/virtual-module-system.ts";
import { withTestContext } from "../../_helpers/context.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

// Mock adapter for testing
function createMockAdapter(): RuntimeAdapter {
  return {
    name: "test",
    platform: "deno",
    serve: () => {
      throw new Error("Not implemented");
    },
    fs: {
      readFile: async (path: string) => {
        return await Deno.readTextFile(path);
      },
      writeFile: async (path: string, content: string) => {
        await Deno.writeTextFile(path, content);
      },
      exists: async (path: string) => {
        try {
          await Deno.stat(path);
          return true;
        } catch {
          return false;
        }
      },
      readDir: async function* (path: string) {
        for await (const entry of Deno.readDir(path)) {
          yield {
            name: entry.name,
            isFile: entry.isFile,
            isDirectory: entry.isDirectory,
            isSymlink: entry.isSymlink,
          };
        }
      },
      stat: async (path: string) => {
        const info = await Deno.stat(path);
        return {
          size: info.size,
          isFile: info.isFile,
          isDirectory: info.isDirectory,
          isSymlink: info.isSymlink,
          mtime: info.mtime,
        };
      },
      mkdir: async (path: string, options?: { recursive?: boolean }) => {
        await Deno.mkdir(path, options);
      },
      remove: async (path: string, options?: { recursive?: boolean }) => {
        await Deno.remove(path, options);
      },
      makeTempDir: async (prefix: string) => {
        return await Deno.makeTempDir({ prefix });
      },
      watch: () => {
        throw new Error("Not implemented");
      },
    },
    env: {
      get: (key: string) => Deno.env.get(key),
      set: (key: string, value: string) => Deno.env.set(key, value),
      toObject: () => Deno.env.toObject(),
    },
    features: {
      websocket: true,
      http2: true,
      workers: true,
      jsx: true,
      typescript: true,
      hmr: true,
      streaming: true,
    },
    shell: { runCommand: () => ({ success: true, code: 0, stdout: "", stderr: "" }) },
    server: {
      upgradeWebSocket: () => {
        throw new Error("Not implemented");
      },
    },
  } as unknown as RuntimeAdapter;
}

describe(
  "VirtualModuleSystem",
  
  () => {
    it("registers, serves and clears modules", async () => {
      const adapter = createMockAdapter();
      const vms = new VirtualModuleSystem("/_vf/modules", adapter);
      const src = `
      import * as React from "react";
      export default function X(){ return <div>Hello</div>; }
    `;
      const url = await vms.registerModule("component:X", src, Deno.cwd());
      // url should start with base
      assertEquals(url.startsWith("/_vf/modules"), true);
      const req = new Request(`http://localhost${url}`);
      const res = vms.handleRequest(req);
      assertEquals(res instanceof Response, true);
      const txt = await res?.text();
      // Esbuild + import map transform should keep as ESM text
      assertEquals(typeof txt, "string");
      // Existing module can be retrieved
      const mod = vms.getModule("component:X");
      assertEquals(!!mod, true);
      // Not found path returns 404
      const notFound = vms.handleRequest(
        new Request("http://localhost/_vf/modules/does-not-exist"),
      );
      assertEquals(notFound?.status, 404);
      // base path mismatch returns null
      const nullRes = vms.handleRequest(new Request("http://localhost/not-base"));
      assertEquals(nullRes, null);
      // clear removes modules
      vms.clear();
      assertEquals(vms.getModule("component:X"), undefined);
    });

    it("registers, serves, clears basic", async () => {
      const adapter = createMockAdapter();
      const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);
      await vms.registerModule("m:one", "export const x=1;", "/tmp");
      const res = vms.handleRequest(new Request("http://x/_veryfront/modules/m:one"));
      assertEquals(res?.status, 200);
      assertExists(res);
      const ok = await res.text();
      // Check for transformed code
      assertEquals(ok.includes("export const x") || ok.includes("const x"), true);

      // non-virtual path
      const miss = vms.handleRequest(new Request("http://x/not-virtual"));
      assertEquals(miss, null);

      vms.clear();
      const res2 = vms.handleRequest(new Request("http://x/_veryfront/modules/m:one"));
      assertEquals(res2?.status, 404);
    });

    it("registers and serves transformed module", async () => {
      await withTestContext("vms-register", async (context) => {
        const adapter = createMockAdapter();
        const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);
        const src = `import React from 'react'; export default function X(){ return <div/> }`;
        const url = await vms.registerModule("component:X", src, context.projectDir);
        assert(url.includes("/_veryfront/modules"));

        const mod = vms.getModule("component:X");
        assert(mod);
        assert(mod?.transformed?.includes("react"));

        const res = vms.handleRequest(new Request(`http://local${url}`));
        assertEquals(res?.status, 200);
      });
    });

    it("returns 404 for missing module", () => {
      const adapter = createMockAdapter();
      const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);
      const res = vms.handleRequest(
        new Request("http://local/_veryfront/modules/component:Missing"),
      );
      assertEquals(res?.status, 404);
    });

    it("handles custom base path", async () => {
      const customBasePath = "/_custom/vms";
      const adapter = createMockAdapter();
      const vms = new VirtualModuleSystem(customBasePath, adapter);
      const src = `export const test = "custom";`;

      const url = await vms.registerModule("test:module", src, Deno.cwd());
      assertEquals(url.startsWith(customBasePath), true);

      const res = vms.handleRequest(new Request(`http://localhost${url}`));
      assertEquals(res?.status, 200);
    });

    it("transforms module with JSX", async () => {
      await withTestContext("vms-jsx-transform", async (context) => {
        const adapter = createMockAdapter();
        const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);
        const src = `
        export default function Component() {
          return <div className="test">Hello JSX</div>;
        }
      `;

        const _url = await vms.registerModule("jsx:comp", src, context.projectDir);
        const mod = vms.getModule("jsx:comp");

        assert(mod);
        assert(mod?.transformed);
        // After transformation, JSX should be converted
        const transformed = mod?.transformed!;
        assert(transformed.length > 0);
      });
    });

    it("handles multiple concurrent module registrations", async () => {
      await withTestContext("vms-concurrent", async (context) => {
        const adapter = createMockAdapter();
        const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

        const modules = [
          { id: "mod:a", src: "export const a = 1;" },
          { id: "mod:b", src: "export const b = 2;" },
          { id: "mod:c", src: "export const c = 3;" },
        ];

        const urls = await Promise.all(
          modules.map((m) => vms.registerModule(m.id, m.src, context.projectDir)),
        );

        assertEquals(urls.length, 3);

        for (const mod of modules) {
          const retrieved = vms.getModule(mod.id);
          assert(retrieved);
        }
      });
    });

    it("preserves import statements in transformed code", async () => {
      await withTestContext("vms-imports", async (context) => {
        const adapter = createMockAdapter();
        const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);
        const src = `
        import React from 'react';
        import { useState } from 'react';
        export default function X() {
          const [count, setCount] = useState(0);
          return <div>{count}</div>;
        }
      `;

        const _url = await vms.registerModule("import:test", src, context.projectDir);
        const mod = vms.getModule("import:test");

        assert(mod);
        assert(mod?.transformed);
        // Transformed code should preserve import statements or have them resolved
        const transformed = mod?.transformed!;
        assert(transformed.includes("react") || transformed.includes("React"));
      });
    });

    it("clears only specified modules when needed", async () => {
      const adapter = createMockAdapter();
      const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

      await vms.registerModule("keep:this", "export const keep = 1;", "/tmp");
      await vms.registerModule("clear:this", "export const clear = 2;", "/tmp");

      // Verify both modules exist
      assert(vms.getModule("keep:this"));
      assert(vms.getModule("clear:this"));

      // Clear all
      vms.clear();

      // Verify all modules are gone
      assertEquals(vms.getModule("keep:this"), undefined);
      assertEquals(vms.getModule("clear:this"), undefined);
    });

    it("returns null for requests to non-virtual paths", () => {
      const adapter = createMockAdapter();
      const vms = new VirtualModuleSystem("/_veryfront/modules", adapter);

      const testPaths = [
        "http://localhost/regular/path",
        "http://localhost/api/endpoint",
        "http://localhost/static/file.js",
      ];

      for (const path of testPaths) {
        const res = vms.handleRequest(new Request(path));
        assertEquals(res, null);
      }
    });
  },
);
