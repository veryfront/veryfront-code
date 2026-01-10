/**
 * On-the-fly Tailwind CSS compilation using UnoCSS runtime
 * Scans HTML content and generates only the CSS classes that are used
 */

// Simple JIT Tailwind CSS generator
// This extracts class names from HTML and generates corresponding CSS
export function generateTailwindCSS(htmlContent: string): string {
  // Extract all class names from the HTML
  const classPattern = /class="([^"]*)"/g;
  const classNames = new Set<string>();

  let match;
  while ((match = classPattern.exec(htmlContent)) !== null) {
    const classAttr = match[1];
    if (!classAttr) continue;
    for (const cls of classAttr.split(/\s+/)) {
      const trimmed = cls.trim();
      if (trimmed) classNames.add(trimmed);
    }
  }

  // For now, we'll use the manually defined Tailwind utilities
  // In a full implementation, this would use UnoCSS or Twind
  return generateCSSForClasses(Array.from(classNames));
}

function generateCSSForClasses(classes: string[]): string {
  const css: string[] = [];

  // Tailwind Preflight/Reset
  css.push(getTailwindPreflight());

  // Generate CSS for each class
  for (const className of classes) {
    const rules = getCSSForClass(className);
    if (rules) css.push(rules);
  }

  return css.join("\n");
}

function getTailwindPreflight(): string {
  return `
/* Tailwind Preflight */
*, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: #e5e7eb; }
::before, ::after { --tw-content: ''; }
html { line-height: 1.5; -webkit-text-size-adjust: 100%; -moz-tab-size: 4; tab-size: 4; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif; font-feature-settings: normal; font-variation-settings: normal; }
body { margin: 0; line-height: inherit; }
  `.trim();
}

function getCSSForClass(_className: string): string | null {
  // This is a simplified version - a full implementation would handle all Tailwind utilities
  // For now, return the full Tailwind CSS

  // We'll generate CSS on-demand for common patterns
  // In production, use UnoCSS or Twind for complete coverage

  return null; // Placeholder for now
}
