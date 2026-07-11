export const RESPONSIVE_IMAGE_WIDTH_XS = 320;
export const RESPONSIVE_IMAGE_WIDTH_SM = 640;
export const RESPONSIVE_IMAGE_WIDTH_MD = 1024;
export const RESPONSIVE_IMAGE_WIDTH_LG = 1920;
export const RESPONSIVE_IMAGE_WIDTHS = [
  RESPONSIVE_IMAGE_WIDTH_XS,
  RESPONSIVE_IMAGE_WIDTH_SM,
  RESPONSIVE_IMAGE_WIDTH_MD,
  RESPONSIVE_IMAGE_WIDTH_LG,
] as const;

interface StorybookLogger {
  component: (_name: string) => StorybookLogger;
  child: (_context: Record<string, unknown>) => StorybookLogger;
  debug: (..._args: unknown[]) => void;
  info: (..._args: unknown[]) => void;
  warn: (..._args: unknown[]) => void;
  error: (..._args: unknown[]) => void;
  time: <T>(_label: string, callback: () => T) => T;
}

const noop = (..._args: unknown[]): void => {};
const storybookLogger: StorybookLogger = {
  component: () => storybookLogger,
  child: () => storybookLogger,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  time: (_label, callback) => callback(),
};

/** Browser-safe logger used only while bundling Storybook. */
export const serverLogger = storybookLogger;
