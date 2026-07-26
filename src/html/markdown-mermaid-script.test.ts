import "#veryfront/schemas/_test-setup.ts";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildMarkdownMermaidScript } from "./markdown-mermaid-script.ts";

interface MermaidRunOptions {
  nodes: ArrayLike<HTMLElement>;
}

interface MermaidMock {
  initialize(config: Record<string, unknown>): void;
  run(options: MermaidRunOptions): Promise<void>;
}

const testGlobals = globalThis as typeof globalThis & {
  __veryfrontMermaidTestMock?: MermaidMock;
};
let moduleSequence = 0;

function installDom(markup: string): {
  dom: JSDOM;
  restore(): void;
} {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`);
  const previousDocument = globalThis.document;
  const previousMutationObserver = globalThis.MutationObserver;

  Object.assign(globalThis, {
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
  });

  return {
    dom,
    restore() {
      Object.assign(globalThis, {
        document: previousDocument,
        MutationObserver: previousMutationObserver,
      });
      delete testGlobals.__veryfrontMermaidTestMock;
      dom.window.close();
    },
  };
}

async function executeGeneratedScript(mock: MermaidMock): Promise<void> {
  testGlobals.__veryfrontMermaidTestMock = mock;
  const script = buildMarkdownMermaidScript();
  const bodyStart = script.indexOf("\n") + 1;
  const bodyEnd = script.lastIndexOf("\n</script>");
  assert(bodyStart > 0 && bodyEnd > bodyStart);

  const body = script
    .slice(bodyStart, bodyEnd)
    .replace(
      /^import mermaid from '[^']+';$/m,
      "const mermaid = globalThis.__veryfrontMermaidTestMock;",
    );
  assert(!body.includes("import mermaid from"));

  const moduleSource = `${body}\n// test-module-${moduleSequence++}`;
  await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`);
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for generated Mermaid script");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("buildMarkdownMermaidScript", () => {
  it("serializes initial and theme renders under strict security", async () => {
    const { dom, restore } = installDom(
      '<pre><code class="language-mermaid">flowchart LR\nA --&gt; B</code></pre>',
    );
    const configs: Array<Record<string, unknown>> = [];
    const releases: Array<() => void> = [];
    let runCalls = 0;
    let activeRuns = 0;
    let maxActiveRuns = 0;

    try {
      await executeGeneratedScript({
        initialize(config) {
          configs.push(config);
        },
        async run({ nodes }) {
          runCalls++;
          activeRuns++;
          maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
          await new Promise<void>((resolve) => releases.push(resolve));
          nodes[0]!.textContent = `rendered-${runCalls}`;
          activeRuns--;
        },
      });

      await waitFor(() => runCalls === 1);
      dom.window.document.documentElement.dataset.theme = "dark";
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(runCalls, 1);

      releases.shift()!();
      await waitFor(() => runCalls === 2);
      releases.shift()!();
      await waitFor(() => activeRuns === 0);

      assertEquals(maxActiveRuns, 1);
      assertEquals(configs.map((config) => config.securityLevel), [
        "strict",
        "strict",
      ]);
      assertEquals(configs.map((config) => config.theme), [
        "default",
        "dark",
      ]);
      assertEquals(
        dom.window.document.querySelector("pre.mermaid")?.textContent,
        "rendered-2",
      );
    } finally {
      restore();
    }
  });

  it("restores readable diagram source when rendering mutates then fails", async () => {
    const source = "flowchart LR\nA --> B";
    const { dom, restore } = installDom(
      `<pre><code class="language-mermaid">${source}</code></pre>`,
    );
    const originalConsoleError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      await executeGeneratedScript({
        initialize() {},
        async run({ nodes }) {
          nodes[0]!.textContent = "partially rendered";
          throw new Error("invalid diagram");
        },
      });

      await waitFor(() => errors.length === 1);
      const diagram = dom.window.document.querySelector(
        "pre.mermaid",
      ) as HTMLElement | null;
      assert(diagram);
      assertEquals(diagram.textContent, source);
      assertEquals(diagram.hasAttribute("data-processed"), false);
      assertEquals(diagram.style.visibility, "");
      assertEquals(
        errors[0]?.[0],
        "[Veryfront] Mermaid rendering failed; showing source.",
      );
    } finally {
      console.error = originalConsoleError;
      restore();
    }
  });
});
