
import { cyan, dim, green } from "@veryfront/compat/console";
import { isDeno } from "../../platform/compat/runtime.ts";

/** Helper to write to stdout in a cross-platform way */
function writeToStdout(text: string): void {
  if (isDeno) {
    // @ts-ignore: Deno global
    Deno?.stdout?.writeSync?.(new TextEncoder().encode(text));
  } else {
    process.stdout?.write?.(text);
  }
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

const CLEAR_LINE = "\x1b[2K";
const MOVE_UP = "\x1b[1A";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export async function select(
  question: string,
  options: SelectOption[],
  defaultIndex = 0,
): Promise<string | null> {
  let selectedIndex = defaultIndex;

  console.log("");
  console.log(cyan("?") + " " + question);
  console.log(dim("  Use arrow keys to navigate, Enter to select"));
  console.log("");

  const renderOptions = () => {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;
      const prefix = i === selectedIndex ? green("❯") : " ";
      const label = i === selectedIndex ? green(opt.label) : opt.label;
      const desc = opt.description ? dim(` - ${opt.description}`) : "";
      console.log(`  ${prefix} ${label}${desc}`);
    }
  };

  const clearOptions = () => {
    for (let i = 0; i < options.length; i++) {
      writeToStdout(MOVE_UP + CLEAR_LINE);
    }
  };

  writeToStdout(HIDE_CURSOR);
  renderOptions();

  try {
    const result = await readKeypress((key) => {
      if (key === "up" && selectedIndex > 0) {
        selectedIndex--;
        clearOptions();
        renderOptions();
      } else if (key === "down" && selectedIndex < options.length - 1) {
        selectedIndex++;
        clearOptions();
        renderOptions();
      } else if (key === "enter") {
        return options[selectedIndex]?.value ?? null;
      } else if (key === "escape") {
        return null;
      }
      return undefined;
    });

    clearOptions();
    const selected = options[selectedIndex];
    if (selected) {
      console.log(`  ${green("✓")} ${selected.label}`);
    }

    return result;
  } finally {
    writeToStdout(SHOW_CURSOR);
  }
}

export async function multiSelect(
  question: string,
  options: SelectOption[],
  preselected: string[] = [],
): Promise<string[]> {
  let cursorIndex = 0;
  const selected = new Set(preselected);

  console.log("");
  console.log(cyan("?") + " " + question);
  console.log(dim("  Use arrow keys, Space to toggle, Enter to confirm"));
  console.log("");

  const renderOptions = () => {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt) continue;
      const cursor = i === cursorIndex ? green("❯") : " ";
      const checkbox = selected.has(opt.value) ? green("◉") : "○";
      const label = i === cursorIndex ? green(opt.label) : opt.label;
      const desc = opt.description ? dim(` - ${opt.description}`) : "";
      console.log(`  ${cursor} ${checkbox} ${label}${desc}`);
    }
  };

  const clearOptions = () => {
    for (let i = 0; i < options.length; i++) {
      writeToStdout(MOVE_UP + CLEAR_LINE);
    }
  };

  writeToStdout(HIDE_CURSOR);
  renderOptions();

  try {
    await readKeypress((key) => {
      if (key === "up" && cursorIndex > 0) {
        cursorIndex--;
        clearOptions();
        renderOptions();
      } else if (key === "down" && cursorIndex < options.length - 1) {
        cursorIndex++;
        clearOptions();
        renderOptions();
      } else if (key === "space") {
        const opt = options[cursorIndex];
        if (opt) {
          if (selected.has(opt.value)) {
            selected.delete(opt.value);
          } else {
            selected.add(opt.value);
          }
          clearOptions();
          renderOptions();
        }
      } else if (key === "enter") {
        return Array.from(selected);
      } else if (key === "escape") {
        return [];
      }
      return undefined;
    });

    clearOptions();
    for (const opt of options) {
      if (selected.has(opt.value)) {
        console.log(`  ${green("✓")} ${opt.label}`);
      }
    }
    if (selected.size === 0) {
      console.log(dim("  No items selected"));
    }

    return Array.from(selected);
  } finally {
    writeToStdout(SHOW_CURSOR);
  }
}

type KeyHandler<T> = (key: string) => T | undefined;

function readKeypress<T>(handler: KeyHandler<T>): Promise<T> {
  if (isDeno) {
    return readKeypressDeno(handler);
  } else {
    return readKeypressNode(handler);
  }
}

async function readKeypressDeno<T>(handler: KeyHandler<T>): Promise<T> {
  Deno.stdin.setRaw(true);

  try {
    const buf = new Uint8Array(8);
    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;

      const key = parseKeySequence(buf.subarray(0, n));
      const result = handler(key);
      if (result !== undefined) {
        return result;
      }
    }
    throw new Error("stdin closed");
  } finally {
    Deno.stdin.setRaw(false);
  }
}

function readKeypressNode<T>(handler: KeyHandler<T>): Promise<T> {
  const stdin = process.stdin;

  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isRaw;

    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    const onData = (data: Uint8Array) => {
      const key = parseKeySequence(data);
      const result = handler(key);
      if (result !== undefined) {
        cleanup();
        resolve(result);
      }
    };

    const onEnd = () => {
      cleanup();
      reject(new Error("stdin closed"));
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      if (stdin.setRawMode) {
        stdin.setRawMode(wasRaw ?? false);
      }
      stdin.pause();
    };

    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}

function parseKeySequence(buf: Uint8Array): string {
  if (buf[0] === 0x1b) {
    if (buf[1] === 0x5b) {
      switch (buf[2]) {
        case 0x41:
          return "up";
        case 0x42:
          return "down";
        case 0x43:
          return "right";
        case 0x44:
          return "left";
      }
    }
    return "escape";
  }

  switch (buf[0]) {
    case 0x0d:
    case 0x0a: // Line feed
      return "enter";
    case 0x20:
      return "space";
    case 0x03:
      return "ctrl-c";
    case 0x71:
      return "q";
  }

  return "unknown";
}
