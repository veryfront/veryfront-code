/**
 * First-party extensions selected by the framework composition root.
 *
 * `rootNpm` is intentionally narrower than builtin activation. Source builds
 * and dedicated services can provide every builtin from their own package
 * set, while the standard npm/CLI distribution installs only baseline app and
 * developer-runtime capabilities.
 */

export type FirstPartyBuiltinExtensionPolicy = Readonly<{
  readonly name: string;
  readonly sourceDirectory: string;
  readonly rootNpm: boolean;
}>;

export const FIRST_PARTY_BUILTIN_EXTENSION_POLICIES = Object.freeze(([
  { name: "ext-auth-jwt", sourceDirectory: "ext-auth-jwt", rootNpm: false },
  {
    name: "ext-observability-opentelemetry",
    sourceDirectory: "ext-observability-opentelemetry",
    rootNpm: false,
  },
  {
    name: "ext-bundler-esbuild",
    sourceDirectory: "ext-bundler-esbuild",
    rootNpm: true,
  },
  { name: "ext-dev-ui-react", sourceDirectory: "ext-dev-ui-react", rootNpm: false },
  { name: "ext-parser-babel", sourceDirectory: "ext-parser-babel", rootNpm: true },
  { name: "ext-yaml", sourceDirectory: "ext-yaml", rootNpm: true },
  { name: "ext-content-mdx", sourceDirectory: "ext-content-mdx", rootNpm: true },
  { name: "ext-css-tailwind", sourceDirectory: "ext-css-tailwind", rootNpm: true },
  {
    name: "ext-node-websocket-ws",
    sourceDirectory: "ext-node-websocket-ws",
    rootNpm: true,
  },
  {
    name: "ext-document-kreuzberg",
    sourceDirectory: "ext-document-kreuzberg",
    rootNpm: false,
  },
  { name: "ext-db-sqlite", sourceDirectory: "ext-db-sqlite", rootNpm: false },
  {
    name: "ext-sandbox-shell-tools",
    sourceDirectory: "ext-sandbox-shell-tools",
    rootNpm: false,
  },
  {
    name: "ext-eval-report-mlflow",
    sourceDirectory: "ext-eval-report-mlflow",
    rootNpm: false,
  },
] satisfies FirstPartyBuiltinExtensionPolicy[]).map((policy) => Object.freeze(policy)));

export const STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES = Object.freeze(
  FIRST_PARTY_BUILTIN_EXTENSION_POLICIES.filter((policy) => policy.rootNpm).map(
    (policy) => policy.sourceDirectory,
  ),
);
