import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectHead,
  hasCollectedHead,
  runWithHeadCollector,
} from "./head-collector.ts";

describe("head-collector", () => {
  describe("collectHead", () => {
    it("collects title", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ title: "My Page" });
      });
      assertEquals(head.title, "My Page");
    });

    it("collects description from direct field", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ description: "Page description" });
      });
      assertEquals(head.description, "Page description");
    });

    it("collects description from meta tag", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({
          metas: [{ name: "description", content: "Meta description" }],
        });
      });
      assertEquals(head.description, "Meta description");
    });

    it("collects meta tags", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({
          metas: [
            { name: "author", content: "John Doe" },
            { property: "og:title", content: "OG Title" },
          ],
        });
      });

      assertEquals(head.metas.length, 2);
      assertEquals(head.metas[0], { name: "author", content: "John Doe" });
      assertEquals(head.metas[1], { property: "og:title", content: "OG Title" });
    });

    it("collects link tags", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({
          links: [
            { rel: "stylesheet", href: "/style.css" },
            { rel: "icon", href: "/favicon.ico" },
          ],
        });
      });

      assertEquals(head.links.length, 2);
      assertEquals(head.links[0], { rel: "stylesheet", href: "/style.css" });
    });

    it("collects style tags", async () => {
      const { head } = await runWithHeadCollector(() => {
        collectHead({ styles: [".foo { color: red; }"] });
      });

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
      // Should not throw
      collectHead({ title: "Orphan" });
      // No way to verify it was ignored, but no crash is success
    });
  });
});
