export interface CpuProfile {
  startTime: number;
  endTime: number;
  nodes: {
    id: number;
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
      scriptId: string;
    };
    children?: number[];
    hitCount?: number;
  }[];
  samples: number[];
  timeDeltas: number[];
}

export function sanitizeProfile(
  profile: CpuProfile,
  rootUrl: string,
): CpuProfile {
  const copy = structuredClone(profile);
  for (const node of copy.nodes) {
    const frame = node.callFrame;
    const url = frame.url.split(/[?#]/, 1)[0]!;
    frame.url = url.startsWith(rootUrl)
      ? url.startsWith(`${rootUrl}.cache/`)
        ? "[generated]"
        : url.slice(rootUrl.length)
      : url.startsWith("node:") || url.startsWith("ext:")
      ? url
      : url
      ? "[external]"
      : "";
    // The harness accepts only repository-owned synthetic workloads.
    frame.functionName = frame.functionName.replace(/[\r\n\t]/g, " ").slice(
      0,
      160,
    );
  }
  return copy;
}

export function summarizeProfile(profile: CpuProfile) {
  const own = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i]!;
    own.set(id, (own.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  const totals = new Map<number, number>();
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const total = (id: number): number => {
    if (totals.has(id)) return totals.get(id)!;
    const value = (own.get(id) ?? 0) +
      (nodes.get(id)?.children ?? []).reduce(
        (sum, child) => sum + total(child),
        0,
      );
    totals.set(id, value);
    return value;
  };
  const functions = new Map<
    string,
    { name: string; location: string; selfMs: number; totalMs: number }
  >();
  for (const node of profile.nodes) {
    const { functionName, url, lineNumber, columnNumber, scriptId } =
      node.callFrame;
    const location = url ? `${url}:${lineNumber + 1}` : "[runtime]";
    const key = `${scriptId}\0${lineNumber}\0${columnNumber}\0${functionName}`;
    const item = functions.get(key) ??
      { name: functionName || "(anonymous)", location, selfMs: 0, totalMs: 0 };
    item.selfMs += own.get(node.id) ?? 0;
    item.totalMs += total(node.id);
    functions.set(key, item);
  }
  return {
    samples: profile.samples.length,
    sampledMs: [...own.values()].reduce((a, b) => a + b, 0),
    hotspots: [...functions.values()].sort((a, b) => b.selfMs - a.selfMs).slice(
      0,
      25,
    ),
    totals,
  };
}

export function summarizeRuns(values: number[]) {
  if (!values.length || values.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error("Measurements must contain finite non-negative values");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2,
    min: sorted[0]!,
    max: sorted.at(-1)!,
    samples: sorted.length,
  };
}

export function compare(before: number, after: number) {
  if (![before, after].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error("Comparison requires positive finite measurements");
  }
  return {
    changePercent: ((after - before) / before) * 100,
    speedup: before / after,
  };
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

/** Standalone SVG. Width is sampled time; horizontal position is not a timeline. */
export function flamegraph(profile: CpuProfile): string {
  const { totals } = summarizeProfile(profile);
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const root = profile.nodes[0];
  if (!root) return "<p>No profile samples</p>";
  const duration = totals.get(root.id) || 1;
  const frames: string[] = [];
  let depth = 0;
  const draw = (id: number, x: number, level: number) => {
    const node = nodes.get(id)!;
    const ms = totals.get(id) ?? 0;
    const width = 1200 * ms / duration;
    if (width < 0.5) return;
    depth = Math.max(depth, level);
    const label = node.callFrame.functionName || "(anonymous)";
    const title = escapeHtml(
      `${label} (${ms.toFixed(2)} ms sampled) ${node.callFrame.url}`,
    );
    const box = `${x} ${level * 22} ${width} 22`;
    frames.push(
      `<g data-box="${box}" tabindex="0" role="button" aria-label="${title}"><title>${title}</title><rect x="${x}" y="${
        level * 22
      }" width="${width}" height="21" fill="hsl(${
        20 + level * 9 % 40
      } 85% 72%)" stroke="white" stroke-width=".5"/>${
        width > 40
          ? `<text x="${x + 3}" y="${level * 22 + 15}" font-size="12">${
            escapeHtml(label.slice(0, Math.floor(width / 7) - 1))
          }</text>`
          : ""
      }</g>`,
    );
    let childX = x;
    for (const child of node.children ?? []) {
      draw(child, childX, level + 1);
      childX += 1200 * (totals.get(child) ?? 0) / duration;
    }
  };
  draw(root.id, 0, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 ${
    (depth + 1) * 22
  }" data-height="${(depth + 1) * 22}">${frames.join("")}</svg>`;
}
