/**
 * Source-level contract for repository-internal platform barrels.
 *
 * `veryfront/platform` is intentionally available through the repository
 * import map for framework and CLI code, but is not a published package
 * subpath. Package privacy is pinned separately in the npm metadata tests.
 */
import { assertEquals } from "#veryfront/testing/assert.ts";
import type {
  ContextualFSAdapter,
  StyleConfigBinding,
  StylePregenerationContext,
} from "veryfront/platform";
import type {
  ContextualFSAdapter as AdapterContextualFSAdapter,
  StyleConfigBinding as AdapterStyleConfigBinding,
  StylePregenerationContext as AdapterStylePregenerationContext,
} from "./adapters/index.ts";
import type {
  ContextualFSAdapter as FileSystemContextualFSAdapter,
  StyleConfigBinding as FileSystemStyleConfigBinding,
  StylePregenerationContext as FileSystemStylePregenerationContext,
} from "./adapters/fs/index.ts";
import type {
  ContextualFSAdapter as VeryfrontContextualFSAdapter,
  StyleConfigBinding as VeryfrontStyleConfigBinding,
  StylePregenerationContext as VeryfrontStylePregenerationContext,
} from "./adapters/fs/veryfront/index.ts";

const binding: StyleConfigBinding = Object.freeze({
  projectSlug: "internal-contract-project",
  sourceKey: "branch:main",
  sourceRevision: 1,
});

const context: StylePregenerationContext = {
  projectSlug: "internal-contract-project",
  projectDir: "/internal-contract-project",
  contentContext: {
    sourceType: "branch",
    projectSlug: "internal-contract-project",
    branch: "main",
  },
};

const internalAdapter = {
  readFile: () => Promise.resolve(""),
  exists: () => Promise.resolve(true),
  stat: () =>
    Promise.resolve({
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      size: 0,
      mtime: null,
    }),
  createStyleConfigBinding: () => binding,
  installStyleConfig: (
    receivedBinding: StyleConfigBinding,
    _config: Readonly<object>,
  ) => Promise.resolve(receivedBinding === binding),
} satisfies ContextualFSAdapter;

Deno.test("internal platform barrels expose hosted style adapter contracts", async () => {
  const adapterBarrel: AdapterContextualFSAdapter = internalAdapter;
  const fileSystemBarrel: FileSystemContextualFSAdapter = adapterBarrel;
  const veryfrontBarrel: VeryfrontContextualFSAdapter = fileSystemBarrel;
  const adapterBinding: AdapterStyleConfigBinding = binding;
  const fileSystemBinding: FileSystemStyleConfigBinding = adapterBinding;
  const veryfrontBinding: VeryfrontStyleConfigBinding = fileSystemBinding;
  const adapterContext: AdapterStylePregenerationContext = context;
  const fileSystemContext: FileSystemStylePregenerationContext = adapterContext;
  const veryfrontContext: VeryfrontStylePregenerationContext = fileSystemContext;

  assertEquals(await veryfrontBarrel.createStyleConfigBinding?.(), veryfrontBinding);
  assertEquals(veryfrontContext.contentContext?.branch, "main");
});
