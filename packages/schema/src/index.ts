import { z } from "zod";

export const evidenceKindSchema = z.enum([
  "observed",
  "static",
  "declared",
  "inferred",
]);

export const evidenceSchema = z.object({
  kind: evidenceKindSchema,
  detail: z.string().min(1),
  sourceFile: z.string().optional(),
  line: z.number().int().positive().optional(),
});

export const diagnosticSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["console", "page-error", "request-failed", "http", "capture-quality"]),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  count: z.number().int().positive().optional(),
  observedAt: z.string().datetime(),
  url: z.string().optional(),
  status: z.number().int().optional(),
});

export const identityPolicySchema = z.object({
  schemaVersion: z.literal("screenwalk.identity.v0"),
  query: z.object({
    include: z.array(z.string().min(1)).default([]),
    ignore: z.array(z.string().min(1)).default([]),
  }).default({ include: [], ignore: [] }),
  hash: z.object({
    include: z.array(z.string().min(1)).default([]),
    treatPathAsRoute: z.boolean().default(true),
  }).default({ include: [], treatPathAsRoute: true }),
});

export const identityReviewSchema = z.object({
  status: z.enum(["automatic", "needs-review", "confirmed"]).default("automatic"),
  reasons: z.array(z.string().min(1)).default([]),
  suggestions: z.array(z.object({
    action: z.enum(["merge", "split"]),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })).default([]),
});

export const screenIdentitySchema = z.object({
  familyId: z.string().min(1),
  variantId: z.string().min(1),
  routeTemplate: z.string().min(1),
  semanticUrlState: z.object({
    query: z.record(z.string(), z.string()).default({}),
    hash: z.string().optional(),
  }).default({ query: {} }),
  presentation: z.object({
    kind: z.enum(["page", "modal", "drawer", "popover", "parallel", "unknown"]).default("page"),
    overlays: z.array(z.string()).default([]),
    slots: z.array(z.string()).default([]),
  }).default({ kind: "page", overlays: [], slots: [] }),
  review: identityReviewSchema.default({ status: "automatic", reasons: [], suggestions: [] }),
});

export const captureContextSchema = z.object({
  persona: z.string().min(1),
  viewport: z.enum(["desktop", "mobile", "custom"]),
  browser: z.string().min(1),
  locale: z.string().min(1).optional(),
  colorScheme: z.enum(["light", "dark", "no-preference"]).optional(),
  reducedMotion: z.enum(["reduce", "no-preference"]).optional(),
  network: z.enum(["online", "offline"]).default("online"),
});

export const screenCaptureSchema = z.object({
  kind: z.literal("captured"),
  quality: z.enum(["ready", "loading", "empty"]).default("ready"),
  asset: z.string().min(1),
  url: z.string().url(),
  title: z.string(),
  observedAt: z.string().datetime(),
  contentHash: z.string().min(1).optional(),
  captureId: z.string().min(1).optional(),
  context: captureContextSchema.optional(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});

export const interactiveTargetSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["link", "button", "tab", "input", "select", "textarea", "other"]),
  name: z.string().min(1),
  href: z.string().optional(),
  status: z.enum(["observed", "unobserved", "local", "unsafe", "blocked", "failed"]),
  reason: z.string().optional(),
});

export const screenNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  route: z.string().min(1),
  sourceFile: z.string().min(1),
  kind: z.enum(["page", "modal", "loading", "error", "not-found", "unknown"]),
  stateKey: z.enum(["default", "loading", "error", "not-found", "modal", "unknown"]).default("default"),
  confidence: z.number().min(0).max(1),
  persona: z.string().default("default"),
  identity: screenIdentitySchema.optional(),
  screenshot: z.string().optional(),
  capture: screenCaptureSchema.optional(),
  captureVariants: z.object({
    desktop: screenCaptureSchema.optional(),
    mobile: screenCaptureSchema.optional(),
  }).optional(),
  diagnostics: z.array(diagnosticSchema).default([]),
  interactiveTargets: z.array(interactiveTargetSchema).default([]),
  evidence: z.array(evidenceSchema).min(1),
});

