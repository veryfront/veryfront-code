import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  _writeAndImportTransformedModuleForTest,
  buildTransformedModuleSpecifier,
} from "./component-loader.ts";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("modules/react-loader/component-loader specifier", () => {
  it("reuses one specifier for unchanged transform output", () => {
    const path = "/cache/proj-1a2b/components/Widget.js";
    assertEquals(
      buildTransformedModuleSpecifier(path, "hash-aaa"),
      buildTransformedModuleSpecifier(path, "hash-aaa"),
    );
  });

  it("varies the specifier when transform output changes so dev reloads pick it up", () => {
    const path = "/cache/proj-1a2b/components/Widget.js";
    assertEquals(
      buildTransformedModuleSpecifier(path, "hash-aaa") ===
        buildTransformedModuleSpecifier(path, "hash-bbb"),
      false,
    );
  });

  it("percent-encodes a path containing spaces", () => {
    const specifier = buildTransformedModuleSpecifier(
      "/cache/proj/my components/Wid get.js",
      "hash-aaa",
    );
    assertEquals(
      decodeURIComponent(new URL(specifier).pathname),
      "/cache/proj/my components/Wid get.js",
    );
  });

  it("keeps a '#' in the path out of the URL fragment", () => {
    const specifier = buildTransformedModuleSpecifier("/cache/proj/note#1/App.js", "hash-aaa");
    const url = new URL(specifier);

    assertEquals(decodeURIComponent(url.pathname), "/cache/proj/note#1/App.js");
    assertEquals(url.hash, "");
  });

  it("keeps a '?' in the path out of the query string", () => {
    const specifier = buildTransformedModuleSpecifier("/cache/proj/a?b/App.js", "hash-aaa");
    const url = new URL(specifier);

    assertEquals(decodeURIComponent(url.pathname), "/cache/proj/a?b/App.js");
    assertEquals(url.searchParams.get("v"), "hash-aaa");
  });

  it("keeps each same-path write paired with its import under concurrent loads", async () => {
    const firstImportEntered = deferred();
    const releaseFirstImport = deferred();
    const events: string[] = [];
    const writer = {
      writeTextFile(_path: string, code: string): Promise<void> {
        events.push(`write:${code}`);
        return Promise.resolve();
      },
    };
    const importer = async (specifier: string): Promise<Record<string, unknown>> => {
      const version = new URL(specifier).searchParams.get("v") ?? "missing";
      events.push(`import-start:${version}`);
      if (version === "hash-a") {
        firstImportEntered.resolve();
        await releaseFirstImport.promise;
      }
      events.push(`import-end:${version}`);
      return { version };
    };

    const first = _writeAndImportTransformedModuleForTest(
      "/cache/project/Component.js",
      "code-a",
      "hash-a",
      writer,
      importer,
    );
    await firstImportEntered.promise;
    const second = _writeAndImportTransformedModuleForTest(
      "/cache/project/Component.js",
      "code-b",
      "hash-b",
      writer,
      importer,
    );

    await Promise.resolve();
    releaseFirstImport.resolve();
    await Promise.all([first, second]);

    assertEquals(events, [
      "write:code-a",
      "import-start:hash-a",
      "import-end:hash-a",
      "write:code-b",
      "import-start:hash-b",
      "import-end:hash-b",
    ]);
  });

  it("releases a same-path waiter after an import failure", async () => {
    let importCount = 0;
    const writer = {
      writeTextFile(): Promise<void> {
        return Promise.resolve();
      },
    };
    const importer = (): Promise<Record<string, unknown>> => {
      importCount += 1;
      return importCount === 1
        ? Promise.reject(new Error("synthetic import failure"))
        : Promise.resolve({ ok: true });
    };

    await assertRejects(
      () =>
        _writeAndImportTransformedModuleForTest(
          "/cache/project/Component.js",
          "broken",
          "hash-broken",
          writer,
          importer,
        ),
      Error,
      "synthetic import failure",
    );
    assertEquals(
      await _writeAndImportTransformedModuleForTest(
        "/cache/project/Component.js",
        "fixed",
        "hash-fixed",
        writer,
        importer,
      ),
      { ok: true },
    );
  });
});
