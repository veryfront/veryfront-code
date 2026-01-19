import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectHead,
  flushHeadCollector,
  hasCollectedHead,
  resetHeadCollector,
} from "./head-collector.ts";

describe("head-collector", () => {
  beforeEach(() => {
    resetHeadCollector();
  });

  describe("collectHead", () => {
    it("collects title", () => {
      collectHead({ title: "My Page" });
      const head = flushHeadCollector();
      assertEquals(head.title, "My Page");
    });

    it("collects description from direct field", () => {
      collectHead({ description: "Page description" });
      const head = flushHeadCollector();
      assertEquals(head.description, "Page description");
    });

    it("collects description from meta tag", () => {
      collectHead({
        metas: [{ name: "description", content: "Meta description" }],
      });
      const head = flushHeadCollector();
      assertEquals(head.description, "Meta description");
    });

    it("collects meta tags", () => {
      collectHead({
        metas: [
          { name: "author", content: "John Doe" },
          { property: "og:title", content: "OG Title" },
        ],
      });
      const head = flushHeadCollector();
      assertEquals(head.metas.length, 2);
      assertEquals(head.metas[0], { name: "author", content: "John Doe" });
      assertEquals(head.metas[1], { property: "og:title", content: "OG Title" });
    });

    it("collects link tags", () => {
      collectHead({
        links: [
          { rel: "stylesheet", href: "/style.css" },
          { rel: "icon", href: "/favicon.ico" },
        ],
      });
      const head = flushHeadCollector();
      assertEquals(head.links.length, 2);
      assertEquals(head.links[0], { rel: "stylesheet", href: "/style.css" });
    });

    it("collects style tags", () => {
      collectHead({ styles: [".foo { color: red; }"] });
      const head = flushHeadCollector();
      assertEquals(head.styles.length, 1);
      assertEquals(head.styles[0], ".foo { color: red; }");
    });

    it("accumulates multiple calls", () => {
      collectHead({ title: "Title" });
      collectHead({ metas: [{ name: "author", content: "Jane" }] });
      collectHead({ links: [{ rel: "stylesheet", href: "/a.css" }] });
      collectHead({ links: [{ rel: "stylesheet", href: "/b.css" }] });

      const head = flushHeadCollector();
      assertEquals(head.title, "Title");
      assertEquals(head.metas.length, 1);
      assertEquals(head.links.length, 2);
    });

    it("last title wins", () => {
      collectHead({ title: "First" });
      collectHead({ title: "Second" });
      const head = flushHeadCollector();
      assertEquals(head.title, "Second");
    });
  });

  describe("flushHeadCollector", () => {
    it("returns collected data and resets", () => {
      collectHead({ title: "Test" });
      const first = flushHeadCollector();
      const second = flushHeadCollector();

      assertEquals(first.title, "Test");
      assertEquals(second.title, undefined);
    });
  });

  describe("resetHeadCollector", () => {
    it("clears all collected data", () => {
      collectHead({ title: "Title", metas: [{ content: "x" }] });
      resetHeadCollector();
      const head = flushHeadCollector();

      assertEquals(head.title, undefined);
      assertEquals(head.metas.length, 0);
    });
  });

  describe("hasCollectedHead", () => {
    it("returns false when empty", () => {
      assertEquals(hasCollectedHead(), false);
    });

    it("returns true when title collected", () => {
      collectHead({ title: "T" });
      assertEquals(hasCollectedHead(), true);
    });

    it("returns true when description collected", () => {
      collectHead({ description: "D" });
      assertEquals(hasCollectedHead(), true);
    });

    it("returns true when metas collected", () => {
      collectHead({ metas: [{ content: "x" }] });
      assertEquals(hasCollectedHead(), true);
    });

    it("returns true when links collected", () => {
      collectHead({ links: [{ href: "/x" }] });
      assertEquals(hasCollectedHead(), true);
    });

    it("returns true when styles collected", () => {
      collectHead({ styles: [".x{}"] });
      assertEquals(hasCollectedHead(), true);
    });
  });
});