export const transitionConditionSchema = z.object({
  kind: z.enum(["access", "choice", "feature-flag", "experiment", "data-state", "environment", "other"]),
  label: z.string().min(1),
  key: z.string().min(1).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  evidence: z.enum(["declared", "observed", "inferred"]).default("declared"),
});

export const transitionEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  action: z.string().min(1),
  conditions: z.array(transitionConditionSchema).min(1).max(4).optional(),
  conditionLogic: z.enum(["all", "any"]).optional(),
  confidence: z.number().min(0).max(1),
  observations: z.array(z.object({
    id: z.string().min(1),
    observedAt: z.string().datetime(),
    fromUrl: z.string().url(),
    toUrl: z.string().url(),
    durationMs: z.number().nonnegative(),
    trigger: z.object({
      kind: z.literal("click"),
      role: z.enum(["link", "button", "tab"]),
      name: z.string().min(1),
    }),
  })).optional(),
  evidence: z.array(evidenceSchema).min(1),
});

export const gapSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["unresolved-target", "dynamic-navigation", "unobserved-route", "unobserved-state"]),
  detail: z.string().min(1),
  sourceFile: z.string().optional(),
  line: z.number().int().positive().optional(),
});

export const journeySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  nodeIds: z.array(z.string()).min(1),
  edgeIds: z.array(z.string()).optional(),
  kind: z.enum(["static", "observed", "curated"]).optional(),
  provenance: z.enum(["end-to-end", "verified-end-to-end", "recorded-unverified", "composed-from-observed", "static-candidate", "curated"]).optional(),
  verification: z.object({
    status: z.enum(["passed", "failed", "errored"]),
    asserted: z.boolean(),
    completedAt: z.string().datetime(),
    receipt: z.string().min(1),
  }).optional(),
});

export const terminalAssertionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("visible-text"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("visible-role"),
    role: z.enum(["alert", "button", "dialog", "heading", "link", "status", "tab", "textbox"]),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("test-id"),
    value: z.string().min(1),
  }),
]);

export const journeyRecipeSchema = z.object({
  schemaVersion: z.literal("screenbranch.recipe.v0"),
  journeys: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    startRoute: z.string().startsWith("/"),
    steps: z.array(z.object({
      targetRoute: z.string().startsWith("/"),
      conditions: z.array(transitionConditionSchema).min(1).max(4).optional(),
      conditionLogic: z.enum(["all", "any"]).optional(),
      trigger: z.object({
        role: z.enum(["link", "button", "tab"]),
        name: z.string().min(1),
      }),
    })).min(1),
    terminalAssertion: terminalAssertionSchema.optional(),
  })).min(1),
});

export const journeyRunReceiptSchema = z.object({
  schemaVersion: z.literal("screenwalk.journey-run.v0"),
  runId: z.string().min(1),
  journeyId: z.string().min(1),
  title: z.string().min(1),
  recipeHash: z.string().min(1),
  status: z.enum(["passed", "failed", "errored"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  persona: z.string().min(1),
  viewport: z.enum(["desktop", "mobile"]),
  browser: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  startRoute: z.string().startsWith("/"),
  finalRoute: z.string().optional(),
  nodeIds: z.array(z.string()),
  edgeIds: z.array(z.string()),
  asserted: z.boolean(),
  terminalAssertion: terminalAssertionSchema.optional(),
  assertionResult: z.object({
    passed: z.boolean(),
    detail: z.string().min(1),
  }).optional(),
  diagnosticsCount: z.number().int().nonnegative(),
  artifacts: z.object({
    graph: z.string().min(1),
    screenshots: z.array(z.string()),
    trace: z.string().nullable(),
  }),
  conditions: z.array(transitionConditionSchema).max(16).default([]),
  error: z.string().optional(),
});

const setupLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("label"),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal("role"),
    role: z.enum(["button", "link", "textbox"]),
    name: z.string().min(1),
  }),
]);

