#!/usr/bin/env -S deno run --allow-all
/**
 * TUI Demo
 *
 * Demonstrates the capabilities of the Veryfront TUI system.
 * Run with: deno run --allow-all src/cli/tui/demo.ts
 */

import {
  commandItem,
  createSignal,
  createSpinnerController,
  defaultTheme,
  drawBox,
  getTerminalSize,
  gitBranchItem,
  helpItem,
  projectItem,
  renderTaskItem,
  snazzyTheme,
  statusItem,
  SYMBOLS,
  text,
  TUIRenderer,
  writeProgressBar,
  writeStatusBar,
  writeText,
} from "./index.ts";

// ============================================================================
// Demo Application
// ============================================================================

async function runDemo() {
  const renderer = new TUIRenderer({
    theme: defaultTheme,
    alternateScreen: true,
  });

  const size = getTerminalSize();
  renderer.init();
  renderer.resize(size.columns, size.rows);

  // Create reactive state
  const progress = createSignal(0);
  const spinnerFrame = createSignal(0);
  const spinnerController = createSpinnerController();

  // Task list
  const tasks = [
    { label: "TypeScript compilation", status: "completed" as const, duration: "2.3s" },
    { label: "Client bundling", status: "completed" as const, duration: "1.8s" },
    { label: "Server rendering", status: "in_progress" as const },
    { label: "Asset optimization", status: "pending" as const },
    { label: "Static generation", status: "pending" as const },
  ];

  // Animation loop
  const animationInterval = setInterval(() => {
    // Update progress
    const currentProgress = progress.get();
    if (currentProgress < 100) {
      progress.set(Math.min(100, currentProgress + 2));
    }

    // Update spinner
    spinnerFrame.set((spinnerFrame.get() + 1) % SYMBOLS.spinnerDots.length);

    // Render frame
    render();
  }, 100);

  function render() {
    const ctx = renderer.getContext();
    const { width, height } = ctx;
    const buffer = ctx.buffer;
    const theme = ctx.theme;

    // Clear buffer
    renderer.clear();

    // =========================================================================
    // Header
    // =========================================================================
    drawBox(buffer, {
      x: 0,
      y: 0,
      width,
      height: 3,
      style: {
        border: "rounded",
        borderColor: theme.colors.primary,
        title: " Veryfront TUI Demo ",
        titleAlign: "center",
        titleColor: theme.colors.primary,
      },
    }, theme);

    writeText(buffer, 2, 1, text.bold("⚡ veryfront build", theme.colors.primary), theme);
    writeText(buffer, width - 20, 1, text.dim("Press q to quit"), theme);

    // =========================================================================
    // Main Content Area
    // =========================================================================
    const contentTop = 4;
    // contentHeight = height - 7 (leaving room for status bar)

    // Progress section
    writeText(
      buffer,
      2,
      contentTop,
      text.bold("Building for production...", theme.colors.text.primary),
      theme,
    );

    // Progress bar
    writeProgressBar(buffer, 2, contentTop + 2, {
      value: progress.get(),
      max: 100,
      width: Math.min(60, width - 4),
      style: {
        filledColor: theme.colors.primary,
        showPercent: true,
      },
    }, theme);

    // Task list
    writeText(buffer, 2, contentTop + 5, text.muted("Tasks:"), theme);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const cells = renderTaskItem(task, theme, spinnerFrame.get());
      for (let j = 0; j < cells.length && 2 + j < width; j++) {
        buffer[contentTop + 7 + i][2 + j] = cells[j];
      }
    }

    // =========================================================================
    // Info Box
    // =========================================================================
    const infoBoxX = Math.max(2, width - 42);
    const infoBoxY = contentTop;
    const infoBoxWidth = Math.min(40, width - 4);

    drawBox(buffer, {
      x: infoBoxX,
      y: infoBoxY,
      width: infoBoxWidth,
      height: 8,
      style: {
        border: "rounded",
        borderColor: theme.colors.border.inactive,
        title: " Statistics ",
        titleAlign: "left",
      },
    }, theme);

    writeText(buffer, infoBoxX + 2, infoBoxY + 1, text.plain("Pages:"), theme);
    writeText(buffer, infoBoxX + 12, infoBoxY + 1, text.bold("42"), theme);

    writeText(buffer, infoBoxX + 2, infoBoxY + 2, text.plain("Chunks:"), theme);
    writeText(buffer, infoBoxX + 12, infoBoxY + 2, text.bold("123"), theme);

    writeText(buffer, infoBoxX + 2, infoBoxY + 3, text.plain("Assets:"), theme);
    writeText(buffer, infoBoxX + 12, infoBoxY + 3, text.bold("56"), theme);

    writeText(buffer, infoBoxX + 2, infoBoxY + 5, text.plain("Size:"), theme);
    writeText(buffer, infoBoxX + 12, infoBoxY + 5, text.success("12.45 MB", theme), theme);

    writeText(buffer, infoBoxX + 2, infoBoxY + 6, text.plain("Time:"), theme);
    writeText(buffer, infoBoxX + 12, infoBoxY + 6, text.primary("23.45s", theme), theme);

    // =========================================================================
    // Theme Showcase
    // =========================================================================
    const themeY = contentTop + 14;
    writeText(buffer, 2, themeY, text.bold("Color Palette:", theme.colors.text.primary), theme);

    const colorSamples = [
      { name: "primary", color: theme.colors.primary },
      { name: "success", color: theme.colors.success },
      { name: "warning", color: theme.colors.warning },
      { name: "error", color: theme.colors.error },
      { name: "info", color: theme.colors.info },
    ];

    let colorX = 4;
    for (const sample of colorSamples) {
      writeText(buffer, colorX, themeY + 1, {
        content: `█ ${sample.name}`,
        style: { color: sample.color as "cyan" },
      }, theme);
      colorX += sample.name.length + 4;
    }

    // =========================================================================
    // Status Bar
    // =========================================================================
    writeStatusBar(buffer, height - 1, {
      left: [
        commandItem("build", theme),
        projectItem("my-app", theme),
        gitBranchItem("main", theme),
      ],
      center: [
        statusItem("API", "success", theme),
        statusItem("Studio", "success", theme),
        statusItem("Renderer", "warning", theme),
      ],
      right: [
        helpItem("? help", theme),
      ],
      width,
      bg: theme.colors.background.secondary,
    }, theme);

    // Commit to screen
    renderer.commit();
  }

  // Initial render
  render();

  // Handle keyboard input
  if (typeof Deno !== "undefined") {
    // @ts-ignore - Deno global
    Deno.stdin.setRaw(true);
    const decoder = new TextDecoder();

    for await (const chunk of Deno.stdin.readable) {
      const input = decoder.decode(chunk);

      // Quit on 'q' or Ctrl+C
      if (input === "q" || input === "\x03") {
        break;
      }

      // Theme switching
      if (input === "t") {
        const currentTheme = renderer.getTheme();
        const newTheme = currentTheme.name === "default" ? snazzyTheme : defaultTheme;
        renderer.setTheme(newTheme);
        render();
      }

      // Force redraw on 'r'
      if (input === "r") {
        renderer.forceRedraw();
      }
    }
  } else {
    // Node.js - wait for a bit then exit
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Cleanup
  clearInterval(animationInterval);
  spinnerController.stop();
  renderer.cleanup();

  console.log("\nDemo finished. Thanks for trying Veryfront TUI!");
}

// Run demo
runDemo().catch((error) => {
  console.error("Demo error:", error);
  Deno.exit(1);
});
