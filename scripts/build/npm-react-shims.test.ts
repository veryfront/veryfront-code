import { assertEquals, assertThrows } from "#std/assert";
import {
  assertNoBundledReactDomClientShim,
  normalizeEsmShReactNpmShims,
} from "./npm-react-shims.ts";

Deno.test("rejects an emitted local react-dom client shim", async () => {
  const root = await Deno.makeTempDir();
  try {
    assertNoBundledReactDomClientShim(root);

    await Deno.mkdir(`${root}/src/react`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/src/react/react-dom-client.js`,
      'export * from "@veryfront/react-dom-client-upstream";\n',
    );

    assertThrows(
      () => assertNoBundledReactDomClientShim(root),
      Error,
      "local react-dom/client shim",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("normalizeEsmShReactNpmShims rewrites React ecosystem esm.sh shims to npm package exports", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/react@19.2.4`);
    await Deno.mkdir(`${root}/react-dom@19.2.4`);
    await Deno.writeTextFile(
      `${root}/react@19.2.4.js`,
      'export * from "react/X-ZGNzc3R5cGVAMy4yLjM/es2022/react.mjs";\n',
    );
    await Deno.writeTextFile(
      `${root}/react@19.2.4/jsx-runtime.js`,
      'export * from "react/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/jsx-runtime.mjs";\n',
    );
    await Deno.writeTextFile(
      `${root}/react@19.2.4/jsx-dev-runtime.js`,
      'export * from "react/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/jsx-dev-runtime.development.mjs";\n',
    );
    await Deno.writeTextFile(
      `${root}/react-dom@19.2.4/client.js`,
      'import "react-dom/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/react-dom.mjs";\n',
    );
    await Deno.writeTextFile(
      `${root}/react-dom@19.2.4/server.js`,
      'export * from "react-dom/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/server.mjs";\n',
    );
    await Deno.writeTextFile(
      `${root}/scheduler@^0.27.0.js`,
      'export * from "scheduler/es2022/scheduler.mjs";\n',
    );

    assertEquals(normalizeEsmShReactNpmShims(root), 6);
    assertEquals(
      await Deno.readTextFile(`${root}/react@19.2.4.js`),
      '/* npm package shim for esm.sh react@19.2.4.js */\nexport * from "react";\nexport { default } from "react";\n',
    );
    assertEquals(
      await Deno.readTextFile(`${root}/react@19.2.4/jsx-runtime.js`),
      '/* npm package shim for esm.sh react@19.2.4/jsx-runtime.js */\nexport * from "react/jsx-runtime";\nexport { default } from "react/jsx-runtime";\n',
    );
    assertEquals(
      await Deno.readTextFile(`${root}/react@19.2.4/jsx-dev-runtime.js`),
      '/* npm package shim for esm.sh react@19.2.4/jsx-dev-runtime.js */\nexport * from "react/jsx-dev-runtime";\nexport { default } from "react/jsx-dev-runtime";\n',
    );
    assertEquals(
      await Deno.readTextFile(`${root}/react-dom@19.2.4/client.js`),
      '/* npm package shim for esm.sh react-dom@19.2.4/client.js */\nexport * from "react-dom/client";\nexport { default } from "react-dom/client";\n',
    );
    assertEquals(
      await Deno.readTextFile(`${root}/react-dom@19.2.4/server.js`),
      '/* npm package shim for esm.sh react-dom@19.2.4/server.js */\nexport * from "react-dom/server";\nexport { default } from "react-dom/server";\n',
    );
    assertEquals(
      await Deno.readTextFile(`${root}/scheduler@^0.27.0.js`),
      '/* npm package shim for esm.sh scheduler@^0.27.0.js */\nexport * from "scheduler";\nexport { default } from "scheduler";\n',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("normalizeEsmShReactNpmShims rewrites React ecosystem esm.sh declaration shims to npm package exports", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/react@19.2.4`);
    await Deno.mkdir(`${root}/react-dom@19.2.4`);
    await Deno.writeTextFile(`${root}/react@19.2.4.d.ts`, "export {};\n");
    await Deno.writeTextFile(
      `${root}/react@19.2.4/jsx-runtime.d.ts`,
      "export {};\n",
    );
    await Deno.writeTextFile(
      `${root}/react-dom@19.2.4/client.d.ts`,
      "export {};\n",
    );

    assertEquals(normalizeEsmShReactNpmShims(root), 3);
    assertEquals(
      await Deno.readTextFile(`${root}/react@19.2.4.d.ts`),
      '/* npm package shim for esm.sh react@19.2.4.d.ts */\nexport * from "react";\nexport { default } from "react";\n',
    );
    assertEquals(
      await Deno.readTextFile(`${root}/react@19.2.4/jsx-runtime.d.ts`),
      '/* npm package shim for esm.sh react@19.2.4/jsx-runtime.d.ts */\nexport * from "react/jsx-runtime";\nexport { default } from "react/jsx-runtime";\n',
    );
    assertEquals(
      await Deno.readTextFile(`${root}/react-dom@19.2.4/client.d.ts`),
      '/* npm package shim for esm.sh react-dom@19.2.4/client.d.ts */\nexport * from "react-dom/client";\nexport { default } from "react-dom/client";\n',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("normalizeEsmShReactNpmShims rejects unhandled React internal imports", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/unhandled`);
    await Deno.writeTextFile(
      `${root}/unhandled/entry.js`,
      'export * from "react-dom/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/unknown.mjs";\n',
    );

    assertThrows(
      () => normalizeEsmShReactNpmShims(root),
      Error,
      "esm.sh React internals",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("normalizeEsmShReactNpmShims rejects unhandled React internal declaration imports", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/unhandled`);
    await Deno.writeTextFile(
      `${root}/unhandled/entry.d.ts`,
      'export * from "react-dom/X-ZGNzc3R5cGVAMy4yLjMKZXJlYWN0/es2022/unknown.d.ts";\n',
    );

    assertThrows(
      () => normalizeEsmShReactNpmShims(root),
      Error,
      "esm.sh React internals",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