export const setupRecipeSchema = z.object({
  schemaVersion: z.literal("screenbranch.setup.v0"),
  persona: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "persona must use lowercase letters, numbers, and hyphens").refine((value) => value !== "default", "persona must name an additional access view"),
  label: z.string().min(1),
  startRoute: z.string().startsWith("/"),
  actions: z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("fill"),
      locator: setupLocatorSchema,
      valueFromEnv: z.string().min(1).regex(/^[A-Z_][A-Z0-9_]*$/, "valueFromEnv must be an environment variable name"),
    }),
    z.object({
      type: z.literal("click"),
      locator: setupLocatorSchema,
    }),
    z.object({
      type: z.literal("waitForRoute"),
      route: z.string().startsWith("/"),
    }),
  ])).min(1),
});

export const deploymentEnvironmentSchema = z.enum(["local", "preview", "staging", "production", "unknown"]);

export const repositoryServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(["web", "api", "worker", "admin", "service", "unknown"]),
  framework: z.string().min(1).optional(),
  deployProviders: z.array(z.enum(["railway", "vercel", "fly", "render", "docker"])).default([]),
  integrations: z.array(z.object({
    kind: z.enum(["auth", "database", "payments", "observability", "queue", "storage", "email", "ai", "other"]),
    name: z.string().min(1),
    via: z.string().min(1),
    sourceFile: z.string().min(1).optional(),
    evidence: z.enum(["configuration", "dependency", "source-reference"]).optional(),
  })).default([]),
  featureFlags: z.array(z.object({
    provider: z.string().min(1),
    via: z.string().min(1),
    sourceFile: z.string().min(1).optional(),
    evidence: z.enum(["configuration", "dependency", "source-reference"]),
  })).default([]),
  environments: z.array(z.object({
    environment: deploymentEnvironmentSchema,
    url: z.string().url().optional(),
    sourceFile: z.string().min(1),
  })).default([]),
});

export const repositoryTopologySchema = z.object({
  schemaVersion: z.literal("screenwalk.topology.v0"),
  repository: z.object({
    name: z.string().min(1),
    root: z.string().min(1),
    kind: z.enum(["single-app", "monorepo"]),
  }),
  services: z.array(repositoryServiceSchema),
  generatedAt: z.string().datetime(),
});

