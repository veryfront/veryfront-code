import { JSDOM } from "npm:jsdom@28.0.0";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { flamegraph } from "../../../scripts/perf/report.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";

const html = await Deno.readTextFile(Deno.args[0]!);
const dom = new JSDOM(html, { runScripts: "outside-only" });
const restoreDom = installComponentDom(dom);
try {
  dom.window.document.querySelector("svg")!.outerHTML = flamegraph({
    startTime: 0,
    endTime: 102000,
    nodes: [1, 2, 3].map((id) => ({
      id,
      callFrame: {
        functionName: `frame${id}`,
        url: "",
        lineNumber: 0,
        columnNumber: 0,
        scriptId: "1",
      },
      children: id < 3 ? [id + 1] : [],
    })),
    samples: [1, 2, 3],
    timeDeltas: [100000, 1000, 1000],
  });
  dom.window.eval(dom.window.document.querySelector("script")!.textContent!);
  const svg = dom.window.document.querySelector("svg")!;
  const frames = svg.querySelectorAll("g");
  const original = svg.getAttribute("viewBox");
  frames[1]!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const box = svg.getAttribute("viewBox")!.split(" ").map(Number);
  const descendant = frames[2]!.querySelector("rect")!;
  assertEquals(
    Number(descendant.getAttribute("y")) + Number(descendant.getAttribute("height")) <=
      box[1]! + box[3]!,
    true,
  );
  assertEquals(frames[2]!.style.display === "none", false);
  assertEquals(frames[2]!.querySelector("text")!.textContent, "frame3");
  dom.window.document.querySelector<HTMLButtonElement>("button.reset")!.click();
  assertEquals(svg.getAttribute("viewBox"), original);
  frames[1]!.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  assertEquals(svg.getAttribute("viewBox") === original, false);
  dom.window.document.querySelector<HTMLButtonElement>("button.reset")!.click();
  assertEquals(svg.getAttribute("viewBox"), original);
} finally {
  restoreDom();
  dom.window.close();
}
