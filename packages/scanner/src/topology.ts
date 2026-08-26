import { access, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import {
  repositoryTopologySchema,
  type RepositoryService,
  type RepositoryTopology,
} from "@screenbranch/schema";

const SERVICE_CONTAINERS = ["apps", "services", "packages"];
const PROVIDER_FILES = new Map<string, RepositoryService["deployProviders"][number]>([
  ["railway.json", "railway"],
  ["vercel.json", "vercel"],
  ["fly.toml", "fly"],
  ["render.yaml", "render"],
  ["Dockerfile", "docker"],
]);
const SOURCE_ROOTS = ["app", "src", "pages", "public"];
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|html|json)$/i;
const MAX_SIGNAL_FILES = 400;
const MAX_SIGNAL_BYTES = 256_000;

const INTEGRATION_PROVIDERS: Array<[RegExp, RepositoryService["integrations"][number]["kind"], string, RegExp]> = [
  [/supabase/i, "database", "Supabase", /(?:from\s*["'][^"']*supabase|require\(["'][^"']*supabase|@supabase\/|\.supabase\.co|\bsupabase\.auth\b)/i],
  [/browserbase/i, "other", "Browserbase", /(?:(?:api|www)\.browserbase\.com|Browserbase[A-Z][A-Za-z]+|from\s*["'][^"']*browserbase|require\(["'][^"']*browserbase)/],
  [/resend/i, "email", "Resend", /(?:from\s*["']resend["']|require\(["']resend["']|new\s+Resend\s*\(|api\.resend\.com)/i],
  [/stripe/i, "payments", "Stripe", /(?:from\s*["']stripe["']|require\(["']stripe["']|new\s+Stripe\s*\(|api\.stripe\.com)/i],
  [/sentry/i, "observability", "Sentry", /(?:@sentry\/|\bSentry\.(?:init|captureException|captureMessage)\s*\()/i],
  [/(?:openai|anthropic|openrouter)/i, "ai", "AI provider", /(?:from\s*["'][^"']*(?:openai|anthropic|openrouter)|require\(["'][^"']*(?:openai|anthropic|openrouter)|new\s+(?:OpenAI|Anthropic)\s*\()/i],
];

const FEATURE_FLAG_PROVIDERS: Array<[RegExp, string, RegExp]> = [
  [/(?:launchdarkly|launch-darkly|@launchdarkly)/i, "LaunchDarkly", /(?:from\s*["'][^"']*launchdarkly|require\(["'][^"']*launchdarkly|\bLDClient\b|launchdarkly\.(?:initialize|variation))/i],
  [/(?:unleash-client|@unleash|unleashclient)/i, "Unleash", /(?:from\s*["'][^"']*unleash|require\(["'][^"']*unleash|\bUnleashClient\b)/i],
  [/(?:statsig|@statsig)/i, "Statsig", /(?:from\s*["'][^"']*statsig|require\(["'][^"']*statsig|Statsig\.(?:initialize|getFeatureGate))/i],
  [/(?:posthog|post-hog)/i, "PostHog", /(?:from\s*["'][^"']*posthog|require\(["'][^"']*posthog|posthog\.(?:init|isFeatureEnabled|getFeatureFlag))/i],
  [/(?:growthbook|@growthbook)/i, "GrowthBook", /(?:from\s*["'][^"']*growthbook|require\(["'][^"']*growthbook|new\s+GrowthBook\s*\()/i],
  [/(?:eppo|@eppo)/i, "Eppo", /(?:from\s*["'][^"']*eppo|require\(["'][^"']*eppo|EppoClient)/i],
  [/(?:optimizely|@optimizely)/i, "Optimizely", /(?:from\s*["'][^"']*optimizely|require\(["'][^"']*optimizely|optimizely\.(?:createInstance|isFeatureEnabled))/i],
  [/(?:@vercel\/flags|vercel flags)/i, "Vercel Flags", /(?:from\s*["']@vercel\/flags|require\(["']@vercel\/flags)/i],
];

export async function inspectRepository(projectRoot: string): Promise<RepositoryTopology> {
  const root = resolve(projectRoot);
  const packageDirectories = await candidatePackageDirectories(root);
  const services = (await Promise.all(packageDirectories.map((directory) => inspectService(root, directory))))
    .filter((service): service is RepositoryService => service !== undefined)
    .sort((left, right) => left.path.localeCompare(right.path));
  const rootPackage = await readJson(join(root, "package.json"));
  return repositoryTopologySchema.parse({
    schemaVersion: "screenwalk.topology.v0",
    repository: {
      name: stringValue(rootPackage?.name) ?? basename(root),
      root,
      kind: packageDirectories.some((directory) => relative(root, directory) !== "") ? "monorepo" : "single-app",
    },
    services,
    generatedAt: new Date().toISOString(),
  });
}

export function selectService(topology: RepositoryTopology, selector?: string): RepositoryService | undefined {
  if (selector) {
    return topology.services.find((service) => service.id === selector || service.name === selector || service.path === selector);
  }
  const browserServices = topology.services.filter((service) => service.kind === "web" || service.kind === "admin");
  return browserServices.length === 1 ? browserServices[0] : undefined;
}

async function candidatePackageDirectories(root: string): Promise<string[]> {
  const directories = new Set<string>();
  if (await exists(join(root, "package.json")) || await exists(join(root, "index.html"))) directories.add(root);
  for (const container of SERVICE_CONTAINERS) {
    const containerPath = join(root, container);
    for (const entry of await safeReadDir(containerPath)) {
      if (entry.isDirectory() && await isServiceDirectory(join(containerPath, entry.name))) {
        directories.add(join(containerPath, entry.name));
      }
    }
  }
  return [...directories];
}

async function inspectService(root: string, directory: string): Promise<RepositoryService | undefined> {
  const manifest = await readJson(join(directory, "package.json"));
  const rel = relative(root, directory) || ".";
  const dependencies = { ...objectValue(manifest?.dependencies), ...objectValue(manifest?.devDependencies) };
  const scripts = objectValue(manifest?.scripts);
  const rootHtmlEntrypoint = await exists(join(directory, "index.html"));
  const publicHtmlEntrypoint = await exists(join(directory, "public", "index.html"));
  const serverSource = await readText(join(directory, "server.mjs"));
  const serverRendersHtml = Boolean(serverSource && /(text\/html|<!doctype\s+html|<html[\s>])/i.test(serverSource));
  const providerSet = new Set<RepositoryService["deployProviders"][number]>();
  for (const [file, provider] of PROVIDER_FILES) {
    if (file === "Dockerfile") {
      const entries = await safeReadDir(directory);
      if (entries.some((entry) => entry.isFile() && entry.name.startsWith("Dockerfile"))) providerSet.add(provider);
    } else if (await exists(join(directory, file))) providerSet.add(provider);
  }
  const detectedFramework = detectFramework(dependencies);
  const framework = detectedFramework && !["hono", "express"].includes(detectedFramework)
    ? detectedFramework
    : rootHtmlEntrypoint || publicHtmlEntrypoint ? "html"
      : serverRendersHtml ? "html-server" : detectedFramework;
  const livesInAppContainer = /^(apps|services)\//.test(rel);
  const hasUiEntrypoint = rootHtmlEntrypoint || publicHtmlEntrypoint
    || await pathExists(join(directory, "app")) || await pathExists(join(directory, "pages"))
    || await pathExists(join(directory, "src", "app")) || await exists(join(directory, "src", "main.ts"))
    || await exists(join(directory, "src", "main.tsx")) || await exists(join(directory, "src", "pages"));
  const workspaceOrchestrator = rel === "." && manifest?.private === true && !hasUiEntrypoint
    && Object.values(scripts).some((script) => typeof script === "string" && /(?:^|\s)(?:turbo\s+run|pnpm\s+(?:-r|--recursive))\b/.test(script));
  const configuredDeploy = [...providerSet].some((provider) => provider !== "docker");
  const browserRunnable = ["next", "vite", "astro", "sveltekit", "remix"].includes(framework ?? "") && Boolean(scripts.dev || scripts.start)
    || framework === "html" || framework === "html-server";
  const serviceRunnable = livesInAppContainer && Boolean(scripts.start || scripts.dev || providerSet.has("docker"));
  const looksRunnable = !workspaceOrchestrator && (configuredDeploy || browserRunnable || serviceRunnable);
  if (!looksRunnable) return undefined;
  const sourceFiles = ["README.md", ".env.example", ".env.local.example", ".env.staging.example", ".env.production.example", "vercel.json", "railway.json"];
  const sources = (await Promise.all(sourceFiles.map(async (file) => ({
    file,
    text: await readText(join(directory, file)),
  })))).filter(({ text }) => text !== undefined) as Array<{ file: string; text: string }>;
  const sourceReferences = await boundedSourceReferences(directory);
  const id = rel === "." ? "app" : rel.replaceAll(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id,
    name: stringValue(manifest?.name) ?? basename(directory),
    path: rel,
    kind: detectKind(rel, dependencies, framework),
    framework,
    deployProviders: [...providerSet].sort(),
    integrations: detectIntegrations(root, directory, sources, dependencies, sourceReferences),
    featureFlags: detectFeatureFlags(root, directory, sources, dependencies, sourceReferences),
    environments: detectEnvironments(root, directory, sources),
  };
}

function detectFramework(dependencies: Record<string, unknown>): string | undefined {
  if ("next" in dependencies) return "next";
  if ("@sveltejs/kit" in dependencies) return "sveltekit";
  if ("astro" in dependencies) return "astro";
  if ("@remix-run/node" in dependencies || "@remix-run/react" in dependencies) return "remix";
  if ("vite" in dependencies) return "vite";
  if ("hono" in dependencies || "@hono/node-server" in dependencies) return "hono";
  if ("express" in dependencies) return "express";
  return undefined;
}

function detectKind(path: string, dependencies: Record<string, unknown>, framework?: string): RepositoryService["kind"] {
  const signal = path.toLowerCase();
  if (signal.includes("admin")) return "admin";
  if (signal.includes("worker") || signal.includes("job")) return "worker";
  if (["next", "vite", "astro", "sveltekit", "remix", "html", "html-server"].includes(framework ?? "")) return "web";
  if (signal.includes("api") || signal.includes("auth") || "hono" in dependencies || "express" in dependencies) return "api";
  return "service";
}

function detectIntegrations(root: string, directory: string, sources: Array<{ file: string; text: string }>, dependencies: Record<string, unknown>, sourceReferences: Array<{ file: string; text: string }>): RepositoryService["integrations"] {
  const integrations = new Map<string, RepositoryService["integrations"][number]>();
  const add = (integration: RepositoryService["integrations"][number]) => {
    const id = `${integration.kind}:${integration.name}`;
    const current = integrations.get(id);
    if (!current || integrationEvidenceScore(integration.evidence) > integrationEvidenceScore(current.evidence) || integrationSignalScore(integration.via) > integrationSignalScore(current.via)) integrations.set(id, integration);
  };
  for (const { file, text } of sources) {
    for (const match of text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=/gm)) {
      const key = match[1];
      if (!key || /^(NODE_ENV|PORT|HOST|LOG_LEVEL|NEXT_PUBLIC_URL)$/.test(key)) continue;
      const classified = classifyIntegration(key);
      if (classified && /(URL|URI|DSN|TOKEN|KEY|SECRET|ID|DATABASE|REDIS|QUEUE|SMTP|PROVIDER)/.test(key)) {
        add({ ...classified, via: key, sourceFile: relative(root, join(directory, file)), evidence: "configuration" });
      }
    }
  }
  for (const dependency of Object.keys(dependencies)) {
    const match = INTEGRATION_PROVIDERS.find(([pattern]) => pattern.test(dependency));
    if (match) add({ kind: match[1], name: match[2], via: dependency, sourceFile: relative(root, join(directory, "package.json")), evidence: "dependency" });
  }
  const operationalSources = [...sourceReferences, ...sources.filter(({ file }) => /^(?:vercel|railway)\.json$/.test(file))];
  for (const { file, text } of operationalSources) {
    if (!isOperationalSignalFile(file)) continue;
    for (const [, kind, name, sourcePattern] of INTEGRATION_PROVIDERS) {
      if (sourcePattern.test(text)) add({ kind, name, via: `${name} reference`, sourceFile: relative(root, join(directory, file)), evidence: "source-reference" });
    }
  }
  return [...integrations.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
}

function detectFeatureFlags(root: string, directory: string, sources: Array<{ file: string; text: string }>, dependencies: Record<string, unknown>, sourceReferences: Array<{ file: string; text: string }>): RepositoryService["featureFlags"] {
  const flags = new Map<string, RepositoryService["featureFlags"][number]>();
  const add = (signal: RepositoryService["featureFlags"][number]) => {
    const current = flags.get(signal.provider);
    if (!current || integrationEvidenceScore(signal.evidence) > integrationEvidenceScore(current.evidence)) flags.set(signal.provider, signal);
  };
  for (const { file, text } of sources) {
    for (const match of text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=/gm)) {
      const key = match[1];
      const provider = FEATURE_FLAG_PROVIDERS.find(([pattern]) => pattern.test(key ?? ""))?.[1];
      if (key && provider) add({ provider, via: key, sourceFile: relative(root, join(directory, file)), evidence: "configuration" });
      else if (key && /(?:^|_)(?:FEATURE_?FLAGS?|FLAGS?)(?:_|$)/.test(key)) add({ provider: "Feature flags", via: key, sourceFile: relative(root, join(directory, file)), evidence: "configuration" });
    }
  }
  for (const dependency of Object.keys(dependencies)) {
    const provider = FEATURE_FLAG_PROVIDERS.find(([pattern]) => pattern.test(dependency))?.[1];
    if (provider) add({ provider, via: dependency, sourceFile: relative(root, join(directory, "package.json")), evidence: "dependency" });
  }
  const operationalSources = [...sourceReferences, ...sources.filter(({ file }) => /^(?:vercel|railway)\.json$/.test(file))];
  for (const { file, text } of operationalSources) {
    if (!isOperationalSignalFile(file)) continue;
    for (const [, provider, sourcePattern] of FEATURE_FLAG_PROVIDERS) {
      if (sourcePattern.test(text)) add({ provider, via: `${provider} reference`, sourceFile: relative(root, join(directory, file)), evidence: "source-reference" });
    }
  }
  return [...flags.values()].sort((left, right) => left.provider.localeCompare(right.provider));
}

function classifyIntegration(key: string): Omit<RepositoryService["integrations"][number], "via"> | undefined {
  const rules: Array<[RegExp, RepositoryService["integrations"][number]["kind"], string]> = [
    [/TURNKEY/, "auth", "Turnkey"], [/CLERK/, "auth", "Clerk"], [/(^|_)AUTH(_|$)/, "auth", "Authentication service"],
    [/SUPABASE/, "database", "Supabase"], [/(DATABASE|POSTGRES|PG_)/, "database", "Postgres"],
    [/STRIPE/, "payments", "Stripe"], [/VGS/, "payments", "VGS"], [/(PAYMENT|CHECKOUT)/, "payments", "Payment service"],
    [/SENTRY/, "observability", "Sentry"], [/(OTEL|DATADOG|NEW_RELIC)/, "observability", "Telemetry service"],
    [/(REDIS|QUEUE|KAFKA|RABBIT)/, "queue", "Queue or cache"], [/(S3|BLOB|STORAGE|R2_)/, "storage", "Object storage"],
    [/(RESEND|SENDGRID|SMTP|EMAIL)/, "email", "Email service"], [/(OPENAI|ANTHROPIC|OPENROUTER|FAL_)/, "ai", "AI provider"],
  ];
  const match = rules.find(([pattern]) => pattern.test(key));
  return match ? { kind: match[1], name: match[2] } : undefined;
}

function detectEnvironments(root: string, directory: string, sources: Array<{ file: string; text: string }>): RepositoryService["environments"] {
  const environments = new Map<string, RepositoryService["environments"][number]>();
  for (const { file, text } of sources) {
    for (const line of text.split("\n")) {
      const assignment = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=\s*(https?:\/\/[^\s#]+)/);
      const contextual = /\b(local|preview|staging|stage|production|prod)\b/i.test(line);
      const canonicalKey = assignment && /^(NEXT_PUBLIC_(?:APP_)?URL|PUBLIC_URL|APP_URL|MAIN_WEB_URL|NEXT_PUBLIC_MAIN_WEB_URL)$/.test(assignment[1] ?? "");
      if (!contextual && !canonicalKey) continue;
      const match = line.match(/https?:\/\/[^\s)'"`<>]+/);
      const raw = match?.[0]?.replace(/[.,;:]+$/, "");
      if (!raw) continue;
      try {
        const parsed = new URL(raw);
        if (parsed.username || parsed.password || /example\.(com|test)$/.test(parsed.hostname)) continue;
        const environment = classifyEnvironment(parsed, line);
        const sourceFile = relative(root, join(directory, file));
        environments.set(`${environment}:${parsed.origin}`, { environment, url: parsed.origin, sourceFile });
      } catch {
        // Ignore malformed documentation examples.
      }
    }
  }
  return [...environments.values()].sort((left, right) => left.environment.localeCompare(right.environment) || (left.url ?? "").localeCompare(right.url ?? ""));
}

function classifyEnvironment(url: URL, context = ""): RepositoryService["environments"][number]["environment"] {
  const signal = `${url.hostname}${url.pathname}`.toLowerCase();
  const contextSignal = context.toLowerCase();
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return "local";
  if (/\b(staging|stage)\b/.test(contextSignal) && !/\b(production|prod)\b/.test(contextSignal)) return "staging";
  if (/\bpreview\b/.test(contextSignal) && !/\b(production|prod)\b/.test(contextSignal)) return "preview";
  if (/\b(production|prod)\b/.test(contextSignal)) return "production";
  if (/(staging|code-preview|stage\.|-stage[.-])/.test(signal)) return "staging";
  if (/(preview|deploy-preview|-git-)/.test(signal)) return "preview";
  if (/\.vercel\.app$/.test(url.hostname)) return "unknown";
  return "production";
}

function integrationSignalScore(key: string): number {
  if (/(DSN|URL|URI)$/.test(key)) return 3;
  if (/(TOKEN|KEY|SECRET|ID)$/.test(key)) return 2;
  return 1;
}

function integrationEvidenceScore(evidence: RepositoryService["integrations"][number]["evidence"]): number {
  if (evidence === "configuration") return 3;
  if (evidence === "dependency") return 2;
  return 1;
}

async function boundedSourceReferences(directory: string): Promise<Array<{ file: string; text: string }>> {
  const references: Array<{ file: string; text: string }> = [];
  const pending = SOURCE_ROOTS.map((name) => join(directory, name));
  while (pending.length > 0 && references.length < MAX_SIGNAL_FILES) {
    const current = pending.shift();
    if (!current) break;
    for (const entry of await safeReadDir(current)) {
      if (references.length >= MAX_SIGNAL_FILES) break;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!/[\\/](?:node_modules|dist|build|\.next)(?:[\\/]|$)/.test(path)) pending.push(path);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) {
        const text = await readText(path);
        if (text !== undefined && Buffer.byteLength(text) <= MAX_SIGNAL_BYTES) references.push({ file: relative(directory, path), text });
      }
    }
  }
  return references;
}

function isOperationalSignalFile(file: string): boolean {
  return !/(?:^|\/)(?:__tests__|fixtures?|scanner|constants?|pipeline|ranking|scripts?|validation|eval|data)(?:\/|$)|(?:^|\/)(?:seed|fixture)[^/]*|(?:^|\/)(?:detect-stack|package-map)\.[^/]+$|(?:^|[./_-])(?:test|spec)\.[^.]+$|(?:^|\/)graph\.html$/i.test(file);
}

async function isServiceDirectory(path: string): Promise<boolean> {
  if (await exists(join(path, "package.json"))) return true;
  const entries = await safeReadDir(path);
  return entries.some((entry) => entry.isFile() && (entry.name.startsWith("Dockerfile") || PROVIDER_FILES.has(entry.name)));
}

async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true; } catch { return false; }
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; } catch { return undefined; }
}

async function readText(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); } catch { return undefined; }
}

async function safeReadDir(path: string) {
  try { return await readdir(path, { withFileTypes: true }); } catch { return []; }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
