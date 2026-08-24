/** Selection policy for every first-party extension package. */
export type FirstPartyExtensionSelection =
  | "builtin-direct"
  | "builtin-deferred"
  | "service-conditional"
  | "explicit";

export type FirstPartyEvalExporterSelection = Readonly<
  | { readonly kind: "any-selected" }
  | { readonly kind: "id"; readonly id: string }
>;

export type FirstPartyExtensionPolicy = Readonly<{
  readonly name: string;
  readonly sourceDirectory: string;
  readonly selection: FirstPartyExtensionSelection;
  readonly rootNpm: boolean;
  readonly evalExporterSelection?: FirstPartyEvalExporterSelection;
}>;

/**
 * Authoritative inventory for first-party extension activation.
 *
 * `rootNpm` is intentionally narrower than builtin selection. Source builds
 * and dedicated services can provide every builtin from their own package
 * set, while the standard npm/CLI distribution installs only baseline app and
 * developer-runtime capabilities. Credentialed, mutually exclusive, native,
 * output-changing, and service-lifecycle integrations stay out of that root
 * dependency set.
 */
export const FIRST_PARTY_EXTENSION_POLICIES = Object.freeze(([
  {
    name: "ext-auth-jwt",
    sourceDirectory: "ext-auth-jwt",
    selection: "builtin-deferred",
    rootNpm: false,
  },
  {
    name: "ext-blob-gcs",
    sourceDirectory: "ext-blob-gcs",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-blob-s3",
    sourceDirectory: "ext-blob-s3",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-bundler-esbuild",
    sourceDirectory: "ext-bundler-esbuild",
    selection: "builtin-deferred",
    rootNpm: true,
  },
  {
    name: "ext-bundler-swc",
    sourceDirectory: "ext-bundler-swc",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-cache-redis",
    sourceDirectory: "ext-cache-redis",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-content-mdx",
    sourceDirectory: "ext-content-mdx",
    selection: "builtin-deferred",
    rootNpm: true,
  },
  {
    name: "ext-css-lightning",
    sourceDirectory: "ext-css-lightning",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-css-purgecss",
    sourceDirectory: "ext-css-purgecss",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-css-tailwind",
    sourceDirectory: "ext-css-tailwind",
    selection: "builtin-deferred",
    rootNpm: true,
  },
  {
    name: "ext-db-sqlite",
    sourceDirectory: "ext-db-sqlite",
    selection: "builtin-deferred",
    rootNpm: false,
  },
  {
    name: "ext-dev-ui-react",
    sourceDirectory: "ext-dev-ui-react",
    selection: "builtin-deferred",
    rootNpm: true,
  },
  {
    name: "ext-document-kreuzberg",
    sourceDirectory: "ext-document-kreuzberg",
    selection: "builtin-deferred",
    rootNpm: false,
  },
  {
    name: "ext-eval-report-http",
    sourceDirectory: "ext-eval-report-http",
    selection: "builtin-deferred",
    rootNpm: false,
    evalExporterSelection: Object.freeze({ kind: "any-selected" }),
  },
  {
    name: "ext-eval-report-mlflow",
    sourceDirectory: "ext-eval-report-mlflow",
    selection: "builtin-deferred",
    rootNpm: false,
    evalExporterSelection: Object.freeze({ kind: "id", id: "mlflow" }),
  },
  {
    name: "ext-image-sharp",
    sourceDirectory: "ext-image-sharp",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-llm-anthropic",
    sourceDirectory: "ext-llm-anthropic",
    selection: "builtin-direct",
    rootNpm: false,
  },
  {
    name: "ext-llm-google",
    sourceDirectory: "ext-llm-google",
    selection: "builtin-direct",
    rootNpm: false,
  },
  {
    name: "ext-llm-onnx",
    sourceDirectory: "ext-llm-onnx",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-llm-openai",
    sourceDirectory: "ext-llm-openai",
    selection: "builtin-direct",
    rootNpm: false,
  },
  {
    name: "ext-node-websocket-ws",
    sourceDirectory: "ext-node-websocket-ws",
    selection: "builtin-deferred",
    rootNpm: true,
  },
  {
    name: "ext-observability-opentelemetry",
    sourceDirectory: "ext-observability-opentelemetry",
    selection: "builtin-deferred",
    rootNpm: false,
  },
  {
    name: "ext-observability-sentry",
    sourceDirectory: "ext-observability-sentry",
    selection: "service-conditional",
    rootNpm: false,
  },
  {
    name: "ext-parser-babel",
    sourceDirectory: "ext-parser-babel",
    selection: "builtin-deferred",
    rootNpm: true,
  },
  {
    name: "ext-react-ssr",
    sourceDirectory: "ext-react-ssr",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-redis",
    sourceDirectory: "ext-redis",
    selection: "explicit",
    rootNpm: false,
  },
  {
    name: "ext-sandbox-shell-tools",
    sourceDirectory: "ext-sandbox-shell-tools",
    selection: "builtin-deferred",
    rootNpm: false,
  },
  {
    name: "ext-schema-zod",
    sourceDirectory: "ext-schema-zod",
    selection: "builtin-direct",
    rootNpm: false,
  },
  {
    name: "ext-yaml",
    sourceDirectory: "ext-yaml",
    selection: "builtin-deferred",
    rootNpm: true,
  },
] satisfies FirstPartyExtensionPolicy[]).map((policy) => Object.freeze(policy)));

export const FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES = Object.freeze(
  FIRST_PARTY_EXTENSION_POLICIES.filter((policy) => policy.selection === "builtin-deferred"),
);

export const STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES = Object.freeze(
  FIRST_PARTY_EXTENSION_POLICIES.filter((policy) => policy.rootNpm).map(
    (policy) => policy.sourceDirectory,
  ),
);
