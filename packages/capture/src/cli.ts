#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  appendDiagnostic,
  clusterDiagnostics,
  flowGraphSchema,
  identityPolicySchema,
  journeyRecipeSchema,
  journeyRunReceiptSchema,
  setupRecipeSchema,
  type Diagnostic,
  type FlowGraph,
  type InteractiveTarget,
  type IdentityPolicy,
  type Journey,
  type JourneyRecipe,
  type JourneyRunReceipt,
  type SetupRecipe,
  type ScreenNode,
  type TerminalAssertion,
  type TransitionEdge,
  type TransitionCondition,
} from "@screenbranch/schema";
import { pickEntryCta } from "./entry-cta.js";
import { ensurePersonaGraph } from "./persona.js";
import { composeObservedJourneys } from "./journeys.js";
import { canonicalPath, limitCapturableRoutes, runtimeEvidenceCount } from "./routes.js";
import { collapseDynamicRouteInstances, matchingRouteTemplate } from "./route-families.js";
import { buildScreenIdentity, defaultIdentityPolicy, meaningfulRoute, pathnameOf, routeLookupKey, semanticUrlState } from "./identity.js";
import { assessPageSnapshot, COLLECT_PAGE_QUALITY_SCRIPT, type PageQuality } from "./page-quality.js";
import { unsafePath } from "./route-safety.js";

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
const [, , command, ...rawArgs] = process.argv;
const [graphArg, ...args] = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

if ((command !== "capture" && command !== "record") || !graphArg) {
  console.error("Usage: screenwalk <capture|record> <graph.json> --base-url <url> --assets-dir <dir> --asset-prefix <path> --out <graph.json> [--routes /,/profile] [--recipe recipe.json] [--receipts-dir path] [--setup setup.json] [--identity-policy screenwalk.identity.json] [--discover-links] [--timing-json path]");
  process.exit(2);
}

const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const graphPath = resolve(graphArg);
const outputPath = resolve(option("--out") ?? graphPath);
const assetsDirectory = resolve(option("--assets-dir") ?? "screenbranch-captures");
const assetPrefix = (option("--asset-prefix") ?? "/screenbranch-captures").replace(/\/$/, "");
const baseUrl = option("--base-url");
const requestedRoutes = new Set((option("--routes") ?? "").split(",").filter(Boolean));
const recipePath = option("--recipe");
const setupPath = option("--setup");
const identityPolicyPath = option("--identity-policy");
const discoverLinks = args.includes("--discover-links");
const expandRoutes = args.includes("--expand-routes");
const maxScreens = Number(option("--max-screens") ?? "30");
const discoverDepth = Number(option("--discover-depth") ?? "1");
const viewportName = option("--viewport") ?? "desktop";
const timingOutputPath = option("--timing-json");
const receiptsDirectory = resolve(option("--receipts-dir") ?? resolve(dirname(outputPath), "journey-runs"));

type TimingEvent = {
  stage: string;
  label: string;
  durationMs: number;
};

class JourneyVerificationError extends Error {}

const timingEvents: TimingEvent[] = [];

if (!Number.isInteger(discoverDepth) || discoverDepth < 1) {
  console.error("--discover-depth must be a positive integer");
  process.exit(2);
}
if (!Number.isInteger(maxScreens) || maxScreens < 1) {
  console.error("--max-screens must be a positive integer");
  process.exit(2);
}

if (viewportName !== "desktop" && viewportName !== "mobile") {
  console.error("--viewport must be desktop or mobile");
  process.exit(2);
}
const activeViewport = VIEWPORTS[viewportName];

if (!baseUrl) {
  console.error("--base-url is required");
  process.exit(2);
}

const setupRecipe = setupPath
  ? setupRecipeSchema.parse(JSON.parse(await readFile(resolve(setupPath), "utf8"))) as SetupRecipe
  : undefined;
if (setupRecipe) assertSetupEnvironment(setupRecipe);
const identityPolicy: IdentityPolicy = identityPolicyPath
  ? identityPolicySchema.parse(JSON.parse(await readFile(resolve(identityPolicyPath), "utf8")))
  : defaultIdentityPolicy;
const sourceGraph = collapseDynamicRouteInstances(flowGraphSchema.parse(JSON.parse(await readFile(graphPath, "utf8"))) as FlowGraph, identityPolicy);
const personaGraph = setupRecipe ? ensurePersonaGraph(sourceGraph, setupRecipe.persona, setupRecipe.label) : sourceGraph;
const parsed = applyIdentityModel(personaGraph, identityPolicy);
const activePersona = setupRecipe?.persona ?? "default";
const capturableNodes = limitCapturableRoutes(parsed.nodes.filter((node) => {
  if (requestedRoutes.size > 0 && !requestedRoutes.has(node.route)) return false;
  if (viewportName !== "desktop" && node.sourceFile === "(browser discovery)" && !node.captureVariants?.desktop) return false;
  return node.persona === activePersona && node.stateKey === "default" && !node.route.includes("[") && !unsafePath(node.route);
}), maxScreens);

await mkdir(assetsDirectory, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: activeViewport, deviceScaleFactor: 1 });

