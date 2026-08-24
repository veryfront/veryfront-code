import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectHead,
  getHeadCollectorContext,
  getHeadCollectorNonce,
  hasCollectedHead,
  HEAD_COLLECTOR_SYMBOL,
  runWithHeadCollector,
} from "./head-collector.ts";
import {
  descriptorFromHeadProps,
  serializeManagedHeadPayload,
} from "#veryfront/html/managed-head-protocol.ts";

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

    it("normalizes singleton values and distinguishes theme-color media", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({
          metas: [
            { name: "Viewport", content: "width=400" },
            { name: "theme-color", content: "white" },
            {
              name: "theme-color",
              content: "black",
              media: "(prefers-color-scheme: dark)",
            },
          ],
          links: [{ rel: "CANONICAL", href: "https://example.com/old" }],
        });
        collectHead({
          metas: [
            { name: "viewport", content: "width=900" },
            { name: "THEME-COLOR", content: "blue" },
          ],
          links: [{
            rel: "canonical",
            href: "https://example.com/current",
          }],
        });
      });

      assertEquals(head.metas, [
        { name: "viewport", content: "width=900" },
        { name: "THEME-COLOR", content: "blue" },
        {
          name: "theme-color",
          content: "black",
          media: "(prefers-color-scheme: dark)",
        },
      ]);
      assertEquals(head.links, [{
        rel: "canonical",
        href: "https://example.com/current",
      }]);
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

  describe("script identity aliases", () => {
    it("deduplicates when either id or src intersects", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({
          scripts: [{ id: "layout", src: "/shared.js" }],
        });
        collectHead({
          scripts: [{ id: "page", src: "/shared.js" }],
        });
        collectHead({
          scripts: [{ id: "layout", src: "/other.js" }],
        });
      });

      assertEquals(head.scripts, [{
        id: "layout",
        src: "/shared.js",
      }]);
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

    it("binds and isolates the response nonce without leaking it", async () => {
      assertEquals(getHeadCollectorNonce(), undefined);

      const firstStarted = Promise.withResolvers<void>();
      const secondRead = Promise.withResolvers<void>();
      const [first, second] = await Promise.all([
        runWithHeadCollector(
          async () => {
            firstStarted.resolve();
            await secondRead.promise;
            return getHeadCollectorNonce();
          },
          { nonce: "nonce-a" },
        ),
        runWithHeadCollector(
          async () => {
            await firstStarted.promise;
            const nonce = getHeadCollectorNonce();
            secondRead.resolve();
            return nonce;
          },
          { nonce: "nonce-b" },
        ),
      ]);

      assertEquals(first.result, "nonce-a");
      assertEquals(second.result, "nonce-b");
      assertEquals(getHeadCollectorNonce(), undefined);
    });

    it("does not re-count an identical payload against the request budgets", async () => {
      const payload = serializeManagedHeadPayload([
        descriptorFromHeadProps("title", { children: "same" })!,
      ]);
      const { result } = await runWithHeadCollector((renderContext) => {
        const tokens = new Set<string>();
        for (let index = 0; index < 200; index++) {
          tokens.add(renderContext.registerHeadPayload(payload));
        }
        return tokens;
      });
      assertEquals(
        result.size,
        1,
        "re-registering an identical payload must return the same token instead of minting a new one",
      );
    });

    it("mints distinct tokens for distinct payloads", async () => {
      const { result } = await runWithHeadCollector((renderContext) => {
        const tokenA = renderContext.registerHeadPayload(
          serializeManagedHeadPayload([descriptorFromHeadProps("title", { children: "a" })!]),
        );
        const tokenB = renderContext.registerHeadPayload(
          serializeManagedHeadPayload([descriptorFromHeadProps("title", { children: "b" })!]),
        );
        return { tokenA, tokenB };
      });
      assertNotEquals(
        result.tokenA,
        result.tokenB,
        "distinct payloads must not share a commit token",
      );
    });

    it("counts repeated singleton titles before aggregation", async () => {
      await assertRejects(
        () =>
          runWithHeadCollector((renderContext) => {
            for (let index = 0; index <= 128; index++) {
              renderContext.registerHeadPayload(
                serializeManagedHeadPayload([
                  descriptorFromHeadProps("title", { children: `title-${index}` })!,
                ]),
              );
            }
          }),
        TypeError,
        "128-entry request limit",
      );
    });

    it("counts repeated script identities before aggregation", async () => {
      const content = "x".repeat(750_000);
      await assertRejects(
        () =>
          runWithHeadCollector((renderContext) => {
            for (let index = 0; index < 3; index++) {
              renderContext.registerHeadPayload(
                serializeManagedHeadPayload([
                  descriptorFromHeadProps("script", {
                    id: "repeated-script",
                    children: `${content}${index}`,
                  })!,
                ]),
              );
            }
          }),
        TypeError,
        "2097152-byte request limit",
      );
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
    it("silently ignores calls outside context", async () => {
      const { head } = await runWithHeadCollector(() => collectHead({ title: "Prior" }));

      collectHead({ title: "Orphan", metas: [{ name: "x", content: "y" }] });

      assertEquals(
        getHeadCollectorContext(),
        null,
        "no collector context exists outside runWithHeadCollector",
      );
      assertEquals(hasCollectedHead(), false, "orphan collectHead must not create a context");
      assertEquals(
        head.title,
        "Prior",
        "orphan collectHead must not write into a completed request's head",
      );
      assertEquals(head.metas, [], "orphan metas must not leak into a prior request");
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
