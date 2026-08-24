/**
 * `veryfront/ui` coverage gate - the guardrail that keeps every shipped UI
 * primitive fully documented and tested. For each component (one Storybook
 * story file per component under `storybook/stories/ui/`), this asserts it:
 *
 *   1. is **storied** - has `storybook/stories/ui/<Name>.stories.tsx`
 *      (bijection with the Overview grid is separately enforced by
 *      `scripts/storybook/storybook-workbench.test.ts`);
 *   2. is **documented in its component** - its story renders a `DocsPage`
 *      (props / variants / live examples live with the component, not in a
 *      separate hand-maintained doc);
 *   3. has an **Overview tile** - a `ui-<name>--docs` entry on the landing grid;
 *   4. has a **test** - some `*.test.tsx` under the `ui/` tree both declares
 *      cases (`it(`) and imports the component, either by name or from its own
 *      module (its behaviour/conformance test, or the shared
 *      `conformance.test.tsx` composition-contract suite). A bare mention in a
 *      comment or in unrelated prose does not count.
 *
 * A new primitive that skips any of these fails CI here - which is the point:
 * the docs and tests cannot silently fall behind the code again. Never satisfy
 * a gate by weakening it; add the missing story/DocsPage/test.
 *
 * @module react/components/ui/coverage.test
 */
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const STORIES_DIR = new URL("../../../../storybook/stories/ui/", import.meta.url).pathname;
const OVERVIEW = new URL("../../../../storybook/stories/Overview.stories.tsx", import.meta.url)
  .pathname;
const UI_DIR = new URL(".", import.meta.url).pathname;

/** Every component's story file name → its component name. */
function storyComponents(): string[] {
  const names: string[] = [];
  for (const entry of Deno.readDirSync(STORIES_DIR)) {
    if (entry.isFile && entry.name.endsWith(".stories.tsx")) {
      names.push(entry.name.replace(/\.stories\.tsx$/, ""));
    }
  }
  return names.sort();
}

/** Read a story file's source (for the DocsPage check). */
function storySource(name: string): string {
  return Deno.readTextFileSync(`${STORIES_DIR}${name}.stories.tsx`);
}

/** One `*.test.tsx` under the ui/ tree, kept whole so the gate can scan per file. */
interface TestFile {
  path: string;
  source: string;
}

/**
 * Collect every `*.test.tsx` under the ui/ tree EXCEPT this file - so "has a
 * test" means covered by some OTHER test, never by this manifest itself. Files
 * stay separate rather than concatenated: the gate below requires the import
 * and the `it(` to live in the SAME file, which a single blob cannot express.
 */
function collectTestSources(dir: string): TestFile[] {
  const out: TestFile[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory) {
      out.push(...collectTestSources(`${path}/`));
    } else if (
      entry.isFile && entry.name.endsWith(".test.tsx") && entry.name !== "coverage.test.tsx"
    ) {
      out.push({ path, source: Deno.readTextFileSync(path) });
    }
  }
  return out;
}

/** `ScrollArea` -> `scroll-area`, the module file the skin lives in. */
function moduleName(name: string): string {
  return name.replace(/(?<!^)(?=[A-Z])/g, "-").toLowerCase();
}

const COMPONENTS = storyComponents();
const OVERVIEW_SRC = Deno.readTextFileSync(OVERVIEW);
const UI_TEST_FILES = collectTestSources(UI_DIR);

describe("veryfront/ui coverage - to-spec gate", () => {
  it("has at least the full shipped primitive set storied", () => {
    // Guards against the stories dir vanishing (which would make every
    // per-component check pass vacuously).
    assert(
      COMPONENTS.length >= 50,
      `expected the full UI primitive set to be storied, found ${COMPONENTS.length}`,
    );
  });

  for (const name of COMPONENTS) {
    const id = `ui-${name.toLowerCase()}--docs`;

    it(`${name}: documents itself in a DocsPage`, () => {
      assert(
        storySource(name).includes("DocsPage"),
        `storybook/stories/ui/${name}.stories.tsx must render a <DocsPage> ` +
          `(docs live in the component, not a separate file)`,
      );
    });

    it(`${name}: has an Overview tile`, () => {
      assert(
        OVERVIEW_SRC.includes(`"${id}"`),
        `Overview.stories.tsx is missing the { id: "${id}" } tile for ${name}`,
      );
    });

    it(`${name}: has a test`, () => {
      // A bare `\bName\b` match would be satisfied by a comment or by an
      // unrelated component's prose (`Field`, `Label`, `Input`, `Status` are all
      // ordinary English). Require instead that ONE file both pulls the
      // component in - by name, or from its own module for suites that import
      // only its sub-parts - and declares cases.
      const importsByName = new RegExp(
        `import\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']\\.{1,2}/`,
      );
      const importsModule = new RegExp(
        `from\\s*["']\\.{1,2}/${moduleName(name)}\\.tsx["']`,
      );
      const covering = UI_TEST_FILES.find((file) =>
        file.source.includes("it(") &&
        (importsByName.test(file.source) || importsModule.test(file.source))
      );
      assert(
        covering !== undefined,
        `${name} is not exercised by any *.test.tsx under ui/ - add a behaviour ` +
          `test or reference it in conformance.test.tsx`,
      );
    });
  }
});