export const flowGraphSchema = z.object({
  schemaVersion: z.literal("screenbranch.graph.v0"),
  project: z.object({
    name: z.string().min(1),
    root: z.string().min(1),
    framework: z.enum(["next-app-router", "web"]),
    generatedAt: z.string().datetime(),
    service: repositoryServiceSchema.optional(),
    topology: repositoryTopologySchema.optional(),
  }),
  nodes: z.array(screenNodeSchema),
  edges: z.array(transitionEdgeSchema),
  journeys: z.array(journeySchema),
  gaps: z.array(gapSchema),
  run: z.object({
    id: z.string().min(1),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    baseUrl: z.string().url().optional(),
    environment: deploymentEnvironmentSchema.optional(),
    environmentEvidence: z.enum(["declared", "inferred"]).optional(),
    revision: z.object({
      sha: z.string().regex(/^[a-f0-9]{7,64}$/i),
      branch: z.string().min(1),
      dirty: z.boolean(),
    }).optional(),
    deployment: z.object({
      id: z.string().min(1).optional(),
      url: z.string().url(),
    }).optional(),
    serviceId: z.string().min(1).optional(),
    status: z.enum(["running", "complete", "partial", "failed"]),
    previousRunId: z.string().optional(),
  }).optional(),
  diff: z.object({
    previousRunId: z.string().optional(),
    addedNodeIds: z.array(z.string()),
    removedNodeIds: z.array(z.string()),
    changedNodeIds: z.array(z.string()),
  }).optional(),
}).superRefine((graph, context) => {
  const nodeIds = new Set<string>();
  graph.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "id"], message: `Duplicate screen id: ${node.id}` });
    }
    nodeIds.add(node.id);
  });

  const edgeIds = new Set<string>();
  const edgeById = new Map<string, (typeof graph.edges)[number]>();
  graph.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      context.addIssue({ code: "custom", path: ["edges", index, "id"], message: `Duplicate transition id: ${edge.id}` });
    }
    edgeIds.add(edge.id);
    edgeById.set(edge.id, edge);
    if (!nodeIds.has(edge.source)) {
      context.addIssue({ code: "custom", path: ["edges", index, "source"], message: `Unknown source screen: ${edge.source}` });
    }
    if (!nodeIds.has(edge.target)) {
      context.addIssue({ code: "custom", path: ["edges", index, "target"], message: `Unknown target screen: ${edge.target}` });
    }
  });

  const journeyIds = new Set<string>();
  graph.journeys.forEach((journey, journeyIndex) => {
    if (journeyIds.has(journey.id)) {
      context.addIssue({ code: "custom", path: ["journeys", journeyIndex, "id"], message: `Duplicate journey id: ${journey.id}` });
    }
    journeyIds.add(journey.id);
    journey.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!nodeIds.has(nodeId)) {
        context.addIssue({ code: "custom", path: ["journeys", journeyIndex, "nodeIds", nodeIndex], message: `Unknown journey screen: ${nodeId}` });
      }
    });
    if (journey.edgeIds && journey.edgeIds.length !== Math.max(0, journey.nodeIds.length - 1)) {
      context.addIssue({ code: "custom", path: ["journeys", journeyIndex, "edgeIds"], message: "Journey transitions must connect each consecutive screen exactly once" });
    }
    journey.edgeIds?.forEach((edgeId, edgeIndex) => {
      const edge = edgeById.get(edgeId);
      if (!edge) {
        context.addIssue({ code: "custom", path: ["journeys", journeyIndex, "edgeIds", edgeIndex], message: `Unknown journey transition: ${edgeId}` });
        return;
      }
      if (edge.source !== journey.nodeIds[edgeIndex] || edge.target !== journey.nodeIds[edgeIndex + 1]) {
        context.addIssue({ code: "custom", path: ["journeys", journeyIndex, "edgeIds", edgeIndex], message: `Transition ${edgeId} does not connect the adjacent journey screens` });
      }
    });
  });
});

export const revisionIdentitySchema = z.object({
  label: z.string().min(1),
  environment: deploymentEnvironmentSchema,
  git: z.object({
    sha: z.string().regex(/^[a-f0-9]{7,64}$/i),
    branch: z.string().min(1),
    dirty: z.boolean(),
  }),
  deployment: z.object({
    id: z.string().min(1).optional(),
    url: z.string().url(),
  }).optional(),
  capturedAt: z.string().datetime(),
  evidence: z.enum(["source", "runtime"]),
});