try {
  if (setupRecipe) await establishSession(context, setupRecipe);
  if (command === "record") {
    if (!recipePath) throw new Error("--recipe is required for record");
    const recipe = journeyRecipeSchema.parse(JSON.parse(await readFile(resolve(recipePath), "utf8"))) as JourneyRecipe;
    const graph = await recordJourneys(context, parsed, recipe);
    await persistGraph(graph);
    await persistTimings();
    console.log(`Recorded ${recipe.journeys.length} observed journeys into ${outputPath}`);
    printTimingSummary();
    process.exitCode = 0;
  } else {
    const captures = new Map<string, ScreenNode>();
    for (const node of capturableNodes) {
      const page = await context.newPage();
      const diagnostics: Diagnostic[] = [];
      attachDiagnostics(page, diagnostics, node.id);
      const targetUrl = new URL(node.route, baseUrl).toString();
      const observedAt = new Date().toISOString();

      try {
        await measure("capture.navigate", node.route, () => page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }));
        await measure("capture.settle", node.route, () => settlePage(page));
      } catch (error) {
        diagnostics.push(makeDiagnostic(node.id, "page-error", "error", error instanceof Error ? error.message : String(error), targetUrl));
      }

      const quality = await measure("capture.quality", node.route, () => waitForMeaningfulPage(page));
      if (quality !== "ready") diagnostics.push(makeDiagnostic(node.id, "capture-quality", "warning", quality === "loading" ? "Page remained in a loading state after the capture timeout." : "Page rendered without enough visible content to identify a useful screen.", page.url()));

      const filename = `${safeName(node.route)}-${viewportName}-${shortHash(node.id)}.png`;
      await measure("capture.screenshot", node.route, () => page.screenshot({ path: resolve(assetsDirectory, filename), fullPage: false }));
      const contentHash = shortHash(await readFile(resolve(assetsDirectory, filename), "base64"));
      const inventoriedTargets = await measure("capture.interactions", node.route, () => inventoryInteractiveTargets(page, node.id));
      const interactiveTargets = carryFailedInteractionEvidence(node.interactiveTargets, inventoriedTargets);
      const finalUrl = sanitizePersistedUrl(page.url() || targetUrl);
      const title = await page.title().catch(() => "");
      const presentation = await inspectPresentation(page);
      const identity = preserveIdentityReview(buildScreenIdentity({
        route: finalUrl,
        routeTemplate: node.identity?.routeTemplate ?? node.route,
        persona: node.persona,
        stateKey: node.stateKey,
        presentation,
        policy: identityPolicy,
      }), node.identity);
      const contextEvidence = await captureContext(page, node.persona);
      const capture = {
        kind: "captured" as const,
        quality,
        asset: `${assetPrefix}/${filename}`,
        url: finalUrl,
        title,
        observedAt,
        contentHash,
        captureId: `capture:${shortHash(JSON.stringify({ variantId: identity.variantId, context: contextEvidence, contentHash }))}`,
        context: contextEvidence,
        viewport: activeViewport,
      };
      captures.set(node.id, {
        ...node,
        identity,
        capture: viewportName === "desktop" ? capture : node.capture ?? capture,
        captureVariants: { ...node.captureVariants, [viewportName]: capture },
        diagnostics,
        interactiveTargets,
        evidence: [
          ...node.evidence,
          { kind: "observed", detail: `Browser capture of ${finalUrl}` },
        ],
      });
      console.log(`${node.route} -> ${filename} (${diagnostics.length} diagnostics)`);
      await page.close();
    }

    let graph = flowGraphSchema.parse({
      ...parsed,
      project: { ...parsed.project, generatedAt: new Date().toISOString() },
      nodes: parsed.nodes.map((node) => captures.get(node.id) ?? node),
    });
    if (discoverLinks) graph = await observeSafeLinks(context, graph, { discoverDepth, expandRoutes, maxScreens, persona: activePersona });
    graph = applyObservedInteractionReceipts(normalizeDevelopmentDiagnostics(clusterGraphDiagnostics(graph)));
    await persistGraph(graph);
    await persistTimings();
    const observedEdges = graph.edges.filter((edge) => (edge.observations?.length ?? 0) > 0).length;
    const readyScreens = graph.nodes.filter((node) => node.persona === activePersona && node.captureVariants?.[viewportName]?.quality === "ready").length;
    console.log(`Captured ${readyScreens} real screens and ${observedEdges} observed links into ${outputPath}`);
    printTimingSummary();
  }
} finally {
  const contextClosed = await closeWithin("browser context", () => context.close());
  const browserClosed = await closeWithin("browser process", () => browser.close());
  if (!contextClosed || !browserClosed) {
    console.warn("Capture evidence is saved. Exiting after browser cleanup exceeded 5 seconds.");
    process.exit(process.exitCode ?? 0);
  }
}

