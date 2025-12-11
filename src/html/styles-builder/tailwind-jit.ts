
export function generateTailwindCSS(htmlContent: string): string {
  const classPattern = /class="([^"]*)"/g;
  const classNames = new Set<string>();

  let match;
  while ((match = classPattern.exec(htmlContent)) !== null) {
    const classAttr = match[1];
    if (!classAttr) continue;
    const classes = classAttr.split(/\s+/);
    classes.forEach((cls) => {
      if (cls.trim()) classNames.add(cls.trim());
    });
  }

  return generateCSSForClasses(Array.from(classNames));
}

function generateCSSForClasses(classes: string[]): string {
  const css: string[] = [];

  css.push(getTailwindPreflight());

  for (const className of classes) {
    const rules = getCSSForClass(className);
    if (rules) css.push(rules);
  }

  return css.join("\n");
}

function getTailwindPreflight(): string {
  return `
*, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: #e5e7eb; }
::before, ::after { --tw-content: ''; }
html { line-height: 1.5; -webkit-text-size-adjust: 100%; -moz-tab-size: 4; tab-size: 4; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif; font-feature-settings: normal; font-variation-settings: normal; }
body { margin: 0; line-height: inherit; }
  `.trim();
}

function getCSSForClass(_className: string): string | null {


  return null;
}