export const flowComparisonSchema = z.object({
  schemaVersion: z.literal("screenwalk.comparison.v0"),
  project: z.object({ name: z.string().min(1) }),
  reference: revisionIdentitySchema,
  candidate: revisionIdentitySchema,
  surfaces: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    summary: z.object({
      referenceScreens: z.number().int().nonnegative(),
      candidateScreens: z.number().int().nonnegative(),
      sharedScreens: z.number().int().nonnegative(),
      onlyReference: z.number().int().nonnegative(),
      onlyCandidate: z.number().int().nonnegative(),
      removedPaths: z.number().int().nonnegative(),
      addedPaths: z.number().int().nonnegative(),
      referenceCaptured: z.number().int().nonnegative().optional(),
      candidateCaptured: z.number().int().nonnegative().optional(),
      sharedCaptured: z.number().int().nonnegative().optional(),
    }),
    sharedRoutes: z.array(z.string()),
    changes: z.array(z.object({
      id: z.string().min(1),
      route: z.string().min(1),
      title: z.string().min(1),
      status: z.enum(["only-reference", "only-candidate", "path-changed", "evidence-missing"]),
      sourceFile: z.string().optional(),
    })),
  })).min(1),
}).superRefine((comparison, context) => {
  for (const side of ["reference", "candidate"] as const) {
    const revision = comparison[side];
    if (revision.evidence === "runtime" && !revision.deployment) {
      context.addIssue({ code: "custom", path: [side, "deployment"], message: "Runtime evidence requires a graph-owned deployment URL" });
    }
    if (revision.evidence === "source" && revision.deployment) {
      context.addIssue({ code: "custom", path: [side, "deployment"], message: "Source evidence cannot claim a runtime deployment" });
    }
  }

  comparison.surfaces.forEach((surface, surfaceIndex) => {
    const { referenceCaptured, candidateCaptured, sharedCaptured } = surface.summary;
    const captureCounts = [referenceCaptured, candidateCaptured, sharedCaptured];
    if (captureCounts.some((count) => count !== undefined) && captureCounts.some((count) => count === undefined)) {
      context.addIssue({ code: "custom", path: ["surfaces", surfaceIndex, "summary"], message: "Capture evidence counts must be supplied together" });
    }
    if (referenceCaptured !== undefined && referenceCaptured > surface.summary.referenceScreens) {
      context.addIssue({ code: "custom", path: ["surfaces", surfaceIndex, "summary", "referenceCaptured"], message: "Captured reference screens cannot exceed reference screens" });
    }
    if (candidateCaptured !== undefined && candidateCaptured > surface.summary.candidateScreens) {
      context.addIssue({ code: "custom", path: ["surfaces", surfaceIndex, "summary", "candidateCaptured"], message: "Captured candidate screens cannot exceed candidate screens" });
    }
    if (sharedCaptured !== undefined && sharedCaptured > surface.summary.sharedScreens) {
      context.addIssue({ code: "custom", path: ["surfaces", surfaceIndex, "summary", "sharedCaptured"], message: "Shared captured screens cannot exceed shared screens" });
    }
  });
});

export const flowCompositionSchema = z.object({
  schemaVersion: z.literal("screenbranch.composition.v0"),
  id: z.string().min(1),
  title: z.string().min(1),
  nodeIds: z.array(z.string()).min(1),
  fps: z.number().int().positive(),
  framesPerStep: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export {
  appendDiagnostic,
  clusterDiagnostics,
  diagnosticClusterKey,
  normalizeDiagnosticMessage,
  normalizeDiagnosticUrl,
} from "./diagnostics.ts";

export type Evidence = z.infer<typeof evidenceSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type FlowComposition = z.infer<typeof flowCompositionSchema>;
export type FlowGraph = z.infer<typeof flowGraphSchema>;
export type FlowComparison = z.infer<typeof flowComparisonSchema>;
export type Journey = z.infer<typeof journeySchema>;
export type JourneyRecipe = z.infer<typeof journeyRecipeSchema>;
export type TerminalAssertion = z.infer<typeof terminalAssertionSchema>;
export type JourneyRunReceipt = z.infer<typeof journeyRunReceiptSchema>;
export type TransitionCondition = z.infer<typeof transitionConditionSchema>;
export type SetupRecipe = z.infer<typeof setupRecipeSchema>;
export type InteractiveTarget = z.infer<typeof interactiveTargetSchema>;
export type IdentityPolicy = z.infer<typeof identityPolicySchema>;
export type ScreenIdentity = z.infer<typeof screenIdentitySchema>;
export type CaptureContext = z.infer<typeof captureContextSchema>;
export type ScreenNode = z.infer<typeof screenNodeSchema>;
export type ScreenCapture = z.infer<typeof screenCaptureSchema>;
export type TransitionEdge = z.infer<typeof transitionEdgeSchema>;
export type RepositoryService = z.infer<typeof repositoryServiceSchema>;
export type RepositoryTopology = z.infer<typeof repositoryTopologySchema>;
