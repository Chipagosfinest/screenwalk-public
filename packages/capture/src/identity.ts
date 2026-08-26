import { createHash } from "node:crypto";
import type { IdentityPolicy, ScreenIdentity } from "@screenbranch/schema";
import { canonicalPath } from "./routes.js";

export const defaultIdentityPolicy: IdentityPolicy = {
  schemaVersion: "screenwalk.identity.v0",
  query: { include: [], ignore: [] },
  hash: { include: [], treatPathAsRoute: true },
};

const DEFAULT_MEANINGFUL_QUERY_KEYS = new Set([
  "tab", "view", "mode", "step", "panel", "drawer", "modal", "section", "screen", "state",
]);
const DEFAULT_IGNORED_QUERY_KEYS = new Set([
  "ref", "source", "campaign", "gclid", "fbclid", "msclkid", "timestamp", "ts", "nonce", "cache", "cachebust", "cache-bust",
  "q", "query", "search", "sort", "order", "filter", "filters",
]);
const SENSITIVE_QUERY_KEY = /(?:^|[-_])(api[-_]?key|key|token|secret|password|passwd|signature|sig|auth|authorization|session|credential)(?:$|[-_])/i;
const TRANSIENT_QUERY_KEY = /(?:^|[-_])(cursor|page|offset|limit)(?:$|[-_])/i;

type Presentation = ScreenIdentity["presentation"];

export function buildScreenIdentity(input: {
  route: string;
  routeTemplate?: string;
  persona: string;
  stateKey: string;
  presentation?: Presentation;
  policy?: IdentityPolicy;
}): ScreenIdentity {
  const policy = input.policy ?? defaultIdentityPolicy;
  const routeTemplate = canonicalPath(input.routeTemplate ?? pathnameOf(input.route));
  const semantic = semanticUrlState(input.route, policy);
  const presentation = input.presentation ?? { kind: "page", overlays: [], slots: [] };
  const familySeed = stableStringify({ routeTemplate, presentation });
  const familyId = `family:${shortHash(familySeed)}`;
  const variantSeed = stableStringify({
    familyId,
    query: semantic.query,
    hash: semantic.hash,
    stateKey: input.stateKey,
    persona: input.persona,
  });
  const reasons = semantic.unknownQueryKeys.map((key) => `Query parameter “${key}” was ignored because Screenwalk could not prove that it changes the UI.`);
  const suggestions = reasons.map((reason) => ({
    action: "split" as const,
    reason: `${reason} Add it to query.include if it selects a meaningful screen state.`,
    confidence: 0.55,
  }));

  return {
    familyId,
    variantId: `variant:${shortHash(variantSeed)}`,
    routeTemplate,
    semanticUrlState: { query: semantic.query, hash: semantic.hash },
    presentation,
    review: {
      status: suggestions.length > 0 ? "needs-review" : "automatic",
      reasons,
      suggestions,
    },
  };
}

export function routeLookupKey(route: string, policy: IdentityPolicy = defaultIdentityPolicy): string {
  const semantic = semanticUrlState(route, policy);
  const query = new URLSearchParams(semantic.query).toString();
  return `${canonicalPath(pathnameOf(route))}${query ? `?${query}` : ""}${semantic.hash ? `#${semantic.hash}` : ""}`;
}

export function meaningfulRoute(route: string, policy: IdentityPolicy = defaultIdentityPolicy): string {
  return routeLookupKey(route, policy);
}

export function pathnameOf(route: string): string {
  try {
    return new URL(route, "http://screenwalk.local").pathname;
  } catch {
    return route.split(/[?#]/, 1)[0] || "/";
  }
}

export function semanticUrlState(route: string, policy: IdentityPolicy = defaultIdentityPolicy): {
  query: Record<string, string>;
  hash?: string;
  unknownQueryKeys: string[];
} {
  const url = new URL(route, "http://screenwalk.local");
  const included = new Set([...DEFAULT_MEANINGFUL_QUERY_KEYS, ...policy.query.include.map(normalizeKey)]);
  const ignored = new Set([...DEFAULT_IGNORED_QUERY_KEYS, ...policy.query.ignore.map(normalizeKey)]);
  const query: Record<string, string> = {};
  const unknownQueryKeys = new Set<string>();

  for (const [rawKey, value] of url.searchParams) {
    const key = normalizeKey(rawKey);
    if (SENSITIVE_QUERY_KEY.test(rawKey)) continue;
    if (rawKey.toLowerCase().startsWith("utm_") || ignored.has(key)) continue;
    if (included.has(key)) query[rawKey] = value;
    else if (TRANSIENT_QUERY_KEY.test(rawKey)) continue;
    else unknownQueryKeys.add(rawKey);
  }

  const hashValue = url.hash.replace(/^#/, "");
  const hashKey = normalizeKey(hashValue.split(/[=/]/, 1)[0] ?? "");
  const hash = hashValue && (
    (policy.hash.treatPathAsRoute && hashValue.startsWith("/")) ||
    policy.hash.include.map(normalizeKey).includes(hashKey)
  ) ? hashValue : undefined;

  return {
    query: Object.fromEntries(Object.entries(query).sort(([left], [right]) => left.localeCompare(right))),
    hash,
    unknownQueryKeys: [...unknownQueryKeys].sort(),
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
