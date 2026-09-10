import { JSDOM } from "npm:jsdom@28.0.0";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { flamegraph } from "../../../scripts/perf/report.ts";
import { assertEquals, assertLess } from "#veryfront/testing/assert.ts";

const html = await Deno.readTextFile(Deno.args[0]!);
const dom = new JSDOM(html, { runScripts: "outside-only" });
const restoreDom = installComponentDom(dom);
try {
  dom.window.document.querySelector("svg")!.outerHTML = flamegraph({
    startTime: 0,
    endTime: 10000000,
    nodes: [1, 2, 3, 4].map((id) => ({
      id,
      callFrame: {
        functionName: `frame${id}`,
        url: "",
        lineNumber: 0,
        columnNumber: 0,
        scriptId: "1",
      },
      children: id === 1 ? [2, 4] : id === 2 ? [3] : [],
    })),
    samples: [1, 2, 3, 4],
    timeDeltas: [8990000, 9000, 1000, 1000000],
  });
  dom.window.eval(dom.window.document.querySelector("script")!.textContent!);
  const svg = dom.window.document.querySelector("svg")!;
  const frames = svg.querySelectorAll("g");
  assertEquals(
    frames.length,
    4,
    "Every sampled frame must remain available for zoom",
  );
  const original = svg.getAttribute("viewBox");
  frames[1]!.dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true }),
  );
  const box = svg.getAttribute("viewBox")!.split(" ").map(Number);
  const descendant = frames[2]!.querySelector("rect")!;
  assertEquals(
    Number(descendant.getAttribute("y")) +
        Number(descendant.getAttribute("height")) <=
      box[1]! + box[3]!,
    true,
  );
  assertEquals(frames[2]!.style.display === "none", false);
  assertEquals(frames[2]!.querySelector("text")!.textContent, "frame3");
  assertLess(Math.abs(Number(descendant.getAttribute("width")) - 120), 1e-9);
  assertEquals(frames[3]!.style.display, "none");
  dom.window.document.querySelector<HTMLButtonElement>("button.reset")!.click();
  assertEquals(svg.getAttribute("viewBox"), original);
  for (const frame of frames) {
    const [x, y, width] = frame.dataset.box!.split(" ").map(Number);
    const rect = frame.querySelector("rect")!;
    assertEquals(frame.style.display, "");
    assertLess(Math.abs(Number(rect.getAttribute("x")) - x!), 1e-9);
    assertLess(Math.abs(Number(rect.getAttribute("y")) - y!), 1e-9);
    assertLess(Math.abs(Number(rect.getAttribute("width")) - width!), 1e-9);
  }
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
