import { DEPENDENCY_MISSING, INITIALIZATION_ERROR } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
import { LIGHTNING_CSS_MODULE_SPECIFIER } from "../constants.ts";
import type {
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSProcessingResult,
  LightningCSSModule,
} from "../types/index.ts";
import { parseBrowserTargets } from "../utils.ts";

type LightningCSSLoader = () => Promise<LightningCSSModule>;

function defaultLoader(): Promise<LightningCSSModule> {
  return import(LIGHTNING_CSS_MODULE_SPECIFIER);
}

export class LightningCSSStrategy implements CSSOptimizationStrategy {
  readonly name = "lightning-css";
  readonly priority = 100;

  private lightningCSS: LightningCSSModule | null = null;
  private initialization: Promise<boolean> | null = null;
  private readonly loader: LightningCSSLoader;

  constructor(loader: LightningCSSLoader = defaultLoader) {
    if (typeof loader !== "function") {
      throw new TypeError("Lightning CSS loader must be a function");
    }
    this.loader = loader;
  }

  init(): Promise<boolean> {
    if (this.lightningCSS) return Promise.resolve(true);
    const pending = this.initialization ??= (async () => {
      try {
        const module = await this.loader();
        if (!module || typeof module.transform !== "function") {
          throw new TypeError(
            "Lightning CSS module did not export a transform function",
          );
        }
        this.lightningCSS = module;
        logger.info("Lightning CSS optimizer loaded successfully");
        return true;
      } catch (error) {
        throw DEPENDENCY_MISSING.create({
          detail: `CSS optimization requires ${LIGHTNING_CSS_MODULE_SPECIFIER}`,
          cause: error,
        });
      }
    })();
    return pending.catch((error) => {
      if (this.initialization === pending) this.initialization = null;
      throw error;
    });
  }

  canProcess(options: CSSOptimizationOptions): boolean {
    return this.lightningCSS !== null && options.enabled !== false;
  }

  async process(
    content: string,
    filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    if (!this.lightningCSS) {
      throw INITIALIZATION_ERROR.create({
        detail: "Lightning CSS not initialized",
      });
    }

    const sourceMap = options.sourceMap ?? false;
    const result = this.lightningCSS.transform({
      filename,
      code: new TextEncoder().encode(content),
      minify: options.minify ?? true,
      sourceMap,
      targets: options.autoprefixer === false ? undefined : parseBrowserTargets(options.browsers),
      analyzeDependencies: false,
    });
    if (!(result.code instanceof Uint8Array)) {
      throw new TypeError("Lightning CSS returned invalid output bytes");
    }
    if (sourceMap && !(result.map instanceof Uint8Array)) {
      throw new TypeError("Lightning CSS did not return the requested source map");
    }

    const decoder = new TextDecoder("utf-8", { fatal: true });
    return {
      code: decoder.decode(result.code),
      sourceMap: result.map ? decoder.decode(result.map) : undefined,
    };
  }

  isAvailable(): boolean {
    return this.lightningCSS !== null;
  }
}
