import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectHead,
  hasCollectedHead,
  HEAD_COLLECTOR_SYMBOL,
  runWithHeadCollector,
} from "./head-collector.ts";

describe("head-collector", () => {
  describe("collectHead", () => {
    it("collects title", async () => {
      const { head } = await runWithHeadCollector(() => collectHead({ title: "My Page" }));
      assertEquals(head.title, "My Page");
    });

    it("collects description from direct field", async () => {
      const { head } = await runWithHeadCollector(() =>
        collectHead({ description: "Page description" })
      );
      assertEquals(head.description, "Page description");
    });

    it("collects description from meta tag", async () => {
      const { head } = await runWithHeadCollector(() =>
        collectHead({
          metas: [{ name: "description", content: "Meta description" }],
        })
      );
      assertEquals(head.description, "Meta description");
    });

    it("collects meta tags", async () => {
      const { head } = await runWithHeadCollector(() =>
        collectHead({
          metas: [
            { name: "author", content: "John Doe" },
            { property: "og:title", content: "OG Title" },
          ],
        })
      );

      assertEquals(head.metas.length, 2);
      assertEquals(head.metas[0], { name: "author", content: "John Doe" });
      assertEquals(head.metas[1], { property: "og:title", content: "OG Title" });
    });

    it("collects link tags", async () => {
      const { head } = await runWithHeadCollector(() =>
        collectHead({
          links: [
            { rel: "stylesheet", href: "/style.css" },
            { rel: "icon", href: "/favicon.ico" },
          ],
        })
      );

      assertEquals(head.links.length, 2);
      assertEquals(head.links[0], { rel: "stylesheet", href: "/style.css" });
    });

    it("collects style tags", async () => {
      const { head } = await runWithHeadCollector(() =>
        collectHead({ styles: [".foo { color: red; }"] })
      );

      assertEquals(head.styles.length, 1);
      assertEquals(head.styles[0], ".foo { color: red; }");
    });

    it("accumulates multiple calls", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ title: "Title" });
        collectHead({ metas: [{ name: "author", content: "Jane" }] });
        collectHead({ links: [{ rel: "stylesheet", href: "/a.css" }] });
        collectHead({ links: [{ rel: "stylesheet", href: "/b.css" }] });
      });

      assertEquals(head.title, "Title");
      assertEquals(head.metas.length, 1);
      assertEquals(head.links.length, 2);
    });

    it("last title wins", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ title: "First" });
        collectHead({ title: "Second" });
      });

      assertEquals(head.title, "Second");
    });
  });

  describe("single-valued key override (page over layout)", () => {
    it("overrides og:title, keeping only the later tag", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ metas: [{ property: "og:title", content: "Layout OG Title" }] });
        collectHead({ metas: [{ property: "og:title", content: "Page OG Title" }] });
      });

      assertEquals(head.metas.length, 1);
      assertEquals(head.metas[0], { property: "og:title", content: "Page OG Title" });
    });

    it("overrides a name-based singleton (robots)", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ metas: [{ name: "robots", content: "noindex" }] });
        collectHead({ metas: [{ name: "robots", content: "index,follow" }] });
      });

      assertEquals(head.metas.length, 1);
      assertEquals(head.metas[0], { name: "robots", content: "index,follow" });
    });

    it("overrides a canonical link, keeping only the later href", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ links: [{ rel: "canonical", href: "https://example.com/layout" }] });
        collectHead({ links: [{ rel: "canonical", href: "https://example.com/page" }] });
      });

      assertEquals(head.links.length, 1);
      assertEquals(head.links[0], { rel: "canonical", href: "https://example.com/page" });
    });
  });

  describe("repeatable tags accumulate", () => {
    it("keeps multiple og:image tags", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ metas: [{ property: "og:image", content: "https://example.com/a.jpg" }] });
        collectHead({ metas: [{ property: "og:image", content: "https://example.com/b.jpg" }] });
      });

      assertEquals(head.metas.length, 2);
    });

    it("keeps multiple preload links", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ links: [{ rel: "preload", href: "/a.woff2" }] });
        collectHead({ links: [{ rel: "preload", href: "/b.woff2" }] });
      });

      assertEquals(head.links.length, 2);
    });

    it("keeps unlisted meta keys (accumulate is the safe default)", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ metas: [{ property: "article:tag", content: "react" }] });
        collectHead({ metas: [{ property: "article:tag", content: "ssr" }] });
      });

      assertEquals(head.metas.length, 2);
    });
  });

  describe("runWithHeadCollector", () => {
    it("returns result and collected head", async () => {
      const { result, head } = await runWithHeadCollector(() => {
        collectHead({ title: "Test" });
        return "my-result";
      });

      assertEquals(result, "my-result");
      assertEquals(head.title, "Test");
    });

    it("isolates concurrent contexts", async () => {
      const [a, b] = await Promise.all([
        runWithHeadCollector(async () => {
          collectHead({ title: "A" });
          await new Promise((r) => setTimeout(r, 10));
          return "result-a";
        }),
        runWithHeadCollector(async () => {
          collectHead({ title: "B" });
          await new Promise((r) => setTimeout(r, 5));
          return "result-b";
        }),
      ]);

      assertEquals(a.head.title, "A");
      assertEquals(b.head.title, "B");
      assertEquals(a.result, "result-a");
      assertEquals(b.result, "result-b");
    });
  });

  describe("hasCollectedHead", () => {
    it("returns false when outside context", () => {
      assertEquals(hasCollectedHead(), false);
    });

    it("returns false when empty", async () => {
      await runWithHeadCollector(() => {
        assertEquals(hasCollectedHead(), false);
      });
    });

    it("returns true when title collected", async () => {
      await runWithHeadCollector(() => {
        collectHead({ title: "T" });
        assertEquals(hasCollectedHead(), true);
      });
    });

    it("returns true when description collected", async () => {
      await runWithHeadCollector(() => {
        collectHead({ description: "D" });
        assertEquals(hasCollectedHead(), true);
      });
    });

    it("returns true when metas collected", async () => {
      await runWithHeadCollector(() => {
        collectHead({ metas: [{ content: "x" }] });
        assertEquals(hasCollectedHead(), true);
      });
    });

    it("returns true when links collected", async () => {
      await runWithHeadCollector(() => {
        collectHead({ links: [{ href: "/x" }] });
        assertEquals(hasCollectedHead(), true);
      });
    });

    it("returns true when styles collected", async () => {
      await runWithHeadCollector(() => {
        collectHead({ styles: [".x{}"] });
        assertEquals(hasCollectedHead(), true);
      });
    });
  });

  describe("collectHead outside context", () => {
    it("silently ignores calls outside context", () => {
      collectHead({ title: "Orphan" });
    });
  });

  describe("global collector registration", () => {
    it("registers collectHead on the shared global symbol", () => {
      const globalCollector = (globalThis as typeof globalThis & {
        [HEAD_COLLECTOR_SYMBOL]?: typeof collectHead;
      })[HEAD_COLLECTOR_SYMBOL];

      assertEquals(globalCollector, collectHead);
    });

    it("keeps the first evaluated copy connected after a second copy loads", async () => {
      const contextOwner = await import(
        "./head-collector.ts?duplicate=context-owner-first"
      );
      const laterCopy = await import(
        "./head-collector.ts?duplicate=dispatcher-owner-second"
      );
      const globalCollector = (globalThis as typeof globalThis & {
        [HEAD_COLLECTOR_SYMBOL]?: typeof collectHead;
      })[HEAD_COLLECTOR_SYMBOL];

      assertEquals(contextOwner.collectHead, laterCopy.collectHead);
      assertEquals(globalCollector, contextOwner.collectHead);

      const { head } = await contextOwner.runWithHeadCollector(() => {
        globalCollector?.({ title: "first-copy-context" });
        laterCopy.collectHead({
          metas: [{ name: "author", content: "later-copy-dispatcher" }],
        });
      });

      assertEquals(head.title, "first-copy-context");
      assertEquals(head.metas, [
        { name: "author", content: "later-copy-dispatcher" },
      ]);
    });

    it("lets a later evaluated copy collect through the first copy", async () => {
      const dispatcherOwner = await import(
        "./head-collector.ts?duplicate=dispatcher-owner-first"
      );
      const laterContextOwner = await import(
        "./head-collector.ts?duplicate=context-owner-second"
      );

      assertEquals(dispatcherOwner.collectHead, laterContextOwner.collectHead);

      const { head } = await laterContextOwner.runWithHeadCollector(() => {
        dispatcherOwner.collectHead({
          title: "later-copy-context",
          links: [{ rel: "canonical", href: "https://example.com/shared" }],
        });
      });

      assertEquals(head.title, "later-copy-context");
      assertEquals(head.links, [
        { rel: "canonical", href: "https://example.com/shared" },
      ]);
    });

    it("isolates concurrent requests across evaluated copies", async () => {
      const firstCopy = await import(
        "./head-collector.ts?duplicate=concurrent-first"
      );
      const secondCopy = await import(
        "./head-collector.ts?duplicate=concurrent-second"
      );
      const firstStarted = Promise.withResolvers<void>();
      const secondCollected = Promise.withResolvers<void>();

      const firstRequest = firstCopy.runWithHeadCollector(async () => {
        secondCopy.collectHead({ title: "request-a" });
        firstStarted.resolve();
        await secondCollected.promise;
        firstCopy.collectHead({ styles: [".request-a {}"] });
        return "result-a";
      });

      const secondRequest = secondCopy.runWithHeadCollector(async () => {
        await firstStarted.promise;
        firstCopy.collectHead({ title: "request-b" });
        secondCollected.resolve();
        await Promise.resolve();
        secondCopy.collectHead({ styles: [".request-b {}"] });
        return "result-b";
      });

      const [first, second] = await Promise.all([
        firstRequest,
        secondRequest,
      ]);

      assertEquals(first.result, "result-a");
      assertEquals(first.head.title, "request-a");
      assertEquals(first.head.styles, [".request-a {}"]);
      assertEquals(second.result, "result-b");
      assertEquals(second.head.title, "request-b");
      assertEquals(second.head.styles, [".request-b {}"]);
    });
  });
});
