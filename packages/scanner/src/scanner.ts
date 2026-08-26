import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  flowGraphSchema,
  type FlowGraph,
  type RepositoryService,
  type ScreenNode,
  type TransitionEdge,
} from "@screenbranch/schema";
import { inspectRepository, selectService } from "./topology.ts";

const PAGE_FILE = /^page\.(?:[jt]sx?)$/;
const ROUTE_STATE_FILE = /^(loading|error|not-found)\.(?:[jt]sx?)$/;
const NAVIGATION_PATTERN = /(?:href\s*=\s*["']([^"']+)["']|(?:router\.)?(?:push|replace)\(\s*["']([^"']+)["'])/g;

export async function scanRepository(projectRoot: string, serviceSelector?: string): Promise<FlowGraph> {
  const root = resolve(projectRoot);
  const topology = await inspectRepository(root);
  const service = selectService(topology, serviceSelector);
  if (!service) {
    const browserServices = topology.services.filter((candidate) => candidate.kind === "web" || candidate.kind === "admin");
    const choices = browserServices.map((candidate) => `${candidate.id} (${candidate.path})`).join(", ");
    if (serviceSelector) {
      const validChoices = topology.services.map((candidate) => `${candidate.id} (${candidate.path})`).join(", ");
      throw new Error(`Unknown service ${serviceSelector}. Choose one of: ${validChoices || "no detected services"}`);
    }
    throw new Error(browserServices.length === 0
      ? `No runnable web service was detected under ${root}`
      : `Multiple browser services detected. Choose one with --service: ${choices}`);
  }
  if (service.kind !== "web" && service.kind !== "admin") {
    throw new Error(`${service.id} is a ${service.kind} service, not a browser UI. Choose a web or admin service.`);
  }
  const serviceRoot = service.path === "." ? root : join(root, service.path);
  const graph = service.framework === "next"
    ? await scanNextApp(serviceRoot)
    : await browserSeedGraph(serviceRoot, service);
  const prefix = service.path === "." ? "" : `${service.path}/`;
  const withPrefix = (sourceFile?: string) => sourceFile && sourceFile !== "(browser discovery)" ? `${prefix}${sourceFile}` : sourceFile;
  return flowGraphSchema.parse({
    ...graph,
    project: {
      ...graph.project,
      name: topology.repository.name,
      root,
      service,
      topology,
    },
    nodes: graph.nodes.map((node) => ({ ...node, sourceFile: withPrefix(node.sourceFile) ?? node.sourceFile, evidence: node.evidence.map((item) => ({ ...item, sourceFile: withPrefix(item.sourceFile) })) })),
    edges: graph.edges.map((edge) => ({ ...edge, evidence: edge.evidence.map((item) => ({ ...item, sourceFile: withPrefix(item.sourceFile) })) })),
    gaps: graph.gaps.map((gap) => ({ ...gap, sourceFile: withPrefix(gap.sourceFile) })),
  });
}

async function browserSeedGraph(serviceRoot: string, service: RepositoryService): Promise<FlowGraph> {
  const sourceFile = await fileExists(join(serviceRoot, "index.html"))
    ? "index.html"
    : await fileExists(join(serviceRoot, "public", "index.html")) ? "public/index.html"
      : await fileExists(join(serviceRoot, "server.mjs")) ? "server.mjs" : "(browser discovery)";
  const staticEntry = sourceFile !== "(browser discovery)";
  return flowGraphSchema.parse({
    schemaVersion: "screenbranch.graph.v0",
    project: {
      name: service.name,
      root: serviceRoot,
      framework: "web",
      generatedAt: new Date().toISOString(),
    },
    nodes: [{
      id: "screen:root",
      title: "Home",
      route: "/",
      sourceFile,
      kind: "page",
      confidence: 1,
      persona: "default",
      diagnostics: [],
      evidence: [{
        kind: staticEntry ? "static" : "declared",
        detail: staticEntry ? `${service.framework === "html-server" ? "Server-rendered" : "Static"} HTML entry point` : `Browser entry point for ${service.framework ?? "web"}`,
        ...(staticEntry ? { sourceFile, line: 1 } : {}),
      }],
    }],
    edges: [],
    journeys: [],
    gaps: [],
  });
}

async function fileExists(path: string): Promise<boolean> {
  try { await readFile(path); return true; } catch { return false; }
}

export async function scanNextApp(projectRoot: string): Promise<FlowGraph> {
  const root = resolve(projectRoot);
  const appRoot = await findAppRoot(root);
  const files = await walk(appRoot);
  const pageFiles = files.filter((file) => PAGE_FILE.test(basename(file)));
  const pageSources = await Promise.all(pageFiles.map((file) => readFile(file, "utf8")));
  const pageNodes = pageFiles.map((file, index) => makeNode(root, appRoot, file, pageSources[index] ?? ""));
  const stateNodes = files
    .filter((file) => ROUTE_STATE_FILE.test(basename(file)))
    .map((file) => makeStateNode(root, appRoot, file));
  const nodes = [...pageNodes, ...stateNodes];
  const nodeByRoute = new Map(pageNodes.map((node) => [node.route, node]));
  const edges: TransitionEdge[] = [];
  const gaps: FlowGraph["gaps"] = [];

  for (const node of pageNodes) {
    const source = await readFile(join(root, node.sourceFile), "utf8");
    for (const match of source.matchAll(NAVIGATION_PATTERN)) {
      const targetRoute = match[1] ?? match[2];
      if (!targetRoute || !targetRoute.startsWith("/")) continue;
      const line = source.slice(0, match.index).split("\n").length;
      const target = nodeByRoute.get(stripQuery(targetRoute));
      if (!target) {
        gaps.push({
          id: `gap:${node.id}:${line}`,
          kind: "unresolved-target",
          detail: `Static navigation target ${targetRoute} has no matching App Router page.`,
          sourceFile: node.sourceFile,
          line,
        });
        continue;
      }

      const action = match[1] ? `Follow link to ${targetRoute}` : `Navigate to ${targetRoute}`;
      edges.push({
        id: `edge:${node.id}:${target.id}:${line}`,
        source: node.id,
        target: target.id,
        action,
        confidence: 0.86,
        evidence: [
          {
            kind: "static",
            detail: match[0],
            sourceFile: node.sourceFile,
            line,
          },
        ],
      });
    }
  }

  for (const node of stateNodes) {
    gaps.push({
      id: `gap:${node.id}:unobserved`,
      kind: "unobserved-state",
      detail: `${node.title} exists in source but has not been triggered in a browser capture.`,
      sourceFile: node.sourceFile,
      line: 1,
    });
  }

  const journeys = enumerateJourneys(pageNodes, edges);
  const graph: FlowGraph = {
    schemaVersion: "screenbranch.graph.v0",
    project: {
      name: basename(root),
      root,
      framework: "next-app-router",
      generatedAt: new Date().toISOString(),
    },
    nodes,
    edges,
    journeys,
    gaps,
  };

  return flowGraphSchema.parse(graph);
}

async function findAppRoot(root: string): Promise<string> {
  for (const candidate of [join(root, "app"), join(root, "src", "app")]) {
    try {
      const entries = await readdir(candidate);
      if (entries.length >= 0) return candidate;
    } catch {
      // Try the next framework convention.
    }
  }
  throw new Error(`No Next.js App Router directory found under ${root}`);
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return files.flat();
}

function makeNode(root: string, appRoot: string, file: string, source: string): ScreenNode {
  const route = routeFromPage(appRoot, file);
  const sourceFile = relative(root, file);
  return {
    id: route === "/" ? "screen:root" : `screen:${route.slice(1).replaceAll("/", ":")}`,
    title: titleFromSource(route, source),
    route,
    sourceFile,
    kind: "page",
    confidence: 0.92,
    persona: "default",
    stateKey: "default",
    identity: sourceIdentity(route, "default"),
    diagnostics: [],
    interactiveTargets: [],
    evidence: [
      {
        kind: "static",
        detail: "Next.js App Router page file",
        sourceFile,
        line: 1,
      },
    ],
  };
}

function makeStateNode(root: string, appRoot: string, file: string): ScreenNode {
  const state = basename(file).split(".")[0] as "loading" | "error" | "not-found";
  const route = routeFromPage(appRoot, file);
  const sourceFile = relative(root, file);
  const routeId = route === "/" ? "root" : route.slice(1).replaceAll("/", ":");
  const stateTitle = state === "not-found" ? "Not found" : state.charAt(0).toUpperCase() + state.slice(1);
  return {
    id: `screen:${routeId}:state:${state}`,
    title: `${titleFromRoute(route)} · ${stateTitle}`,
    route,
    sourceFile,
    kind: state,
    stateKey: state,
    confidence: 0.98,
    persona: "default",
    identity: sourceIdentity(route, state),
    diagnostics: [],
    interactiveTargets: [],
    evidence: [{ kind: "static", detail: `Next.js App Router ${state} state file`, sourceFile, line: 1 }],
  };
}

function sourceIdentity(route: string, stateKey: string): NonNullable<ScreenNode["identity"]> {
  const presentation = { kind: "page" as const, overlays: [], slots: [] };
  const familyId = `family:${shortIdentityHash(stableIdentityString({ routeTemplate: route, presentation }))}`;
  return {
    familyId,
    variantId: `variant:${shortIdentityHash(stableIdentityString({ familyId, query: {}, hash: undefined, stateKey, persona: "default" }))}`,
    routeTemplate: route,
    semanticUrlState: { query: {} },
    presentation,
    review: { status: "automatic", reasons: [], suggestions: [] },
  };
}

function stableIdentityString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableIdentityString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableIdentityString(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function shortIdentityHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function routeFromPage(appRoot: string, file: string): string {
  const directory = relative(appRoot, dirname(file));
  const segments = directory
    .split(sep)
    .filter((segment) => segment && !/^\(.+\)$/.test(segment) && !segment.startsWith("@"));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function titleFromRoute(route: string): string {
  if (route === "/") return "Home";
  const segment = route.split("/").filter(Boolean).at(-1) ?? "Screen";
  return segment
    .replace(/[\[\]]/g, "")
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function titleFromSource(route: string, source: string): string {
  if (!route.includes("[")) return titleFromRoute(route);
  const componentName = source.match(/export\s+default\s+(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]*)/)?.[1];
  const semanticName = componentName?.replace(/(?:Page|Screen|View)$/, "");
  if (!semanticName) return titleFromRoute(route);
  return semanticName.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function stripQuery(route: string): string {
  return route.split(/[?#]/, 1)[0] || "/";
}

function enumerateJourneys(
  nodes: ScreenNode[],
  edges: TransitionEdge[],
): FlowGraph["journeys"] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Set(edges.map((edge) => edge.target));
  const roots = nodes.filter((node) => !incoming.has(node.id));
  const outgoing = new Map<string, TransitionEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }

  const paths: string[][] = [];
  const visit = (nodeId: string, path: string[]) => {
    if (path.includes(nodeId) || path.length >= 12) {
      paths.push(path);
      return;
    }
    const nextPath = [...path, nodeId];
    const nextEdges = outgoing.get(nodeId) ?? [];
    if (nextEdges.length === 0) {
      paths.push(nextPath);
      return;
    }
    for (const edge of nextEdges) visit(edge.target, nextPath);
  };

  for (const root of roots.length > 0 ? roots : nodes.slice(0, 1)) visit(root.id, []);
  return paths.map((nodeIds, index) => {
    const first = nodeById.get(nodeIds[0] ?? "");
    const last = nodeById.get(nodeIds.at(-1) ?? "");
    const title = nodeIds.length <= 1
      ? first?.title ?? `Path ${index + 1}`
      : `${first?.title ?? "Start"} → ${last?.title ?? "Screen"}`;
    return {
      id: `journey:${index + 1}`,
      title,
      nodeIds,
      kind: "static" as const,
      provenance: "static-candidate" as const,
    };
  });
}