async function closeWithin(label: string, close: () => Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    close().then(() => true).catch((error: unknown) => {
      console.warn(`Could not close ${label}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }),
    new Promise<false>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), 5_000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (!completed) console.warn(`${label} cleanup exceeded 5 seconds.`);
  return completed;
}

function assertSetupEnvironment(recipe: SetupRecipe): void {
  const missing = [...new Set(recipe.actions.flatMap((action) =>
    action.type === "fill" && !process.env[action.valueFromEnv] ? [action.valueFromEnv] : [],
  ))];
  if (missing.length === 0) return;
  console.error(`SB_SETUP_ENV_MISSING: ${recipe.label} needs ${missing.join(", ")}. Set ${missing.length === 1 ? "it" : "them"} in the command environment, then rerun the same command.`);
  process.exit(2);
}

async function establishSession(context: BrowserContext, recipe: SetupRecipe): Promise<void> {
  if (!baseUrl) throw new Error("--base-url is required");
  const page = await context.newPage();
  console.log(`Access   ${recipe.label}`);
  try {
    await page.goto(new URL(recipe.startRoute, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    for (const [index, action] of recipe.actions.entries()) {
      try {
        if (action.type === "waitForRoute") {
          await page.waitForURL((url) => routeLookupKey(url.toString(), identityPolicy) === routeLookupKey(action.route, identityPolicy), { timeout: 10_000 });
          continue;
        }
        const locator = action.locator.kind === "label"
          ? page.getByLabel(action.locator.name, { exact: true })
          : page.getByRole(action.locator.role, { name: action.locator.name, exact: true });
        await locator.waitFor({ state: "visible", timeout: 10_000 });
        if (action.type === "fill") await locator.fill(process.env[action.valueFromEnv] ?? "");
        else await locator.click();
      } catch (error) {
        const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
        throw new Error(`Access setup action ${index + 1} (${action.type}) failed: ${reason}`);
      }
    }
    console.log(`      ✓ Session ready for ${recipe.label}`);
  } finally {
    await page.close();
  }
}

async function recordJourneys(context: BrowserContext, input: FlowGraph, recipe: JourneyRecipe): Promise<FlowGraph> {
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  const nodeByRoute = new Map(input.nodes.filter((node) => node.persona === activePersona && node.stateKey === "default").map((node) => [routeLookupKey(node.route, identityPolicy), node]));
  const edges = [...input.edges];
  const journeys: Journey[] = input.journeys.filter((journey) => !recipe.journeys.some((candidate) => candidate.id === journey.id));
  const observedJourneys: Journey[] = [];

  for (const journeyRecipe of recipe.journeys) {
    const page = await context.newPage();
    const startedAt = new Date().toISOString();
    const recipeHash = createHash("sha256").update(JSON.stringify(journeyRecipe)).digest("hex");
    const safeJourneyId = journeyRecipe.id.replace(/[^a-zA-Z0-9._-]/g, "-");
    const runId = `${safeJourneyId}-${startedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${randomUUID().slice(0, 8)}`;
    let activeNode = requireNode(nodeByRoute, routeLookupKey(journeyRecipe.startRoute, identityPolicy));
    const diagnosticsByNode = new Map<string, Diagnostic[]>();
    attachDiagnostics(page, [], activeNode.id, () => activeNode.id, diagnosticsByNode);
    const nodeIds = [activeNode.id];
    const edgeIds: string[] = [];
    let status: JourneyRunReceipt["status"] = "passed";
    let assertionResult: JourneyRunReceipt["assertionResult"];
    let runError: unknown;
    let receiptPath = "";

    try {
      await measure("record.navigate", journeyRecipe.startRoute, () => page.goto(new URL(journeyRecipe.startRoute, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 15_000 }));
      await measure("record.settle", journeyRecipe.startRoute, () => settlePage(page));
      nodes.set(activeNode.id, await captureNode(page, activeNode, diagnosticsByNode.get(activeNode.id) ?? [], `${journeyRecipe.id}-0`));

      for (const [index, step] of journeyRecipe.steps.entries()) {
        const sourceNode = activeNode;
        const fromUrl = sanitizePersistedUrl(page.url());
        const startedAt = Date.now();
        const locator = page.getByRole(step.trigger.role, { name: step.trigger.name, exact: true });
        await measure("record.interact", `${sourceNode.route} -> ${step.targetRoute}`, async () => {
          await locator.waitFor({ state: "visible", timeout: 10_000 });
          await locator.click();
          if (step.targetPresentation) {
            try {
              await page.getByRole(step.targetPresentation.role, { name: step.targetPresentation.name, exact: true }).waitFor({ state: "visible", timeout: 10_000 });
            } catch {
              throw new JourneyVerificationError(`Expected visible ${step.targetPresentation.kind} \"${step.targetPresentation.name}\" on ${step.targetRoute}`);
            }
            if (routeLookupKey(page.url(), identityPolicy) !== routeLookupKey(step.targetRoute, identityPolicy)) {
              throw new JourneyVerificationError(`Expected overlay on route ${step.targetRoute}; browser reached ${meaningfulRoute(page.url(), identityPolicy)}`);
            }
          } else {
            try {
              await page.waitForURL((url) => routeLookupKey(url.toString(), identityPolicy) === routeLookupKey(step.targetRoute, identityPolicy), { timeout: 10_000 });
            } catch {
              throw new JourneyVerificationError(`Expected route ${step.targetRoute}; browser remained at ${meaningfulRoute(page.url(), identityPolicy)}`);
            }
          }
        });
        const targetNode = step.targetPresentation
          ? await observedPresentationNode(page, sourceNode, step.targetRoute, step.targetPresentation)
          : requireNode(nodeByRoute, routeLookupKey(step.targetRoute, identityPolicy));
        if (step.targetPresentation) nodes.set(targetNode.id, targetNode);
        activeNode = targetNode;
        await measure("record.settle", step.targetRoute, () => settlePage(page));
        const durationMs = Date.now() - startedAt;
        nodes.set(activeNode.id, await captureNode(page, activeNode, diagnosticsByNode.get(activeNode.id) ?? [], `${journeyRecipe.id}-${index + 1}`));

        const edge = upsertObservedEdge(edges, sourceNode, targetNode, {
          observedAt: new Date().toISOString(),
          fromUrl,
          toUrl: sanitizePersistedUrl(page.url()),
          durationMs,
          trigger: { kind: "click", ...step.trigger },
        }, step.conditions, step.conditionLogic);
        nodes.set(sourceNode.id, markInteractionObserved(nodes.get(sourceNode.id) ?? sourceNode, step.trigger.role, step.trigger.name));
        edgeIds.push(edge.id);
        nodeIds.push(targetNode.id);
        const targetLabel = step.targetPresentation ? `${targetNode.route} [${step.targetPresentation.kind}: ${step.targetPresentation.name}]` : targetNode.route;
        console.log(`${journeyRecipe.title}: ${sourceNode.route} --click ${step.trigger.name}--> ${targetLabel}`);
      }
      if (journeyRecipe.terminalAssertion) {
        assertionResult = await evaluateTerminalAssertion(page, journeyRecipe.terminalAssertion);
        if (!assertionResult.passed) throw new JourneyVerificationError(assertionResult.detail);
      }
    } catch (error) {
      runError = error;
      status = error instanceof JourneyVerificationError ? "failed" : "errored";
    } finally {
      const completedAt = new Date().toISOString();
      receiptPath = resolve(receiptsDirectory, `${runId}.json`);
      const receipt = journeyRunReceiptSchema.parse({
        schemaVersion: "screenwalk.journey-run.v0",
        runId,
        journeyId: journeyRecipe.id,
        title: journeyRecipe.title,
        recipeHash,
        status,
        startedAt,
        completedAt,
        persona: activePersona,
        viewport: viewportName,
        browser: { name: "chromium", version: browser.version() },
        startRoute: journeyRecipe.startRoute,
        finalRoute: meaningfulRoute(page.url(), identityPolicy),
        nodeIds,
        edgeIds,
        asserted: Boolean(journeyRecipe.terminalAssertion),
        terminalAssertion: journeyRecipe.terminalAssertion,
        assertionResult,
        diagnosticsCount: [...diagnosticsByNode.values()].reduce((total, diagnostics) => total + diagnostics.length, 0),
        artifacts: {
          graph: outputPath,
          screenshots: nodeIds.flatMap((nodeId) => {
            const asset = nodes.get(nodeId)?.capture?.asset;
            return asset ? [resolve(assetsDirectory, basename(asset))] : [];
          }),
          trace: null,
        },
        conditions: journeyRecipe.steps.flatMap((step) => step.conditions ?? []),
        error: runError instanceof Error ? runError.message.split("\n")[0] : runError ? String(runError) : undefined,
      });
      await mkdir(receiptsDirectory, { recursive: true });
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      await page.close();
    }

    if (runError) throw runError;

    observedJourneys.push({
      id: journeyRecipe.id,
      title: journeyRecipe.title,
      kind: "observed",
      provenance: journeyRecipe.terminalAssertion ? "verified-end-to-end" : "recorded-unverified",
      verification: { status, asserted: Boolean(journeyRecipe.terminalAssertion), completedAt: new Date().toISOString(), receipt: receiptPath },
      nodeIds,
      edgeIds,
    });
  }

  return applyObservedInteractionReceipts(flowGraphSchema.parse({
    ...input,
    project: { ...input.project, generatedAt: new Date().toISOString() },
    nodes: [...nodes.values()],
    edges,
    journeys: [...observedJourneys, ...journeys],
  }));
}

async function observedPresentationNode(
  page: Page,
  source: ScreenNode,
  targetRoute: string,
  target: NonNullable<JourneyRecipe["journeys"][number]["steps"][number]["targetPresentation"]>,
): Promise<ScreenNode> {
  const presentation = await inspectPresentation(page);
  if (presentation.kind !== target.kind) {
    throw new JourneyVerificationError(`Expected ${target.kind} \"${target.name}\"; browser evidence identified ${presentation.kind}`);
  }
  const expectedOverlay = `${target.kind === "modal" ? "dialog" : target.kind}:${target.name}`;
  if (!presentation.overlays.includes(expectedOverlay)) {
    throw new JourneyVerificationError(`Expected ${target.kind} \"${target.name}\"; captured overlays were ${presentation.overlays.join(", ") || "none"}`);
  }
  const route = meaningfulRoute(targetRoute, identityPolicy);
  const id = `screen:runtime:${shortHash(`${route}:${activePersona}:${target.kind}:${target.name}`)}`;
  const identity = buildScreenIdentity({
    route,
    routeTemplate: source.identity?.routeTemplate ?? pathnameOf(route),
    persona: activePersona,
    stateKey: target.kind,
    presentation,
    policy: identityPolicy,
  });
  return {
    id,
    title: `${source.title} · ${target.name}`,
    route,
    sourceFile: source.sourceFile,
    kind: target.kind,
    stateKey: target.kind,
    confidence: 1,
    persona: activePersona,
    identity,
    diagnostics: [],
    interactiveTargets: [],
    evidence: [{ kind: "observed", detail: `Visible ${target.kind} \"${target.name}\" after an explicit journey action` }],
  };
}

function upsertObservedEdge(
  edges: TransitionEdge[],
  source: ScreenNode,
  target: ScreenNode,
  observation: Omit<NonNullable<TransitionEdge["observations"]>[number], "id">,
  conditions?: TransitionCondition[],
  conditionLogic: "all" | "any" = "all",
): TransitionEdge {
  const existing = edges.find((edge) => edge.source === source.id && edge.target === target.id);
  const receipt = { ...observation, id: `observation:${shortHash(`${source.id}:${target.id}:${observation.observedAt}`)}` };
  if (existing) {
    if (conditions?.length) {
      existing.conditions = conditions;
      existing.conditionLogic = conditionLogic;
    }
    existing.observations = [...(existing.observations ?? []), receipt].slice(-5);
    existing.confidence = 1;
    const detail = `Clicked ${observation.trigger.role} \"${observation.trigger.name}\" from ${observation.fromUrl} to ${observation.toUrl}`;
    if (!existing.evidence.some((candidate) => candidate.kind === "observed" && candidate.detail === detail)) {
      existing.evidence = [...existing.evidence, { kind: "observed", detail }];
    }
    return existing;
  }

  const edge: TransitionEdge = {
    id: `edge:observed:${source.id}:${target.id}:${shortHash(observation.trigger.name)}`,
    source: source.id,
    target: target.id,
    action: `Click ${observation.trigger.name}`,
    conditions,
    conditionLogic,
    confidence: 1,
    observations: [receipt],
    evidence: [{ kind: "observed", detail: `Clicked ${observation.trigger.role} \"${observation.trigger.name}\" from ${observation.fromUrl} to ${observation.toUrl}` }],
  };
  edges.push(edge);
  return edge;
}

async function evaluateTerminalAssertion(page: Page, assertion: TerminalAssertion): Promise<NonNullable<JourneyRunReceipt["assertionResult"]>> {
  const locator = assertion.type === "visible-text"
    ? page.getByText(assertion.text, { exact: false }).first()
    : assertion.type === "visible-role"
      ? page.getByRole(assertion.role, { name: assertion.name, exact: true }).first()
      : page.getByTestId(assertion.value).first();
  const label = assertion.type === "visible-text"
    ? `visible text "${assertion.text}"`
    : assertion.type === "visible-role"
      ? `visible ${assertion.role} "${assertion.name}"`
      : `visible test id "${assertion.value}"`;
  try {
    await locator.waitFor({ state: "visible", timeout: 5_000 });
    return { passed: true, detail: `Found ${label}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { passed: false, detail: `Expected ${label}. ${reason}` };
  }
}

async function captureNode(page: Page, node: ScreenNode, diagnostics: Diagnostic[], suffix: string, timingPrefix = "record"): Promise<ScreenNode> {
  const observedAt = new Date().toISOString();
  const quality = await measure(`${timingPrefix}.quality`, node.route, () => waitForMeaningfulPage(page));
  if (quality !== "ready") diagnostics.push(makeDiagnostic(node.id, "capture-quality", "warning", quality === "loading" ? "Page remained in a loading state after the capture timeout." : "Page rendered without enough visible content to identify a useful screen.", page.url()));
  const filename = `${safeName(node.route)}-${viewportName}-${shortHash(suffix)}.png`;
  await measure(`${timingPrefix}.screenshot`, node.route, () => page.screenshot({ path: resolve(assetsDirectory, filename), fullPage: false }));
  const contentHash = shortHash(await readFile(resolve(assetsDirectory, filename), "base64"));
  const interactiveTargets = await measure(`${timingPrefix}.interactions`, node.route, () => inventoryInteractiveTargets(page, node.id));
  const url = sanitizePersistedUrl(page.url());
  const presentation = await inspectPresentation(page);
  const identity = preserveIdentityReview(buildScreenIdentity({
    route: url,
    routeTemplate: node.identity?.routeTemplate ?? node.route,
    persona: node.persona,
    stateKey: node.stateKey,
    presentation,
    policy: identityPolicy,
  }), node.identity);
  const contextEvidence = await captureContext(page, node.persona);
  const capture = {
    kind: "captured" as const,
    quality,
    asset: `${assetPrefix}/${filename}`,
    url,
    title: await page.title().catch(() => ""),
    observedAt,
    contentHash,
    captureId: `capture:${shortHash(JSON.stringify({ variantId: identity.variantId, context: contextEvidence, contentHash }))}`,
    context: contextEvidence,
    viewport: activeViewport,
  };
  return {
    ...node,
    identity,
    capture: viewportName === "desktop" ? capture : node.capture ?? capture,
    captureVariants: { ...node.captureVariants, [viewportName]: capture },
    diagnostics,
    interactiveTargets,
    evidence: [...node.evidence, { kind: "observed", detail: `Browser capture of ${url}` }],
  };
}

async function observeSafeLinks(context: BrowserContext, input: FlowGraph, options: { discoverDepth: number; expandRoutes: boolean; maxScreens: number; persona: string }): Promise<FlowGraph> {
  if (!baseUrl) throw new Error("--base-url is required");
  const origin = new URL(baseUrl);
  const nodes = [...input.nodes];
  const nodeByRoute = new Map(nodes.filter((node) => node.persona === options.persona && node.stateKey === "default").map((node) => [routeLookupKey(node.route, identityPolicy), node]));
  const edges = [...input.edges];
  const queue = nodes.filter((node) => node.persona === options.persona && node.stateKey === "default" && node.capture && !node.route.includes("[")).map((node) => ({ node, depth: 0 }));
  for (let sourceIndex = 0; sourceIndex < queue.length; sourceIndex += 1) {
    const queuedSource = queue[sourceIndex];
    if (!queuedSource || queuedSource.depth >= options.discoverDepth) continue;
    let source = queuedSource.node;
    const { depth } = queuedSource;
    const page = await context.newPage();
    try {
      const sourceUrl = new URL(source.route, baseUrl).toString();
      await measure("discover.navigate", source.route, () => page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }));
      await measure("discover.settle", source.route, () => settlePage(page));
      const candidates = await measure("discover.inspect", source.route, () => page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor, index) => ({
        index,
        href: (anchor as HTMLAnchorElement).href,
        name: (anchor.textContent ?? "").replace(/\s+/g, " ").trim() || (anchor.getAttribute("aria-label") ?? "Link"),
      }))));
      const seenTargets = new Set<string>();

      for (const candidate of candidates) {
        const url = new URL(candidate.href);
        if (url.origin !== origin.origin || unsafePath(url.pathname)) continue;
        const candidateSemanticState = semanticUrlState(url.toString(), identityPolicy);
        if (candidateSemanticState.unknownQueryKeys.length > 0) {
          source = markUnknownIdentityState(source, candidateSemanticState.unknownQueryKeys);
          const sourceIndexInNodes = nodes.findIndex((node) => node.id === source.id);
          if (sourceIndexInNodes >= 0) nodes[sourceIndexInNodes] = source;
        }
        const canonicalTargetPath = canonicalPath(url.pathname);
        const targetRoute = meaningfulRoute(url.toString(), identityPolicy);
        const targetKey = routeLookupKey(targetRoute, identityPolicy);
        const templateRoute = matchingRouteTemplate(nodes.filter((node) => node.persona === options.persona).map((node) => pathnameOf(node.route)), canonicalTargetPath);
        const hasSemanticUrlState = targetKey !== canonicalTargetPath;
        let target = nodeByRoute.get(targetKey) ?? (!hasSemanticUrlState && templateRoute ? nodeByRoute.get(routeLookupKey(templateRoute, identityPolicy)) : undefined);
        if (!target && options.expandRoutes && runtimeEvidenceCount(nodes, options.persona) < options.maxScreens) {
          target = runtimeNode(targetRoute, options.persona, templateRoute);
          nodes.push(target);
          nodeByRoute.set(routeLookupKey(target.route, identityPolicy), target);
        }
        if (!target || target.id === source.id || seenTargets.has(target.id)) continue;
        seenTargets.add(target.id);

        await measure("discover.navigate", source.route, () => page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }));
        const linkReady = await measure("discover.link-ready", `${source.route} -> ${targetRoute}`, async () => {
          try {
            await page.waitForFunction(({ index, href }) => {
              const anchor = document.querySelectorAll<HTMLAnchorElement>("a[href]")[index];
              return anchor?.href === href;
            }, { index: candidate.index, href: candidate.href }, { timeout: 1_500 });
            return true;
          } catch {
            return false;
          }
        });
        if (!linkReady) await measure("discover.settle-fallback", source.route, () => settlePage(page));
        const links = page.locator("a[href]");
        if (candidate.index >= await links.count()) continue;
        const link = links.nth(candidate.index);
        if (await link.evaluate((anchor) => (anchor as HTMLAnchorElement).href) !== candidate.href) continue;
        const fromUrl = sanitizePersistedUrl(page.url());
        const sourceSignature = await renderedContentSignature(page);
        const startedAt = Date.now();
        try {
          await measure("discover.interact", `${source.route} -> ${targetRoute}`, async () => {
            await link.click({ timeout: 5_000 });
            await page.waitForURL((next) => next.origin === origin.origin && routeLookupKey(next.toString(), identityPolicy) === targetKey, { timeout: 10_000 });
          });
          await measure("discover.settle", targetRoute, () => settlePage(page));
          if (await renderedContentSignature(page) === sourceSignature) {
            throw new Error("the destination rendered the same title and body content as its source");
          }
        } catch (error) {
          const sourceIndexInNodes = nodes.findIndex((node) => node.id === source.id);
          if (sourceIndexInNodes >= 0) nodes[sourceIndexInNodes] = markInteractionFailed(nodes[sourceIndexInNodes] ?? source, candidate.name, candidate.href, error);
          console.warn(`${source.route} --withheld ${candidate.name}--> ${targetRoute}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        if (!target.capture) {
          const capturedTarget = await captureNode(page, target, [], `auto-${shortHash(target.id)}`, "discover");
          const targetIndex = nodes.findIndex((node) => node.id === target?.id);
          nodes[targetIndex] = capturedTarget;
          nodeByRoute.set(routeLookupKey(capturedTarget.route, identityPolicy), capturedTarget);
          target = capturedTarget;
          if (depth + 1 < options.discoverDepth) queue.push({ node: capturedTarget, depth: depth + 1 });
        }
        const edge = upsertObservedEdge(edges, source, target, {
          observedAt: new Date().toISOString(),
          fromUrl,
          toUrl: sanitizePersistedUrl(page.url()),
          durationMs: Date.now() - startedAt,
          trigger: { kind: "click", role: "link", name: candidate.name },
        });
        const sourceIndexInNodes = nodes.findIndex((node) => node.id === source.id);
        if (sourceIndexInNodes >= 0) {
          nodes[sourceIndexInNodes] = markInteractionObserved(nodes[sourceIndexInNodes] ?? source, "link", candidate.name, candidate.href);
        }
        console.log(`${source.route} --click ${candidate.name}--> ${target.route}`);
      }
      if (depth === 0 && pathnameOf(source.route) === "/") {
        const afterCta = await observeEntryPrimaryCta(page, source, nodes, nodeByRoute, edges, options);
        if (afterCta) source = afterCta;
      }
    } catch (error) {
      console.warn(`Could not explore ${source.route}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await page.close();
    }
  }

  const retainedJourneys = input.journeys.filter((journey) => journey.kind !== "observed" || !journey.id.startsWith("journey:auto:"));
  const observedJourneys = composeObservedJourneys(nodes, edges, options.persona);
  return flowGraphSchema.parse({ ...input, nodes, edges, journeys: [...observedJourneys, ...retainedJourneys] });
}

async function observeEntryPrimaryCta(
  page: Page,
  source: ScreenNode,
  nodes: ScreenNode[],
  nodeByRoute: Map<string, ScreenNode>,
  edges: TransitionEdge[],
  options: { expandRoutes: boolean; maxScreens: number; persona: string },
): Promise<ScreenNode | undefined> {
  if (!baseUrl) return undefined;
  const origin = new URL(baseUrl);
  const sourceUrl = new URL(source.route, baseUrl).toString();
  await measure("discover.navigate", source.route, () => page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }));
  await measure("discover.settle", source.route, () => settlePage(page));
  const buttons = await page.locator("button, [role=button], input[type=submit]").evaluateAll((elements) => elements.flatMap((element) => {
    const html = element as HTMLElement;
    const style = getComputedStyle(html);
    const rect = html.getBoundingClientRect();
    if (style.visibility === "hidden" || style.display === "none" || rect.width === 0 || rect.height === 0) return [];
    const type = (html as HTMLButtonElement).type || html.getAttribute("type") || undefined;
    const name = (html.getAttribute("aria-label") || html.textContent || (html as HTMLInputElement).value || "Button").replace(/\s+/g, " ").trim().slice(0, 80);
    return [{ name: name || "Button", role: "button" as const, type, disabled: (html as HTMLButtonElement).disabled || html.getAttribute("aria-disabled") === "true" }];
  }));
  const cta = pickEntryCta(buttons);
  if (!cta) return source;

  const fromUrl = sanitizePersistedUrl(page.url());
  const sourceSignature = await renderedContentSignature(page);
  const startedAt = Date.now();
  try {
    await measure("discover.interact", `${source.route} -> entry-cta`, async () => {
      await page.getByRole("button", { name: cta.name, exact: true }).click({ timeout: 5_000 });
      await page.waitForURL((next) => next.origin === origin.origin && routeLookupKey(next.toString(), identityPolicy) !== routeLookupKey(sourceUrl, identityPolicy), { timeout: 10_000 });
    });
    await measure("discover.settle", "entry-cta", () => settlePage(page));
    if (await renderedContentSignature(page) === sourceSignature) {
      throw new Error("the destination rendered the same title and body content as its source");
    }
  } catch (error) {
    const sourceIndex = nodes.findIndex((node) => node.id === source.id);
    if (sourceIndex >= 0) nodes[sourceIndex] = markInteractionFailed(nodes[sourceIndex] ?? source, cta.name, undefined, error);
    console.warn(`${source.route} --withheld ${cta.name}--> entry CTA: ${error instanceof Error ? error.message : String(error)}`);
    return nodes.find((node) => node.id === source.id) ?? source;
  }

  const finalUrl = sanitizePersistedUrl(page.url());
  const targetRoute = meaningfulRoute(finalUrl, identityPolicy);
  if (unsafePath(pathnameOf(targetRoute))) {
    console.warn(`${source.route} --withheld ${cta.name}--> ${targetRoute}: consequential route`);
    return source;
  }
  const targetKey = routeLookupKey(targetRoute, identityPolicy);
  const templateRoute = matchingRouteTemplate(nodes.filter((node) => node.persona === options.persona).map((node) => pathnameOf(node.route)), pathnameOf(targetRoute));
  let target = nodeByRoute.get(targetKey) ?? (templateRoute ? nodeByRoute.get(routeLookupKey(templateRoute, identityPolicy)) : undefined);
  if (!target && options.expandRoutes && runtimeEvidenceCount(nodes, options.persona) < options.maxScreens) {
    target = runtimeNode(targetRoute, options.persona, templateRoute);
    nodes.push(target);
    nodeByRoute.set(routeLookupKey(target.route, identityPolicy), target);
  }
  if (!target || target.id === source.id) return source;
  if (!target.capture) {
    const capturedTarget = await captureNode(page, target, [], `cta-${shortHash(target.id)}`, "discover");
    const targetIndex = nodes.findIndex((node) => node.id === target?.id);
    if (targetIndex >= 0) nodes[targetIndex] = capturedTarget;
    nodeByRoute.set(routeLookupKey(capturedTarget.route, identityPolicy), capturedTarget);
    target = capturedTarget;
  }
  upsertObservedEdge(edges, source, target, {
    observedAt: new Date().toISOString(),
    fromUrl,
    toUrl: finalUrl,
    durationMs: Date.now() - startedAt,
    trigger: { kind: "click", role: "button", name: cta.name },
  });
  const sourceIndex = nodes.findIndex((node) => node.id === source.id);
  if (sourceIndex >= 0) {
    nodes[sourceIndex] = markInteractionObserved(nodes[sourceIndex] ?? source, "button", cta.name);
  }
  console.log(`${source.route} --click ${cta.name}--> ${target.route}`);
  return nodes.find((node) => node.id === source.id) ?? source;
}

function clusterGraphDiagnostics(graph: FlowGraph): FlowGraph {
  return flowGraphSchema.parse({
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      diagnostics: clusterDiagnostics(node.diagnostics),
    })),
  });
}

function runtimeNode(route: string, persona: string, routeTemplate?: string): ScreenNode {
  const path = pathnameOf(route);
  const title = path === "/" ? "Home" : (path.split("/").filter(Boolean).at(-1) ?? "Screen")
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return {
    id: persona === "default"
      ? path === "/" && routeLookupKey(route, identityPolicy) === "/" ? "screen:root" : `screen:runtime:${shortHash(routeLookupKey(route, identityPolicy))}`
      : `screen:runtime:${shortHash(route)}:persona:${persona}`,
    title,
    route,
    sourceFile: "(browser discovery)",
    kind: "page",
    confidence: 1,
    persona,
    stateKey: "default",
    identity: buildScreenIdentity({ route, routeTemplate, persona, stateKey: "default", policy: identityPolicy }),
    diagnostics: [],
    interactiveTargets: [],
    evidence: [{ kind: "observed", detail: `Same-origin link discovered in the rendered application` }],
  };
}

function markUnknownIdentityState(node: ScreenNode, keys: string[]): ScreenNode {
  const identity = node.identity ?? buildScreenIdentity({ route: node.route, persona: node.persona, stateKey: node.stateKey, policy: identityPolicy });
  const reasons = keys.map((key) => `Query parameter “${key}” was ignored because Screenwalk could not prove that it changes the UI.`);
  const suggestions = reasons.map((reason) => ({ action: "split" as const, reason: `${reason} Add it to query.include if it selects a meaningful screen state.`, confidence: 0.55 }));
  return {
    ...node,
    identity: {
      ...identity,
      review: {
        status: "needs-review",
        reasons: [...new Set([...identity.review.reasons, ...reasons])],
        suggestions: [...new Map([...identity.review.suggestions, ...suggestions].map((suggestion) => [`${suggestion.action}:${suggestion.reason}`, suggestion])).values()],
      },
    },
  };
}

function preserveIdentityReview(next: NonNullable<ScreenNode["identity"]>, previous?: ScreenNode["identity"]): NonNullable<ScreenNode["identity"]> {
  if (!previous) return next;
  const reasons = [...new Set([...previous.review.reasons, ...next.review.reasons])];
  const suggestions = [...new Map([...previous.review.suggestions, ...next.review.suggestions]
    .map((suggestion) => [`${suggestion.action}:${suggestion.reason}`, suggestion])).values()];
  const status = reasons.length > 0 || suggestions.length > 0
    ? "needs-review" as const
    : previous.review.status === "confirmed" ? "confirmed" as const : next.review.status;
  return { ...next, review: { status, reasons, suggestions } };
}

function applyIdentityModel(input: FlowGraph, policy: IdentityPolicy): FlowGraph {
  return flowGraphSchema.parse({
    ...input,
    nodes: input.nodes.map((node) => ({
      ...node,
      identity: preserveIdentityReview(buildScreenIdentity({
        route: node.route,
        routeTemplate: node.identity?.routeTemplate ?? node.route,
        persona: node.persona,
        stateKey: node.stateKey,
        presentation: node.identity?.presentation ?? {
          kind: node.kind === "modal" || node.kind === "drawer" || node.kind === "popover" ? node.kind : "page",
          overlays: [],
          slots: [],
        },
        policy,
      }), node.identity),
    })),
  });
}

async function inspectPresentation(page: Page): Promise<NonNullable<ScreenNode["identity"]>["presentation"]> {
  return page.evaluate(`(() => {
    const visible = function (element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const label = function (element, fallback) {
      return (element.getAttribute("aria-label") || element.getAttribute("data-screenwalk-name") || element.querySelector("h1, h2, h3")?.textContent || fallback)
        .replace(/\\s+/g, " ").trim().slice(0, 80);
    };
    const dialogs = Array.from(document.querySelectorAll("dialog[open], [role=dialog][aria-modal=true]")).filter(visible);
    const drawers = Array.from(document.querySelectorAll('[data-screenwalk-presentation="drawer"], [data-screenwalk-drawer][data-state="open"]')).filter(visible);
    let popovers = [];
    try { popovers = Array.from(document.querySelectorAll(":popover-open")).filter(visible); } catch { popovers = []; }
    const slots = Array.from(document.querySelectorAll("[data-screenwalk-slot]")).filter(visible)
      .map(function (element) { return element.getAttribute("data-screenwalk-slot") || "slot"; });
    const overlays = dialogs.map(function (element) { return "dialog:" + label(element, "Dialog"); })
      .concat(drawers.map(function (element) { return "drawer:" + label(element, "Drawer"); }))
      .concat(popovers.map(function (element) { return "popover:" + label(element, "Popover"); }));
    const kind = slots.length > 1 ? "parallel" : drawers.length > 0 ? "drawer" : dialogs.length > 0 ? "modal" : popovers.length > 0 ? "popover" : "page";
    return { kind, overlays: Array.from(new Set(overlays)).sort(), slots: Array.from(new Set(slots)).sort() };
  })()`) as Promise<NonNullable<ScreenNode["identity"]>["presentation"]>;
}

async function captureContext(page: Page, persona: string) {
  const preferences = await page.evaluate(() => ({
    locale: document.documentElement.lang || navigator.language || undefined,
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" as const : matchMedia("(prefers-color-scheme: light)").matches ? "light" as const : "no-preference" as const,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" as const : "no-preference" as const,
    network: navigator.onLine ? "online" as const : "offline" as const,
  }));
  return {
    persona,
    viewport: viewportName === "mobile" ? "mobile" as const : "desktop" as const,
    browser: page.context().browser()?.browserType().name() ?? "chromium",
    ...preferences,
  };
}

async function inventoryInteractiveTargets(page: Page, nodeId: string): Promise<InteractiveTarget[]> {
  if (!baseUrl) return [];
  const origin = new URL(baseUrl).origin;
  const targets = await page.locator("a[href], button, [role=button], [role=tab], input, select, textarea").evaluateAll((elements) => elements.map((element) => {
    const html = element as HTMLElement;
    const style = getComputedStyle(html);
    const rect = html.getBoundingClientRect();
    if (style.visibility === "hidden" || style.display === "none" || rect.width === 0 || rect.height === 0) return null;
    const tag = html.tagName.toLowerCase();
    const declaredRole = html.getAttribute("role");
    const role = declaredRole === "tab" ? "tab" : tag === "a" ? "link" : tag === "button" || declaredRole === "button" ? "button" : tag;
    const name = (html.getAttribute("aria-label") || html.querySelector("h1, h2, h3, h4, strong")?.textContent || html.textContent || (html as HTMLInputElement).placeholder || (html as HTMLInputElement).name || role).replace(/\s+/g, " ").trim().slice(0, 80);
    return { role, name: name || role, href: tag === "a" ? (html as HTMLAnchorElement).href : undefined, disabled: (html as HTMLButtonElement).disabled || html.getAttribute("aria-disabled") === "true" };
  }).filter((target): target is NonNullable<typeof target> => target !== null));

  return targets.map((target, index) => {
    const role = (["link", "button", "tab", "input", "select", "textarea"] as const).includes(target.role as "link") ? target.role as InteractiveTarget["role"] : "other";
    let status: InteractiveTarget["status"] = "unsafe";
    let reason = "Requires an explicit journey recipe before Screenwalk will interact with it.";
    let href: string | undefined;
    if (target.disabled) {
      status = "blocked";
      reason = "Control was disabled when captured.";
    } else if (target.href) {
      href = sanitizePersistedUrl(target.href);
      const url = new URL(target.href);
      if (url.origin !== origin) {
        status = "blocked";
        reason = "External navigation is never auto-clicked.";
      } else if (unsafePath(url.pathname)) {
        status = "unsafe";
        reason = "Potentially destructive or consequential route is never auto-clicked.";
      } else if (routeLookupKey(url.toString(), identityPolicy) === routeLookupKey(page.url(), identityPolicy)) {
        status = "local";
        reason = "Same-screen link or anchor; it is not a route transition.";
      } else {
        status = "unobserved";
        reason = "Visible safe link has not been observed completing a transition.";
      }
    }
    const name = sanitizePersistedText(target.name);
    return { id: `target:${shortHash(`${nodeId}:${role}:${name}:${href ?? index}`)}`, role, name, href, status, reason };
  });
}

function markInteractionObserved(node: ScreenNode, role: "link" | "button" | "tab", name: string, href?: string): ScreenNode {
  const sanitizedHref = href ? sanitizePersistedUrl(href) : undefined;
  return {
    ...node,
    interactiveTargets: node.interactiveTargets.map((target) => {
      const sameHref = sanitizedHref && target.href === sanitizedHref;
      const sameLabel = target.role === role && target.name === name;
      return sameHref || sameLabel ? { ...target, status: "observed" as const, reason: undefined } : target;
    }),
  };
}

function markInteractionFailed(node: ScreenNode, name: string, href: string | undefined, error: unknown): ScreenNode {
  const sanitizedHref = href ? sanitizePersistedUrl(href) : undefined;
  const detail = error instanceof Error ? error.message : String(error);
  return {
    ...node,
    interactiveTargets: node.interactiveTargets.map((target) => {
      const sameHref = Boolean(sanitizedHref) && target.href === sanitizedHref;
      const sameLabel = target.name === name && (target.role === "link" || target.role === "button" || target.role === "tab");
      return sameHref || sameLabel
        ? { ...target, status: "failed" as const, reason: `Navigation was attempted but not accepted as a transition: ${detail}` }
        : target;
    }),
  };
}

function carryFailedInteractionEvidence(previous: InteractiveTarget[], current: InteractiveTarget[]): InteractiveTarget[] {
  const failedByHref = new Map(previous.filter((target) => target.status === "failed" && target.href).map((target) => [target.href, target]));
  return current.map((target) => {
    const failed = target.href ? failedByHref.get(target.href) : undefined;
    return failed ? { ...target, status: failed.status, reason: failed.reason } : target;
  });
}

async function renderedContentSignature(page: Page): Promise<string> {
  const content = await page.locator("body").innerText().catch(() => "");
  const title = await page.title().catch(() => "");
  const semanticState = await page.locator("body").evaluate((body) => {
    const selectors = [
      "[aria-selected=true]", "[aria-expanded=true]", "[aria-checked=true]", "[aria-current]",
      "dialog[open]", "[role=dialog][aria-modal=true]", ":popover-open",
    ];
    return selectors.flatMap((selector) => {
      try {
        return [...body.querySelectorAll(selector)].map((element) => {
          const html = element as HTMLElement;
          return [selector, html.getAttribute("role"), html.getAttribute("aria-label"), html.id, html.textContent?.replace(/\s+/g, " ").trim().slice(0, 80)].join(":");
        });
      } catch {
        return [];
      }
    }).sort();
  }).catch(() => [] as string[]);
  return shortHash(`${title}\n${content.replace(/\s+/g, " ").trim()}\n${semanticState.join("\n")}`);
}

function applyObservedInteractionReceipts(graph: FlowGraph): FlowGraph {
  const observationsBySource = new Map<string, Array<NonNullable<TransitionEdge["observations"]>[number]>>();
  for (const edge of graph.edges) {
    if (!edge.observations?.length) continue;
    observationsBySource.set(edge.source, [...(observationsBySource.get(edge.source) ?? []), ...edge.observations]);
  }
  return flowGraphSchema.parse({
    ...graph,
    nodes: graph.nodes.map((node) => {
      const observations = observationsBySource.get(node.id) ?? [];
      const classifiedNode = {
        ...node,
        interactiveTargets: node.interactiveTargets.map((target) => {
          const name = target.name.slice(0, 80);
          if (target.status !== "unobserved" || !target.href) return { ...target, name };
          try {
            const url = new URL(target.href);
            return routeLookupKey(url.toString(), identityPolicy) === routeLookupKey(node.route, identityPolicy) ? { ...target, name, status: "local" as const, reason: "Same-screen link or anchor; it is not a route transition." } : { ...target, name };
          } catch {
            return { ...target, name };
          }
        }),
      };
      return observations.reduce((current, observation) => markInteractionObserved(current, observation.trigger.role, observation.trigger.name), classifiedNode);
    }),
  });
}

function normalizeDevelopmentDiagnostics(graph: FlowGraph): FlowGraph {
  return flowGraphSchema.parse({
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      diagnostics: node.diagnostics.map((diagnostic) =>
        diagnostic.kind === "console" && /WebSocket connection to ['"]wss?:\/\/[^/]+\/_next\/(?:webpack-hmr|hmr)/i.test(diagnostic.message)
          ? { ...diagnostic, severity: "info" as const, message: `Development HMR connection unavailable during capture: ${diagnostic.message}` }
          : diagnostic,
      ),
    })),
  });
}

function requireNode(nodes: Map<string, ScreenNode>, route: string): ScreenNode {
  const node = nodes.get(route);
  if (!node) throw new Error(`Recipe route ${route} has no matching graph node`);
  return node;
}

async function persistGraph(graph: FlowGraph): Promise<void> {
  const clustered = clusterGraphDiagnostics(graph);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(clustered, null, 2)}\n`, "utf8");
}

async function measure<T>(stage: string, label: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    timingEvents.push({ stage, label, durationMs: Math.round(performance.now() - startedAt) });
  }
}

function timingStages(): Array<{ stage: string; count: number; totalMs: number; maxMs: number; slowestLabel: string }> {
  const stages = new Map<string, { count: number; totalMs: number; maxMs: number; slowestLabel: string }>();
  for (const event of timingEvents) {
    const current = stages.get(event.stage) ?? { count: 0, totalMs: 0, maxMs: 0, slowestLabel: event.label };
    current.count += 1;
    current.totalMs += event.durationMs;
    if (event.durationMs >= current.maxMs) {
      current.maxMs = event.durationMs;
      current.slowestLabel = event.label;
    }
    stages.set(event.stage, current);
  }
  return [...stages.entries()]
    .map(([stage, values]) => ({ stage, ...values }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

function printTimingSummary(): void {
  const stages = timingStages();
  if (stages.length === 0) return;
  console.log(`Capture stages: ${stages.map((stage) => `${stage.stage} ${formatMilliseconds(stage.totalMs)} / ${stage.count}`).join("; ")}.`);
}

async function persistTimings(): Promise<void> {
  if (!timingOutputPath) return;
  const timingPath = resolve(timingOutputPath);
  await mkdir(dirname(timingPath), { recursive: true });
  await writeFile(timingPath, `${JSON.stringify({
    schemaVersion: "screenbranch.capture-timing.v0",
    generatedAt: new Date().toISOString(),
    command,
    viewport: viewportName,
    stages: timingStages(),
    events: timingEvents,
  }, null, 2)}\n`, "utf8");
}

function formatMilliseconds(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds}ms` : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function attachDiagnostics(
  page: Page,
  diagnostics: Diagnostic[],
  nodeId: string,
  activeNodeId: () => string = () => nodeId,
  diagnosticsByNode?: Map<string, Diagnostic[]>,
): void {
  const record = (diagnostic: Diagnostic) => {
    appendDiagnostic(diagnostics, diagnostic);
    if (!diagnosticsByNode) return;
    const list = diagnosticsByNode.get(activeNodeId()) ?? [];
    appendDiagnostic(list, diagnostic);
    diagnosticsByNode.set(activeNodeId(), list);
  };
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    record(makeDiagnostic(activeNodeId(), "console", message.type() === "error" ? "error" : "warning", message.text(), page.url()));
  });
  page.on("pageerror", (error) => {
    record(makeDiagnostic(activeNodeId(), "page-error", "error", error.message, page.url()));
  });
  page.on("requestfailed", (request) => {
    const message = request.failure()?.errorText ?? "Request failed";
    record(makeDiagnostic(activeNodeId(), "request-failed", message.includes("ERR_ABORTED") ? "info" : "error", message, request.url()));
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    record({
      ...makeDiagnostic(activeNodeId(), "http", "error", `${response.status()} ${response.statusText()}`, response.url()),
      status: response.status(),
    });
  });
}

async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
  let quality = await waitForMeaningfulPage(page);
  const loadingSelector = '[aria-busy="true"], [role="progressbar"], [data-loading="true"], .animate-spin';
  if (quality !== "ready" && await hasVisibleLoader(page, loadingSelector)) {
    await page.waitForFunction((selector) => [...document.querySelectorAll(selector)].every((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility === "hidden" || style.display === "none" || rect.width === 0 || rect.height === 0;
    }), loadingSelector, { timeout: 8_000 }).catch(() => undefined);
    quality = await assessPage(page);
  }
  if (quality !== "ready") return;
  await waitForVisualStability(page);
  await waitForVisibleImages(page);
}

async function hasVisibleLoader(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluateAll((elements) => elements.some((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  })).catch(() => false);
}

async function waitForVisibleImages(page: Page): Promise<void> {
  await page.waitForFunction(() => [...document.images].every((image) => {
    const style = getComputedStyle(image);
    const rect = image.getBoundingClientRect();
    const visible = style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    return !visible || image.complete;
  }), undefined, { timeout: 2_000 }).catch(() => undefined);
}

async function waitForVisualStability(page: Page): Promise<void> {
  await page.evaluate(({ minimumMs, quietMs, timeoutMs }) => new Promise<void>((resolveWait) => {
    const startedAt = performance.now();
    let lastMutationAt = startedAt;
    const observer = new MutationObserver(() => {
      lastMutationAt = performance.now();
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    const check = window.setInterval(() => {
      const now = performance.now();
      if ((now - startedAt >= minimumMs && now - lastMutationAt >= quietMs) || now - startedAt >= timeoutMs) {
        window.clearInterval(check);
        observer.disconnect();
        resolveWait();
      }
    }, 50);
  }), { minimumMs: 800, quietMs: 350, timeoutMs: 3_000 });
}

async function assessPage(page: Page): Promise<PageQuality> {
  const snapshot = await page.evaluate(COLLECT_PAGE_QUALITY_SCRIPT) as Parameters<typeof assessPageSnapshot>[0];
  return assessPageSnapshot(snapshot);
}

async function waitForMeaningfulPage(page: Page): Promise<PageQuality> {
  const deadline = Date.now() + 6_000;
  let quality = await assessPage(page);
  while (quality !== "ready" && Date.now() < deadline) {
    await page.waitForTimeout(250);
    quality = await assessPage(page);
  }
  return quality;
}

function makeDiagnostic(nodeId: string, kind: Diagnostic["kind"], severity: Diagnostic["severity"], message: string, url?: string): Diagnostic {
  const observedAt = new Date().toISOString();
  const safeMessage = sanitizePersistedText(message || kind);
  return {
    id: `diagnostic:${shortHash(`${nodeId}:${kind}:${safeMessage}:${observedAt}`)}`,
    kind,
    severity,
    message: safeMessage,
    observedAt,
    url: url ? sanitizePersistedUrl(url) : undefined,
  };
}

const SENSITIVE_URL_FIELD = /(?:^|[-_])(api[-_]?key|key|token|secret|password|passwd|signature|sig|auth|authorization|session|credential)(?:$|[-_])/i;

function sanitizePersistedUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "redacted";
    if (url.password) url.password = "redacted";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_URL_FIELD.test(key)) url.searchParams.set(key, "[redacted]");
    }
    if (url.hash && SENSITIVE_URL_FIELD.test(url.hash.slice(1))) url.hash = "#redacted";
    return url.toString();
  } catch {
    return value;
  }
}

function sanitizePersistedText(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, (candidate) => sanitizePersistedUrl(candidate));
}

function safeName(route: string): string {
  return route === "/" ? "home" : route.slice(1).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Executable doesn't exist")) throw error;
    console.warn("Bundled Chromium is unavailable; using the installed Chrome channel.");
    return chromium.launch({ channel: "chrome" });
  }
}
