import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from "react";
import type { PlayerRef } from "@remotion/player";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  PanOnScrollMode,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import { clusterDiagnostics, flowGraphSchema, type FlowGraph } from "@screenbranch/schema";
import demoGraphData from "./data/demo-graph.json";
import { FlowNode, type FlowNodeData } from "./FlowNode.tsx";
import { edgeActionLabel, formatJourneyChangeBrief, formatScreenReviewPrompt } from "./format-screen-review-prompt.ts";

const initialParams = new URLSearchParams(window.location.search);
const graphKey = initialParams.get("graph");
const knownGraphKeys = new Set([null, "local", "fixture"]);
const unknownGraphKey = !knownGraphKeys.has(graphKey) ? graphKey : null;
const isHostedDemo = graphKey !== "local" && (initialParams.get("demo") === "1" || !new Set(["localhost", "127.0.0.1", "::1"]).has(window.location.hostname));
const bundledGraph = polishCapturedGraph(flowGraphSchema.parse(demoGraphData) as FlowGraph);
const nodeTypes = { screen: FlowNode };
const proOptions = { hideAttribution: true };
const JourneyPlayer = lazy(() => import("./JourneyPlayer.tsx"));

type AuditCategory = "screens" | "interactions" | "quality" | "responsive" | "runtime";
type AuditEvidence = "static" | "observed" | "captured";
type AuditFinding = {
  id: string;
  category: AuditCategory;
  nodeId: string;
  relatedNodeId?: string;
  edgeKey?: string;
  title: string;
  route: string;
  detail: string;
  sourceFile: string;
  evidence: AuditEvidence;
};
type ReviewStatus = "in-flow" | "out-of-flow" | "needs-review";
type ScreenReview = { status?: ReviewStatus; note?: string; acceptanceCriteria?: string };
type ExperienceCondition = "public" | "signed-out" | "signed-in" | "success" | "failure" | "unknown";
type JourneyReview = { condition?: ExperienceCondition };
type ScreenRecommendation = {
  status: ReviewStatus;
  evidenceClass: string;
  action: string;
  reasons: string[];
};
type MapGroup = "connected" | "known" | "source-only";
type MapRole = "connected" | "policy" | "reference" | "direct-entry" | "unknown";
type MapClassification = { group: MapGroup; role: MapRole; reason: string };

const reviewChoices: ReadonlyArray<readonly [ReviewStatus, string]> = [
  ["in-flow", "Keep here"],
  ["out-of-flow", "Another path"],
  ["needs-review", "Needs checking"],
];

const experienceConditionChoices: ReadonlyArray<readonly [ExperienceCondition, string]> = [
  ["public", "Anyone"],
  ["signed-out", "Signed out"],
  ["signed-in", "Signed in"],
  ["success", "Success"],
  ["failure", "Failure"],
  ["unknown", "Not sure yet"],
];

const auditCategoryLabels: Record<AuditCategory, string> = {
  screens: "Screens",
  interactions: "Interactions",
  quality: "Screen quality",
  responsive: "Responsive",
  runtime: "Browser issues",
};

export function App() {
  return <MapApp />;
}

function MapApp() {
  const [graph, setGraph] = useState<FlowGraph | null>(graphKey === "local" ? null : withCaptureJourney(bundledGraph));
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (graphKey !== "local") return;
    let active = true;
    let loaded = false;
    const refresh = () => fetch("/screenbranch.graph.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load local graph (${response.status})`);
        return response.json();
      })
      .then((value) => {
        if (!active) return;
        const next = withCaptureJourney(polishCapturedGraph(flowGraphSchema.parse(value) as FlowGraph));
        setGraph((current) => current?.project.generatedAt === next.project.generatedAt ? current : next);
        loaded = true;
        setLoadError("");
      })
      .catch((error: unknown) => { if (active && !loaded) setLoadError(error instanceof Error ? error.message : String(error)); });
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_200);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  if (unknownGraphKey) return <main className="load-state"><strong>Screenwalk does not have a map named “{unknownGraphKey}”.</strong><p>Open the synthetic fixture or load the latest local scan.</p><nav><a href="/">Open fixture</a><a href="/?graph=local">Open local scan</a></nav></main>;
  if (loadError) return <main className="load-state"><strong>Screenwalk could not open this project.</strong><code>{loadError}</code><a href="/">Open the synthetic fixture instead</a></main>;
  if (!graph) return <main className="load-state"><span />Opening your product map…</main>;
  return <Studio graph={graph} />;
}

function Studio({ graph: sourceGraph }: { graph: FlowGraph }) {
  const personaOptions = useMemo(() => accessViews(sourceGraph), [sourceGraph]);
  const requestedPersona = initialParams.get("persona") ?? "default";
  const [activePersona, setActivePersona] = useState(
    personaOptions.some((option) => option.id === requestedPersona) ? requestedPersona : personaOptions[0]?.id ?? "default",
  );
  const [viewportMode, setViewportMode] = useState<"desktop" | "mobile">(initialParams.get("viewport") === "mobile" ? "mobile" : "desktop");
  const [displayMode, setDisplayMode] = useState<"ui" | "routes">(initialParams.get("display") === "routes" ? "routes" : "ui");
  const viewportLabel = viewportMode === "desktop" ? "Desktop" : "Mobile";
  const personaGraph = useMemo(() => graphForPersona(sourceGraph, activePersona), [activePersona, sourceGraph]);
  const graph = useMemo(() => graphForViewport(personaGraph, viewportMode), [personaGraph, viewportMode]);
  const scanBaseUrl = graph.run?.baseUrl;
  const scanContext = scanBaseUrl
    ? scanBaseUrl.includes("127.0.0.1") || scanBaseUrl.includes("localhost") ? "local scan" : scanBaseUrl
    : "found from code";
  const initialView = initialParams.get("view");
  const [evidenceView, setEvidenceView] = useState<"flows" | "screens" | "all">(parseEvidenceView(initialView));
  const [reviewAudit, setReviewAudit] = useState(false);
  const [auditCategory, setAuditCategory] = useState<AuditCategory>("screens");
  const [selectedFindingId, setSelectedFindingId] = useState("");
  const [copiedFindings, setCopiedFindings] = useState<"errors" | "prompt" | "">("");
  const [copiedSelection, setCopiedSelection] = useState<"routes" | "prompt" | "">("");
  const [copiedJourney, setCopiedJourney] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedReviewNodeId, setCopiedReviewNodeId] = useState("");
  const [copyingReviewNodeId, setCopyingReviewNodeId] = useState("");
  const [copyError, setCopyError] = useState("");
  const copyRequestRef = useRef(0);
  const [journeyId, setJourneyId] = useState(initialParams.get("journey") ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState(initialParams.get("screen") ?? "");
  const [flowFocusId, setFlowFocusId] = useState(initialParams.get("focus") ?? "");
  const [selectionMode, setSelectionMode] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const reviewStorageKey = `screenwalk.reviews.v1:${sourceGraph.project.root}`;
  const journeyReviewStorageKey = `screenwalk.journey-reviews.v1:${sourceGraph.project.root}`;
  const [screenReviews, setScreenReviews] = useState<Record<string, ScreenReview>>(() => readScreenReviews(reviewStorageKey));
  const [journeyReviews, setJourneyReviews] = useState<Record<string, JourneyReview>>(() => readJourneyReviews(journeyReviewStorageKey));
  const [handoffNodeIds, setHandoffNodeIds] = useState<Set<string>>(() => new Set((initialParams.get("selected") ?? "").split(",").filter(Boolean)));
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const [spacePanning, setSpacePanning] = useState(false);
  const [rearrangeMode, setRearrangeMode] = useState(isHostedDemo);
  const [showDemoGuide, setShowDemoGuide] = useState(isHostedDemo);
  const [activeStep, setActiveStep] = useState(0);
  const playerRef = useRef<PlayerRef>(null);
  const playerCloseRef = useRef<HTMLButtonElement>(null);
  const playerReturnFocusRef = useRef<HTMLElement | null>(null);
  const inspectorCloseRef = useRef<HTMLButtonElement>(null);
  const inspectorReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailsReturnFocusRef = useRef<HTMLElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<Node<FlowNodeData>, Edge>>(null);
  const historyInitializedRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const openPlayer = useCallback(() => {
    playerReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedNodeId("");
    setInspectorNodeId(null);
    setShowPlayer(true);
  }, []);
  const closePlayer = useCallback(() => {
    setShowPlayer(false);
    window.requestAnimationFrame(() => playerReturnFocusRef.current?.focus());
  }, []);
  const focusPlayerClose = useCallback(() => playerCloseRef.current?.focus(), []);
  const openInspector = useCallback((nodeId: string) => {
    inspectorReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInspectorNodeId(nodeId);
  }, []);
  const closeInspector = useCallback(() => {
    setInspectorNodeId(null);
    window.requestAnimationFrame(() => inspectorReturnFocusRef.current?.focus());
  }, []);
  const closeDetails = useCallback(() => {
    setSelectedNodeId("");
    window.requestAnimationFrame(() => detailsReturnFocusRef.current?.focus());
  }, []);
  const entryNodeId = graph.nodes.find((node) => node.route === "/")?.id ?? graph.nodes[0]?.id ?? "";
  const reachableNodeIds = useMemo(() => reachableFrom(entryNodeId, graph.edges), [entryNodeId, graph.edges]);
  const mapGroupCounts = useMemo(() => graph.nodes.reduce((counts, node) => {
    const classification = classifyMapNode(node, reachableNodeIds, entryNodeId);
    counts[classification.group] += 1;
    if (classification.group === "known" && (classification.role === "policy" || classification.role === "reference")) counts.reference += 1;
    return counts;
  }, { connected: 0, known: 0, "source-only": 0, reference: 0 }), [entryNodeId, graph.nodes, reachableNodeIds]);
  const audit = useMemo(() => buildAudit(graph, entryNodeId), [entryNodeId, graph]);
  const auditTotal = Object.values(audit).reduce((total, findings) => total + findings.length, 0);
  const seenRunning = graph.nodes.filter((node) => node.capture?.quality === "ready").length;
  const activeFindings = audit[auditCategory];
  const selectedFinding = activeFindings.find((finding) => finding.id === selectedFindingId);
  const activeAuditNodeIds = useMemo(
    () => new Set((selectedFinding ? [selectedFinding] : activeFindings).flatMap((finding) => finding.relatedNodeId ? [finding.nodeId, finding.relatedNodeId] : [finding.nodeId])),
    [activeFindings, selectedFinding],
  );
  const activeAuditEdgeKeys = useMemo(
    () => new Set((selectedFinding ? [selectedFinding] : activeFindings).flatMap((finding) => finding.edgeKey ? [finding.edgeKey] : [])),
    [activeFindings, selectedFinding],
  );
  const visibleGraph = useMemo(() => filterGraph(graph, evidenceView, entryNodeId, flowFocusId), [evidenceView, entryNodeId, flowFocusId, graph]);
  const observedJourneys = graph.journeys.filter((candidate) => candidate.kind === "observed");
  const entryJourneys = observedJourneys.filter((candidate) => candidate.nodeIds[0] === entryNodeId);
  const focusedJourneys = flowFocusId ? observedJourneys.filter((candidate) => candidate.nodeIds.includes(flowFocusId)) : [];
  const orderedObservedJourneys = [...entryJourneys, ...observedJourneys.filter((candidate) => candidate.nodeIds[0] !== entryNodeId)];
  const visibleJourneys = dedupeJourneys(focusedJourneys.length > 0 ? focusedJourneys : orderedObservedJourneys.length > 0 ? orderedObservedJourneys : graph.journeys);
  const journey = visibleJourneys.find((candidate) => candidate.id === journeyId) ?? visibleJourneys[0];
  const changeJourney = (nextJourneyId: string) => {
    setJourneyId(nextJourneyId);
    setActiveStep(0);
    setSelectedNodeId("");
  };
  const handleJourneyPickerKeyDown = (event: ReactKeyboardEvent<HTMLSelectElement>) => {
    if (!journey || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, visibleJourneys.findIndex((candidate) => candidate.id === journey.id));
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? visibleJourneys.length - 1
      : event.key === "ArrowDown" ? Math.min(visibleJourneys.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    const nextJourney = visibleJourneys[nextIndex];
    if (nextJourney) changeJourney(nextJourney.id);
  };
  const suggestedJourneyCondition = journey ? inferJourneyCondition(graph, journey, activePersona) : "unknown";
  const activeJourneyCondition = journey ? journeyReviews[journey.id]?.condition ?? suggestedJourneyCondition : "unknown";
  const activeJourneyNodeId = journey?.nodeIds[Math.min(activeStep, Math.max(0, journey.nodeIds.length - 1))];
  const previousJourneyNodeId = activeStep > 0 ? journey?.nodeIds[activeStep - 1] : undefined;
  const activeJourneyNode = graph.nodes.find((node) => node.id === activeJourneyNodeId);
  const activeJourneyEdge = activeStep > 0
    ? graph.edges.find((edge) => edge.id === journey?.edgeIds?.[activeStep - 1])
      ?? graph.edges.find((edge) => edge.source === previousJourneyNodeId && edge.target === activeJourneyNodeId)
    : undefined;
  useEffect(() => {
    setActiveStep(0);
    playerRef.current?.seekTo(0);
  }, [journey?.id, viewportMode]);
  useEffect(() => {
    if (!showPlayer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePlayer();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closePlayer, showPlayer]);
  useEffect(() => {
    if (!inspectorNodeId) return;
    const animationFrame = window.requestAnimationFrame(() => inspectorCloseRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeInspector();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeInspector, inspectorNodeId]);
  const selectedNode = selectedNodeId ? visibleGraph.nodes.find((candidate) => candidate.id === selectedNodeId) : undefined;
  const selectedIncomingEdges = selectedNode ? visibleGraph.edges.filter((edge) => edge.target === selectedNode.id) : [];
  const selectedOutgoingEdges = selectedNode ? visibleGraph.edges.filter((edge) => edge.source === selectedNode.id) : [];
  const selectedCorridor = useMemo(() => buildCausalCorridor(selectedNodeId, visibleGraph), [selectedNodeId, visibleGraph]);
  const flowFocus = flowFocusId ? graph.nodes.find((candidate) => candidate.id === flowFocusId) : undefined;
  const inspectorNode = graph.nodes.find((candidate) => candidate.id === inspectorNodeId);
  const entryNode = graph.nodes.find((candidate) => candidate.id === entryNodeId);
  const journeySet = useMemo(() => new Set(journey?.nodeIds ?? []), [journey]);
  const selectedJourneyIndex = selectedNode && journey ? journey.nodeIds.indexOf(selectedNode.id) : -1;
  const selectedRecommendation = selectedNode ? recommendScreenPlacement(graph, selectedNode, journey, entryNodeId) : undefined;
  const journeyEdgeSet = useMemo(
    () => new Set((journey?.nodeIds ?? []).slice(1).map((target, index) => `${journey?.nodeIds[index]}->${target}`)),
    [journey],
  );
  const journeyEdgeIds = useMemo(
    () => new Set(visibleGraph.edges.filter((edge) => journeyEdgeSet.has(`${edge.source}->${edge.target}`)).map((edge) => edge.id)),
    [journeyEdgeSet, visibleGraph.edges],
  );
  const journeyContext = useMemo(() => {
    const nodeIds = new Set(journeySet);
    const edgeIds = new Set(journeyEdgeIds);

    for (const edge of visibleGraph.edges) {
      if ((edge.conditions?.length ?? 0) === 0 || !journeySet.has(edge.source)) continue;
      nodeIds.add(edge.target);
      edgeIds.add(edge.id);
    }

    return { nodeIds, edgeIds };
  }, [journeyEdgeIds, journeySet, visibleGraph.edges]);
  const contextNodeIds = selectedCorridor.nodeIds.size > 0 ? selectedCorridor.nodeIds : journeyContext.nodeIds;
  const contextEdgeIds = selectedCorridor.edgeIds.size > 0 ? selectedCorridor.edgeIds : journeyContext.edgeIds;
  const layoutStorageKey = workspaceKey(sourceGraph, `${evidenceView}:${displayMode}:${flowFocusId || "root"}:${reviewAudit ? "audit" : "map"}`);
  const layoutedNodes = useMemo(
    () => applySavedPositions(layoutNodes(visibleGraph, journeySet, entryNodeId, flowFocusId, reviewAudit, activeAuditNodeIds, auditCategoryLabels[auditCategory], displayMode, handoffNodeIds, contextNodeIds, screenReviews, selectedNodeId), layoutStorageKey),
    [visibleGraph, journeySet, entryNodeId, flowFocusId, reviewAudit, activeAuditNodeIds, auditCategory, displayMode, handoffNodeIds, contextNodeIds, screenReviews, selectedNodeId, layoutStorageKey, layoutRevision],
  );
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(layoutedNodes);
  const fitSelectedPath = useCallback((instance = flowInstanceRef.current, duration = 240) => {
    if (!instance) return;
    const currentNodes = instance.getNodes();
    const pathNodes = currentNodes.filter((node) => journeyContext.nodeIds.has(node.id));
    void instance.fitView({
      nodes: pathNodes.length > 0 ? pathNodes : currentNodes,
      padding: 0.18,
      minZoom: 0.18,
      maxZoom: 1.25,
      duration,
    });
  }, [journeyContext.nodeIds]);
  const fitWholeMap = useCallback(() => {
    void flowInstanceRef.current?.fitView({ padding: 0.12, minZoom: 0.12, maxZoom: 1.4, duration: 240 });
  }, []);
  const fitSelection = useCallback(() => {
    const instance = flowInstanceRef.current;
    if (!instance) return;
    const selected = instance.getNodes().filter((node) => node.selected || node.id === selectedNodeId);
    void instance.fitView({
      nodes: selected.length > 0 ? selected : instance.getNodes(),
      padding: 0.2,
      minZoom: 0.2,
      maxZoom: 1.6,
      duration: 220,
    });
  }, [selectedNodeId]);
  useEffect(() => {
    setFlowNodes(layoutedNodes);
  }, [layoutedNodes, setFlowNodes]);
  useEffect(() => {
    if (!selectedNodeId || showPlayer || inspectorNodeId) return;
    const closeDetailsOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeDetails();
    };
    document.addEventListener("keydown", closeDetailsOnEscape);
    return () => document.removeEventListener("keydown", closeDetailsOnEscape);
  }, [closeDetails, inspectorNodeId, selectedNodeId, showPlayer]);
  useEffect(() => {
    if (evidenceView === "screens") return;
    const animationFrame = window.requestAnimationFrame(() => {
      if (reviewAudit || flowFocusId) fitWholeMap();
      else fitSelectedPath();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [auditCategory, evidenceView, fitSelectedPath, fitWholeMap, flowFocusId, journey?.id, layoutRevision, reviewAudit]);
  const flowEdges = useMemo(
    () => layoutEdges(visibleGraph, journeyEdgeSet, reviewAudit, activeAuditNodeIds, activeAuditEdgeKeys, displayMode, contextEdgeIds),
    [visibleGraph, journeyEdgeSet, reviewAudit, activeAuditNodeIds, activeAuditEdgeKeys, displayMode, contextEdgeIds],
  );
  const framesPerStep = 54;
  const goToStep = (step: number) => {
    if (!journey) return;
    const nextStep = Math.max(0, Math.min(journey.nodeIds.length - 1, step));
    setActiveStep(nextStep);
    playerRef.current?.seekTo(nextStep * framesPerStep);
  };
  const mapScreenFlows = (nodeId: string) => {
    const relatedJourney = observedJourneys.find((candidate) => candidate.nodeIds.includes(nodeId));
    if (relatedJourney) setJourneyId(relatedJourney.id);
    setFlowFocusId(nodeId);
    setSelectedNodeId("");
    setEvidenceView("flows");
    setReviewAudit(false);
  };
  const focusAuditFinding = (finding: AuditFinding) => {
    setReviewAudit(true);
    setSelectedFindingId(finding.id);
    setEvidenceView("flows");
    setFlowFocusId(finding.nodeId);
    setSelectedNodeId(finding.nodeId);
  };
  const copyFindings = (mode: "errors" | "prompt") => {
    const requestId = ++copyRequestRef.current;
    const evidence = formatFindingsForClipboard(activeFindings);
    const payload = mode === "prompt"
      ? `Please debug the following ${graph.project.name} UI findings captured by Screenwalk. Reproduce the affected routes first, group duplicate symptoms by shared root cause, make the smallest defensible fix, and verify the affected desktop and mobile flows. Do not merely suppress console output.\n\n${evidence}`
      : evidence;
    setCopyError("");
    if (copyWithSelection(payload)) {
      showCopiedStatus(mode, setCopiedFindings);
    } else {
      setCopyError("Clipboard access is blocked in this browser. Trying the secure clipboard…");
      void navigator.clipboard?.writeText(payload).then(() => {
        if (copyRequestRef.current !== requestId) return;
        setCopyError("");
        showCopiedStatus(mode, setCopiedFindings);
      }).catch(() => {
        if (copyRequestRef.current !== requestId) return;
        setCopyError("Clipboard access was blocked. Select an item and copy it manually.");
      });
    }
  };
  const copyJourney = () => {
    if (!journey) return;
    const payload = formatJourneyForClipboard(graph, journey, activeJourneyCondition);
    const markCopied = () => {
      setCopyError("");
      setCopiedJourney(true);
      window.setTimeout(() => setCopiedJourney(false), 1800);
    };
    setCopyError("");
    if (copyWithSelection(payload)) markCopied();
    else void navigator.clipboard?.writeText(payload).then(markCopied).catch(() => setCopyError("Clipboard access was blocked. Select the path steps and copy them manually."));
  };
  const copyInstall = () => {
    const markCopied = () => {
      setCopyError("");
      setCopiedInstall(true);
      window.setTimeout(() => setCopiedInstall(false), 1800);
    };
    setCopyError("");
    const command = "npx screenwalk /absolute/path/to/app --url http://127.0.0.1:3000";
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(command).then(markCopied).catch(() => {
        copyText(command, markCopied, () => setCopyError("Clipboard access was blocked. Copy the install command from the documentation."));
      });
      return;
    }
    copyText(command, markCopied, () => setCopyError("Clipboard access was blocked. Copy the install command from the documentation."));
  };
  const handleFlowInit = useCallback((instance: ReactFlowInstance<Node<FlowNodeData>, Edge>) => {
    flowInstanceRef.current = instance;
    window.requestAnimationFrame(() => fitSelectedPath(instance, 0));
  }, [fitSelectedPath]);
  const toggleHandoffNode = useCallback((nodeId: string) => {
    setHandoffNodeIds((current) => {
      const next = new Set(current);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });
  }, []);
  const handleNodeClick = useCallback((_: unknown, node: Node<FlowNodeData>) => {
    if (selectionMode) toggleHandoffNode(node.id);
    else {
      detailsReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setShowPlayer(false);
      setInspectorNodeId(null);
      setSelectedNodeId(node.id);
    }
  }, [selectionMode, toggleHandoffNode]);
  const handleFlowKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLElement)) return;
    const nodeElement = event.target.closest<HTMLElement>(".react-flow__node[data-id]");
    const nodeId = nodeElement?.getAttribute("data-id");
    if (!nodeElement || !nodeId) return;
    event.preventDefault();
    event.stopPropagation();
    if (selectionMode) toggleHandoffNode(nodeId);
    else {
      detailsReturnFocusRef.current = nodeElement;
      setShowPlayer(false);
      setInspectorNodeId(null);
      setSelectedNodeId(nodeId);
    }
  }, [selectionMode, toggleHandoffNode]);
  const handleNodeDoubleClick = useCallback((_: unknown, node: Node<FlowNodeData>) => openInspector(node.id), [openInspector]);
  const handleNodeDragStop = useCallback((_: unknown, node: Node<FlowNodeData>) => {
    const positions = readSavedPositions(layoutStorageKey);
    positions[node.id] = node.position;
    localStorage.setItem(layoutStorageKey, JSON.stringify(positions));
  }, [layoutStorageKey]);
  const resetLayout = useCallback(() => {
    localStorage.removeItem(layoutStorageKey);
    setLayoutRevision((revision) => revision + 1);
  }, [layoutStorageKey]);
  const switchAccessView = (persona: string) => {
    setActivePersona(persona);
    setReviewAudit(false);
    setSelectedFindingId("");
    setSelectedNodeId("");
    setFlowFocusId("");
    setJourneyId("");
    setInspectorNodeId(null);
    setShowPlayer(false);
    setActiveStep(0);
    setHandoffNodeIds(new Set());
  };

  useEffect(() => {
    const restoreFromHistory = () => {
      const params = new URLSearchParams(window.location.search);
      applyingHistoryRef.current = true;
      const persona = params.get("persona") ?? "default";
      setActivePersona(personaOptions.some((option) => option.id === persona) ? persona : personaOptions[0]?.id ?? "default");
      setViewportMode(params.get("viewport") === "mobile" ? "mobile" : "desktop");
      setDisplayMode(params.get("display") === "routes" ? "routes" : "ui");
      setEvidenceView(parseEvidenceView(params.get("view")));
      setSelectedNodeId(params.get("screen") ?? "");
      setFlowFocusId(params.get("focus") ?? "");
      setJourneyId(params.get("journey") ?? "");
      setHandoffNodeIds(new Set((params.get("selected") ?? "").split(",").filter(Boolean)));
    };
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, [graph.journeys, personaOptions]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    graphKey ? params.set("graph", graphKey) : params.delete("graph");
    params.set("viewport", viewportMode);
    activePersona === "default" ? params.delete("persona") : params.set("persona", activePersona);
    params.set("display", displayMode);
    params.set("view", evidenceView === "flows" ? "connected" : evidenceView === "screens" ? "gallery" : "all");
    selectedNodeId ? params.set("screen", selectedNodeId) : params.delete("screen");
    flowFocusId ? params.set("focus", flowFocusId) : params.delete("focus");
    journey?.id ? params.set("journey", journey.id) : params.delete("journey");
    handoffNodeIds.size > 0 ? params.set("selected", [...handoffNodeIds].join(",")) : params.delete("selected");
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    if (!historyInitializedRef.current) {
      window.history.replaceState(null, "", nextUrl);
      historyInitializedRef.current = true;
    } else if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
    } else if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.pushState(null, "", nextUrl);
    }
  }, [activePersona, displayMode, evidenceView, flowFocusId, handoffNodeIds, journey?.id, selectedNodeId, viewportMode]);

  const selectedHandoffNodes = graph.nodes.filter((node) => handoffNodeIds.has(node.id));
  const copyHandoff = (mode: "routes" | "prompt") => {
    const evidence = formatScreenSelection(graph, selectedHandoffNodes, screenReviews);
    const payload = mode === "prompt"
      ? formatJourneyChangeBrief(graph, selectedHandoffNodes, screenReviews, {
        journey,
        viewport: viewportMode,
        persona: activePersona,
        conditionLabel: experienceConditionLabel(activeJourneyCondition),
      })
      : evidence;
    const markCopied = () => {
      setCopyError("");
      setCopiedSelection(mode);
      window.setTimeout(() => setCopiedSelection((current) => current === mode ? "" : current), 4_000);
    };
    setCopyError("");
    copyText(payload, markCopied, () => setCopyError("Clipboard access was blocked. Your prompt is ready, but this browser would not copy it."));
  };
  const updateScreenReview = (nodeId: string, patch: ScreenReview) => {
    setScreenReviews((current) => ({ ...current, [nodeId]: { ...current[nodeId], ...patch } }));
    setHandoffNodeIds((current) => {
      if (current.has(nodeId)) return current;
      return new Set(current).add(nodeId);
    });
  };
  const copyScreenReview = (node: FlowGraph["nodes"][number]) => {
    const payload = formatScreenReviewPrompt(graph, node, screenReviews[node.id], selectedRecommendation, journey, experienceConditionLabel(activeJourneyCondition), selectedIncomingEdges, selectedOutgoingEdges);
    const markCopied = () => {
      setCopyError("");
      setCopyingReviewNodeId("");
      setCopiedReviewNodeId(node.id);
      window.setTimeout(() => setCopiedReviewNodeId((current) => current === node.id ? "" : current), 4_000);
    };
    setCopyError("");
    setCopyingReviewNodeId(node.id);
    copyText(payload, markCopied, () => {
      setCopyingReviewNodeId("");
      setCopyError("Clipboard access was blocked. Your prompt is ready, but this browser would not copy it.");
    });
  };
  useEffect(() => {
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event.target)) return;
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        setSpacePanning(true);
        return;
      }
      if (event.shiftKey && event.key === "!") {
        event.preventDefault();
        fitWholeMap();
        return;
      }
      if (event.shiftKey && event.key === "@") {
        event.preventDefault();
        fitSelection();
        return;
      }
      if (event.shiftKey && event.key === "1") {
        event.preventDefault();
        fitWholeMap();
        return;
      }
      if (event.shiftKey && event.key === "2") {
        event.preventDefault();
        fitSelection();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePanning(false);
    };
    const onBlur = () => setSpacePanning(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [fitSelection, fitWholeMap]);
  useEffect(() => {
    localStorage.setItem(reviewStorageKey, JSON.stringify(screenReviews));
  }, [reviewStorageKey, screenReviews]);
  useEffect(() => {
    localStorage.setItem(journeyReviewStorageKey, JSON.stringify(journeyReviews));
  }, [journeyReviewStorageKey, journeyReviews]);

  useEffect(() => {
    const player = playerRef.current;
    if (!showPlayer || !player || !journey) return;
    const handleTimeUpdate = (event: { detail: { frame: number } }) => {
      setActiveStep(Math.min(journey.nodeIds.length - 1, Math.floor(event.detail.frame / framesPerStep)));
    };
    player.addEventListener("timeupdate", handleTimeUpdate);
    return () => player.removeEventListener("timeupdate", handleTimeUpdate);
  }, [journey, showPlayer]);

  return (
    <main className={`studio-shell ${reviewAudit ? "is-audit" : ""} ${isHostedDemo ? "is-public-demo" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div><strong>Screenwalk</strong><small>{isHostedDemo ? "UI map and review workspace" : `${graph.project.name} · ${scanContext}`}</small></div>
        </div>
        <div className="topbar-actions core-topbar-actions">
          <button
            className={`core-review-action ${reviewAudit ? "active" : ""}`}
            type="button"
            onClick={() => { setReviewAudit((active) => !active); setEvidenceView("all"); setFlowFocusId(""); setSelectedNodeId(""); setSelectedFindingId(""); }}
            aria-pressed={reviewAudit}
          >
            {reviewAudit ? "← Back to map" : `${auditTotal} things to check`}
          </button>
          {isHostedDemo ? (
            <nav className="public-demo-nav" aria-label="Screenwalk links">
              <a href="https://screenwalk.dev">Docs</a>
              <a href="https://github.com/Chipagosfinest/screenwalk-public">GitHub</a>
              <button type="button" onClick={copyInstall}>{copiedInstall ? "Command copied" : "Use Screenwalk"}</button>
            </nav>
          ) : (
            <label className="source-switch core-source-switch">
              <span>Project</span>
              <select
                aria-label="Choose a project"
                value={graphKey ?? "fixture"}
                onChange={(event) => {
                  const value = event.target.value;
                  window.location.href = value === "fixture" ? "/" : `/?graph=${value}`;
                }}
              >
                <option value="local">This project · latest scan</option>
                <optgroup label="Example projects">
                  <option value="fixture">Screenwalk fixture</option>
                </optgroup>
              </select>
            </label>
          )}
          {personaOptions.length > 1 && <div className="viewport-toggle access-toggle" aria-label="Who is viewing the product">
            {personaOptions.map((option) => <button aria-pressed={activePersona === option.id} className={activePersona === option.id ? "active" : ""} key={option.id} type="button" onClick={() => switchAccessView(option.id)}>{option.label}</button>)}
          </div>}
        </div>
      </header>

      {showDemoGuide && (
        <section className="public-demo-guide" aria-label="Interactive demo introduction">
          <button className="public-demo-guide-close" type="button" onClick={() => setShowDemoGuide(false)} aria-label="Close introduction">×</button>
          <p className="eyebrow">Your product, in one view</p>
          <h1>Map the UI you actually built.</h1>
          <p>See every discovered screen and path—including hidden routes, modals, and drawers. Review the real interface, then copy precise changes back to your coding agent.</p>
          <ol>
            <li><span>01</span><strong>Move a screen</strong></li>
            <li><span>02</span><strong>Open its context</strong></li>
            <li><span>03</span><strong>Write the next change</strong></li>
          </ol>
          <div>
            <button type="button" onClick={() => setShowDemoGuide(false)}>Explore the live map →</button>
            <a href="https://screenwalk.dev/guide/quickstart">Five-minute setup</a>
          </div>
          <small>Sample data only. Screenwalk runs locally and does not upload your app.</small>
        </section>
      )}

      <div className="workspace">
        <aside className="rail">
          <div className="rail-chrome">
          <p className="eyebrow">{reviewAudit ? "Things to check" : "Your product"}</p>
          <h1>{reviewAudit ? "What still needs a look" : `${seenRunning} of ${graph.nodes.length} screens opened`}</h1>
          <p className="lede">{reviewAudit ? "These are things to check, not scores. Missing information does not mean something is broken." : `See the screens Screenwalk could open. Start at ${entryNode?.title ?? "the first screen"}, follow a path, or choose any screen on the map.`}</p>
          {reviewAudit ? (
            <>
              <div className="audit-tabs" aria-label="Things to check by type">
                {(Object.keys(auditCategoryLabels) as AuditCategory[]).map((category) => (
                  <button
                    aria-pressed={category === auditCategory}
                    className={category === auditCategory ? "active" : ""}
                    key={category}
                    onClick={() => { setAuditCategory(category); setSelectedFindingId(""); setSelectedNodeId(""); setFlowFocusId(""); setEvidenceView("all"); }}
                    type="button"
                  >
                    <span>{auditCategoryLabels[category]}</span><strong>{audit[category].length}</strong>
                  </button>
                ))}
              </div>
            </>
          ) : (
            journey && <label className="core-path-picker"><span>Active path</span><select value={journey.id} onChange={(event) => changeJourney(event.target.value)} onKeyDown={handleJourneyPickerKeyDown}>{visibleJourneys.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.title}</option>)}</select><small>{journeyProvenanceLabel(journey)} · {experienceConditionLabel(activeJourneyCondition)} · {journey.nodeIds.length} screens</small></label>
          )}
          </div>
          <div className="rail-scroll">
          {reviewAudit ? (
            <>
              <div className="finding-list">
                {activeFindings.length > 0 && (
                  <div className="finding-actions">
                    <button type="button" onClick={() => copyFindings("errors")}>
                      {copiedFindings === "errors" ? "Copied all" : `Copy all ${activeFindings.length}`}
                    </button>
                    <button className="is-primary" type="button" onClick={() => copyFindings("prompt")}>
                      {copiedFindings === "prompt" ? "Prompt copied" : "Copy agent prompt"}
                    </button>
                  </div>
                )}
                <span className="sr-only" aria-live="polite">
                  {copiedFindings === "errors" ? "Items copied" : copiedFindings === "prompt" ? "Agent prompt copied" : copyError}
                </span>
                {copyError && <p className="copy-error" role="status">{copyError}</p>}
                {activeFindings.map((finding) => (
                  <button className={finding.id === selectedFindingId ? "active" : ""} key={finding.id} onClick={() => focusAuditFinding(finding)} type="button">
                    <span className={`evidence-tag is-${finding.evidence}`}>{auditEvidenceLabel(finding.evidence)}</span>
                    <strong>{finding.title}</strong>
                    <code>{finding.route}</code>
                    <small title={finding.sourceFile}>{finding.detail}</small>
                  </button>
                ))}
                {activeFindings.length === 0 && <div className="all-captured"><span>✓</span><strong>Nothing else to check here.</strong></div>}
              </div>
              <details className="not-measured">
                <summary>Still needs a separate check</summary>
                <p>Accessibility · keyboard use · signed-in screens · empty and error screens · languages · other browsers</p>
              </details>
            </>
          ) : (
            <>
              {journey && <ol className="core-path-steps" aria-label={`${journey.title} screens`}>
                {journey.nodeIds.map((nodeId, index) => {
                  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
                  return <li key={`${nodeId}-${index}`}><button aria-current={selectedNodeId === nodeId ? "step" : undefined} type="button" onClick={() => setSelectedNodeId(nodeId)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{node?.title ?? nodeId}</strong><code>{node?.route}</code></div></button></li>;
                })}
              </ol>}
              {journey && <button className="core-play-action" type="button" onClick={openPlayer}>Play this path →</button>}
              <details className="core-map-summary"><summary>What else was found</summary><p><strong>{graph.nodes.length}</strong> screens · <strong>{reachableNodeIds.size}</strong> connected from start · <strong>{mapGroupCounts.known + mapGroupCounts["source-only"]}</strong> outside this path</p><button type="button" onClick={() => setReviewAudit(true)}>See what needs checking</button></details>
            </>
          )}
          </div>
        </aside>

        <section className="canvas-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{reviewAudit ? "Review" : `Map · ${graph.nodes.length} screens`}</span>
              <h2>{reviewAudit ? `${auditCategoryLabels[auditCategory]} · ${activeFindings.length} ${activeFindings.length === 1 ? "item" : "items"}` : flowFocus ? `Paths through ${flowFocus.title}` : journey?.title ?? "Product map"}</h2>
              {!reviewAudit && journey && <p className="canvas-context">{journeyProvenanceLabel(journey)} · {journey.nodeIds.length} screens. Click any screen to inspect it.</p>}
              {!reviewAudit && journey && <label className="core-mobile-path-picker"><span>Path</span><select value={journey.id} onChange={(event) => changeJourney(event.target.value)} onKeyDown={handleJourneyPickerKeyDown}>{visibleJourneys.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.title}</option>)}</select></label>}
              {evidenceView === "flows" && flowFocus && <button className="clear-flow-focus" type="button" onClick={() => { setFlowFocusId(""); setSelectedFindingId(""); if (reviewAudit) setEvidenceView("all"); }}>{reviewAudit ? `← Back to all ${auditCategoryLabels[auditCategory].toLowerCase()} items` : "Show every path we found"}</button>}
            </div>
            <div className="canvas-actions">
              <div className="viewport-toggle" aria-label="Screen size">
                <button aria-pressed={viewportMode === "desktop"} className={viewportMode === "desktop" ? "active" : ""} type="button" onClick={() => setViewportMode("desktop")}>Desktop</button>
                <button aria-pressed={viewportMode === "mobile"} className={viewportMode === "mobile" ? "active" : ""} type="button" onClick={() => setViewportMode("mobile")}>Mobile</button>
              </div>
              <div className="view-toggle" aria-label="Canvas view">
                <button aria-pressed={evidenceView === "all"} className={evidenceView === "all" ? "active" : ""} onClick={() => { setFlowFocusId(""); setEvidenceView("all"); }} type="button">Map</button>
                <button aria-pressed={evidenceView === "screens"} className={evidenceView === "screens" ? "active" : ""} onClick={() => setEvidenceView("screens")} type="button">Screens</button>
              </div>
              {reviewAudit ? (
                <div className="audit-evidence-legend" aria-label="How Screenwalk found each item"><span className="is-static">Found in code</span><span className="is-observed">Seen while using app</span><span className="is-captured">Screenshot saved</span></div>
              ) : (
                <>
                  <button aria-pressed={selectionMode} className={`selection-toggle ${selectionMode ? "active" : ""}`} type="button" onClick={() => setSelectionMode((active) => !active)}>
                    {selectionMode ? "Done selecting" : "Select"}
                  </button>
                  {evidenceView !== "screens" && <button className="focus-path-action" type="button" onClick={openPlayer}>Play</button>}
                  <details className="canvas-more core-canvas-menu">
                    <summary>More</summary>
                    <div>
                      <span>Display</span>
                      <div className="view-toggle display-toggle" aria-label="Node display">
                        <button aria-pressed={displayMode === "ui"} className={displayMode === "ui" ? "active" : ""} onClick={() => setDisplayMode("ui")} type="button">Actual UI</button>
                        <button aria-pressed={displayMode === "routes"} className={displayMode === "routes" ? "active" : ""} onClick={() => setDisplayMode("routes")} type="button">Routes</button>
                      </div>
                      <button aria-pressed={selectionMode} className="mobile-selection-action layout-action" type="button" onClick={() => setSelectionMode((active) => !active)}>
                        {selectionMode ? "Done selecting" : "Select screens"}
                      </button>
                      <button aria-pressed={rearrangeMode} className={`layout-action ${rearrangeMode ? "active" : ""}`} type="button" onClick={() => setRearrangeMode((active) => !active)}>
                        {rearrangeMode ? "Done moving screens" : "Move screens"}
                      </button>
                      {evidenceView !== "screens" && <button className="layout-action" type="button" onClick={resetLayout}>Reset layout</button>}
                      {evidenceView !== "screens" && <button className="layout-action" type="button" onClick={fitWholeMap}>Fit all · Shift 1</button>}
                      {evidenceView !== "screens" && <button className="layout-action" type="button" onClick={fitSelection}>Fit selection · Shift 2</button>}
                    </div>
                  </details>
                </>
              )}
            </div>
          </div>
          <div className={`canvas-workspace ${selectedNode && evidenceView !== "screens" ? "has-detail-pane" : ""}`}>
            <div className="flow-wrap">
            {evidenceView === "screens" ? (
              <div className="screen-gallery">
                {visibleGraph.nodes.map((node) => (
                  <button className={`gallery-card ${displayMode === "routes" ? "is-route-only" : ""} ${handoffNodeIds.has(node.id) ? "is-handoff-selected" : ""}`} key={node.id} type="button" onClick={() => selectionMode ? toggleHandoffNode(node.id) : mapScreenFlows(node.id)} aria-label={selectionMode ? `${handoffNodeIds.has(node.id) ? "Remove" : "Add"} ${node.title} ${handoffNodeIds.has(node.id) ? "from" : "to"} agent handoff` : `Map flows through ${node.title}`} aria-pressed={selectionMode ? handoffNodeIds.has(node.id) : undefined}>
                    {displayMode === "ui" ? <span className="gallery-preview">{node.capture ? <img decoding="async" loading="lazy" src={node.capture.asset} alt={`${node.title} screen`} /> : <span className="missing-variant">No {viewportMode} screenshot</span>}{node.capture && node.capture.quality !== "ready" && <em>{node.capture.quality === "loading" ? "Still loading" : "Screen looks empty"}</em>}</span> : <span className="gallery-route-preview"><code>{node.route}</code><small>{node.capture ? "Screen opened" : "Found in code"}</small></span>}
                    <span className="gallery-meta"><strong>{node.title}</strong><code>{node.route}</code><small>Map its flows →</small></span>
                  </button>
                ))}
              </div>
            ) : (
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onInit={handleFlowInit}
                minZoom={0.12}
                maxZoom={2.4}
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                zoomOnScroll={false}
                zoomOnPinch
                zoomOnDoubleClick
                panOnDrag={spacePanning || !rearrangeMode ? (spacePanning ? true : [1, 2]) : [1, 2]}
                selectionOnDrag={false}
                nodesDraggable={rearrangeMode}
                nodesConnectable={false}
                edgesReconnectable={false}
                elementsSelectable={false}
                onKeyDown={handleFlowKeyDown}
                onNodeClick={handleNodeClick}
                onSelectionChange={({ nodes: selectedFlowNodes }) => {
                  const keyboardSelectedNode = selectedFlowNodes.at(-1);
                  if (!selectionMode && keyboardSelectedNode && keyboardSelectedNode.id !== selectedNodeId) {
                    detailsReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    setSelectedNodeId(keyboardSelectedNode.id);
                  }
                }}
                onNodeDoubleClick={handleNodeDoubleClick}
                onNodeDragStop={handleNodeDragStop}
                onPaneClick={() => setSelectedNodeId("")}
                onlyRenderVisibleElements={flowNodes.length > 24}
                proOptions={proOptions}
                className={`${spacePanning ? "is-space-panning" : ""} ${rearrangeMode ? "is-rearranging" : ""}`.trim() || undefined}
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#c8c0b2" />
                <Controls showInteractive={false} />
              </ReactFlow>
            )}
            {evidenceView !== "screens" && (
              <p className="canvas-status" role="status">
                <span>{isHostedDemo ? "Demo · sample data" : "Local · this Mac only"}</span>
                <strong>
                  {spacePanning
                    ? "Panning the map"
                    : rearrangeMode
                      ? selectedNode
                        ? `Drag to move ${selectedNode.title}`
                        : "Drag a screen to rearrange"
                      : selectionMode
                        ? "Click screens to add to your agent prompt"
                        : selectedNode
                          ? `${selectedNode.title} selected · open the screen or copy it for your agent`
                          : "Choose a screen to see more · scroll to move around"}
                </strong>
                <small>{isHostedDemo ? "Your notes stay in this browser" : rearrangeMode ? "Moving a card does not change the product" : "Only you can see these changes"}</small>
              </p>
            )}
            </div>
          {selectedNode && reviewAudit && selectedFinding && evidenceView !== "screens" && (
            <aside className="node-drawer audit-drawer" aria-label={`${selectedNode.title} check details`}>
              <button className="drawer-close" type="button" onClick={closeDetails} aria-label="Close details">×</button>
              <div><span>{auditEvidenceLabel(selectedFinding.evidence)}</span><strong>{selectedFinding.title}</strong></div>
              <code>{selectedFinding.sourceFile}</code>
              <p>{selectedFinding.detail}</p>
              <b>{auditCategoryLabels[selectedFinding.category]}</b>
            </aside>
          )}
          {selectedNode && (!reviewAudit || !selectedFinding) && evidenceView !== "screens" && (
            <aside className="node-drawer core-node-drawer" aria-label={`${selectedNode.title} screen details`}>
              <button className="drawer-close" type="button" onClick={closeDetails} aria-label="Close details">×</button>
              <div className="drawer-identity">
                <span>Selected · click another screen or press Esc</span>
                <strong>{selectedNode.title}</strong>
                <code>{selectedNode.route}</code>
                <small>{selectedNode.identity && selectedNode.identity.presentation.kind !== "page" ? `${selectedNode.identity.presentation.kind} state · ` : ""}{selectedNode.id === entryNodeId ? "Starting screen" : selectedJourneyIndex >= 0 ? `Step ${selectedJourneyIndex + 1} of the current path` : "Not on the current path"}</small>
              </div>
              <div className="core-connection-grid">
                <section className="causal-section">
                  <span>Arrived from</span>
                  {selectedIncomingEdges.length > 0 ? selectedIncomingEdges.map((edge) => {
                    const source = visibleGraph.nodes.find((node) => node.id === edge.source);
                    return <button type="button" key={edge.id} onClick={() => setSelectedNodeId(edge.source)}><strong>← {source?.title ?? edge.source}</strong><small>{edgeActionLabel(edge.action, selectedNode.title)}</small></button>;
                  }) : <p>{selectedNode.id === entryNodeId ? "This is where the app starts." : "No incoming path is mapped."}</p>}
                </section>
                <section className="causal-section core-next-doors">
                  <span>Where you can go next</span>
                  {selectedOutgoingEdges.length > 0 ? selectedOutgoingEdges.map((edge) => {
                    const target = visibleGraph.nodes.find((node) => node.id === edge.target);
                    return <button type="button" key={edge.id} onClick={() => setSelectedNodeId(edge.target)}><strong>{edgeActionLabel(edge.action, target?.title)} →</strong><small>{target?.title ?? edge.target}</small></button>;
                  }) : <p>This path ends here.</p>}
                </section>
              </div>
              {selectedNode.capture && <button className="inspect-button core-inspect-action" type="button" onClick={() => openInspector(selectedNode.id)}>Open actual UI</button>}
              <div className="core-feedback-stack" aria-label="Screen feedback for the next implementation round">
                <div className="core-feedback-intro"><strong>Turn this screen into a change brief</strong><span>Be specific about the edit and the result you expect. Your notes stay in this browser until you copy them.</span></div>
                <label className="core-feedback"><span>What should change?</span><textarea value={screenReviews[selectedNode.id]?.note ?? ""} onChange={(event) => updateScreenReview(selectedNode.id, { note: event.target.value })} placeholder="Describe the specific critique or edit for the next round." rows={4} /></label>
                <label className="core-feedback"><span>Done when</span><textarea value={screenReviews[selectedNode.id]?.acceptanceCriteria ?? ""} onChange={(event) => updateScreenReview(selectedNode.id, { acceptanceCriteria: event.target.value })} placeholder="State the observable result that should pass on the next review." rows={3} /></label>
              </div>
              <p className={copyError ? "copy-error" : "sr-only"} role="status" aria-live="polite">{copyError || (copiedReviewNodeId === selectedNode.id ? "Change brief copied" : "")}</p>
              <button className="copy-review core-copy-action" type="button" onClick={() => copyScreenReview(selectedNode)} disabled={copyingReviewNodeId === selectedNode.id}>{copiedReviewNodeId === selectedNode.id ? "Brief copied" : copyingReviewNodeId === selectedNode.id ? "Copying brief…" : "Copy change brief"}</button>
              <details className="core-screen-more">
                <summary>Evidence and diagnostics</summary>
                <div className="core-proof-row"><span>{selectedNode.capture?.quality === "ready" ? "Screenwalk opened this" : "Found in code, not opened"}</span><code>{selectedNode.sourceFile}:{selectedNode.evidence[0]?.line ?? 1}</code></div>
                {selectedNode.identity?.review.status === "needs-review" && <div className="identity-review"><strong>Review this grouping</strong><p>{selectedNode.identity.review.reasons.join(" ")}</p><small>{selectedNode.identity.review.suggestions[0]?.reason}</small></div>}
                {selectedNode.diagnostics.length > 0 && <p className="core-diagnostic-count">{selectedNode.diagnostics.length} browser {selectedNode.diagnostics.length === 1 ? "issue" : "issues"} on this screen</p>}
              </details>
            </aside>
          )}
          {selectedHandoffNodes.length > 0 && (
            <div className="handoff-tray" role="region" aria-label="Selected screens for agent handoff">
              <div><strong>{selectedHandoffNodes.length} selected</strong><span>{copyError || selectedHandoffNodes.slice(0, 3).map((node) => node.title).join(" · ")}{!copyError && selectedHandoffNodes.length > 3 ? ` +${selectedHandoffNodes.length - 3}` : ""}</span></div>
              <button type="button" onClick={() => copyHandoff("routes")}>{copiedSelection === "routes" ? "Copied" : "Copy routes + files"}</button>
              <button className="is-primary" type="button" onClick={() => copyHandoff("prompt")}>{copiedSelection === "prompt" ? "Copied" : "Copy change brief"}</button>
              <button className="is-clear" type="button" onClick={() => setHandoffNodeIds(new Set())}>Clear</button>
            </div>
          )}
          </div>
        </section>

        {showPlayer && <aside className="player-panel" aria-label="Journey player">
          <div className="panel-heading">
            <div><span className="eyebrow">Walk through this path · {journey ? journeyProvenanceLabel(journey) : "not checked yet"}</span><h2>{journey?.title ?? "No path selected"}</h2></div>
            <div className="player-heading-actions"><button type="button" onClick={copyJourney}>{copiedJourney ? "Path copied" : "Copy path for agent"}</button><button ref={playerCloseRef} className="close-player" type="button" onClick={closePlayer} aria-label="Close journey player">×</button></div>
          </div>
          {journey && (
            <Suspense fallback={<div className="player-loading" role="status">Preparing playback…</div>}>
              <JourneyPlayer ref={playerRef} graph={graph} nodeIds={journey.nodeIds} framesPerStep={framesPerStep} onReady={focusPlayerClose} />
            </Suspense>
          )}
          {journey && <div className="transport">
            <button type="button" onClick={() => goToStep(0)} disabled={activeStep === 0}>↺ Restart</button>
            <button type="button" onClick={() => goToStep(activeStep - 1)} disabled={activeStep === 0}>← Previous</button>
            <span><strong>{activeStep + 1}</strong> / {journey.nodeIds.length}</span>
            <button type="button" onClick={() => goToStep(activeStep + 1)} disabled={activeStep >= journey.nodeIds.length - 1}>Trace next →</button>
          </div>}
          {journey && activeJourneyNode && <div className="trace-explainer" aria-live="polite">
            <span className={activeJourneyEdge?.observations?.length ? "is-observed" : "is-static"}>{activeStep === 0 ? "Start" : activeJourneyEdge?.observations?.length ? "Tried" : "Suggested"}</span>
            <strong>{activeStep === 0 ? activeJourneyNode.title : `${edgeActionLabel(activeJourneyEdge?.action ?? "Continue")} → ${activeJourneyNode.title}`}</strong>
            <small>{activeStep === 0 ? activeJourneyNode.route : activeJourneyEdge?.observations?.length ? `${activeJourneyEdge.observations.length} successful browser check${activeJourneyEdge.observations.length === 1 ? "" : "s"}` : "Has not been tried yet"}</small>
          </div>}
          <div className="timeline">
            {journey?.nodeIds.map((nodeId, index) => {
              const node = graph.nodes.find((candidate) => candidate.id === nodeId);
              return <button className={index === activeStep ? "active" : ""} type="button" aria-current={index === activeStep ? "step" : undefined} aria-label={`Trace step ${index + 1}: ${node?.title ?? nodeId}`} onClick={() => goToStep(index)} key={`${nodeId}-${index}`}><span>{index + 1}</span><strong>{node?.title}</strong><small>{node?.route}</small></button>;
            })}
          </div>
          {copyError && <p className="copy-error player-copy-error" role="status">{copyError}</p>}
        </aside>}
      </div>
      {inspectorNode?.capture && (
        <section className="screen-inspector" role="dialog" aria-modal="true" aria-label={`${inspectorNode.title} screen capture`}>
          <header>
            <div><span className="eyebrow">Screen opened in the app</span><h2>{inspectorNode.title}</h2><code>{inspectorNode.capture.url}</code></div>
            <button ref={inspectorCloseRef} type="button" onClick={closeInspector} aria-label="Close screen inspector">Close</button>
          </header>
          <div className="inspector-canvas"><img decoding="async" src={inspectorNode.capture.asset} alt={`${inspectorNode.title} screen`} /></div>
          <div className="inspector-evidence">
            <span><b>Source</b><code>{inspectorNode.sourceFile}</code></span>
            <span><b>What Screenwalk tried</b>{interactionCoverageSummary(inspectorNode)}</span>
            {inspectorNode.identity && <span><b>Screen family</b><code>{inspectorNode.identity.routeTemplate}</code>{inspectorNode.identity.presentation.kind !== "page" ? ` · ${inspectorNode.identity.presentation.kind}` : ""}</span>}
            {inspectorNode.capture.context && <span><b>How it was opened</b>{inspectorNode.capture.context.persona} · {inspectorNode.capture.context.viewport} · {inspectorNode.capture.context.browser}{inspectorNode.capture.context.locale ? ` · ${inspectorNode.capture.context.locale}` : ""}</span>}
          </div>
          <footer><span>{inspectorNode.capture.viewport.width} × {inspectorNode.capture.viewport.height}</span><span>{new Date(inspectorNode.capture.observedAt).toLocaleString()}</span><strong>{inspectorNode.diagnostics.reduce((total, diagnostic) => total + (diagnostic.count ?? 1), 0)} browser issues</strong></footer>
        </section>
      )}
    </main>
  );
}

function copyWithSelection(value: string): boolean {
  const field = document.createElement("textarea");
  try {
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

function parseEvidenceView(value: string | null): "flows" | "screens" | "all" {
  if (value === "connected" || value === "flows") return "flows";
  if (value === "gallery" || value === "screens") return "screens";
  return "all";
}

function copyText(value: string, onCopied: () => void, onBlocked: () => void): void {
  if (copyWithSelection(value)) {
    onCopied();
    return;
  }
  if (!navigator.clipboard) {
    onBlocked();
    return;
  }
  void navigator.clipboard.writeText(value).then(onCopied).catch(onBlocked);
}

function showCopiedStatus(mode: "errors" | "prompt", update: Dispatch<SetStateAction<"errors" | "prompt" | "">>): void {
  update(mode);
  window.setTimeout(() => update((current) => current === mode ? "" : current), 1800);
}

function withCaptureJourney(input: FlowGraph): FlowGraph {
  if (input.journeys.some((journey) => journey.kind === "observed")) return input;
  const captured = input.nodes.filter((node) => node.capture).map((node) => node.id);
  if (captured.length === 0) return input;
  return {
    ...input,
    journeys: [
      { id: "journey:captured", title: "Captured local states", nodeIds: captured },
      ...input.journeys,
    ],
  };
}

function polishCapturedGraph(input: FlowGraph): FlowGraph {
  const nodes = input.nodes.map((node) => {
    const capturedTitle = node.captureVariants?.mobile?.title || node.captureVariants?.desktop?.title || node.capture?.title;
    const clustered = { ...node, diagnostics: clusterDiagnostics(node.diagnostics) };
    if (!capturedTitle || node.sourceFile !== "(browser discovery)") return clustered;
    return { ...clustered, title: capturedTitle.replace(/\s+·\s+[^·]+$/, "").trim() || node.title };
  });
  const titleById = new Map(nodes.map((node) => [node.id, node.title]));
  const journeys = input.journeys.map((journey) => {
    if (journey.nodeIds.length === 0) return journey;
    const firstNodeId = journey.nodeIds[0];
    if (!firstNodeId) return journey;
    const screenTitles = journey.nodeIds.map((nodeId) => titleById.get(nodeId)).filter((title): title is string => Boolean(title));
    if (screenTitles.length === 0) return journey;
    const shouldReplaceTitle = journey.kind === "observed" || /^Journey\s+\d+$/i.test(journey.title);
    return shouldReplaceTitle ? { ...journey, title: screenTitles.join(" → ") } : journey;
  });
  return { ...input, nodes, journeys };
}

function graphForViewport(input: FlowGraph, viewport: "desktop" | "mobile"): FlowGraph {
  return {
    ...input,
    nodes: input.nodes.map((node) => ({
      ...node,
      capture: viewport === "desktop" ? node.captureVariants?.desktop ?? node.capture : node.captureVariants?.mobile,
    })),
  };
}

function accessViews(input: FlowGraph): Array<{ id: string; label: string }> {
  const personaIds = [...new Set(input.nodes.map((node) => node.persona))];
  return personaIds.map((id) => {
    if (id === "default") return { id, label: "Public" };
    const evidence = input.nodes
      .filter((node) => node.persona === id)
      .flatMap((node) => node.evidence)
      .find((item) => item.kind === "declared" && item.detail.startsWith("Access persona: "));
    return { id, label: evidence?.detail.slice("Access persona: ".length) || id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") };
  });
}

function graphForPersona(input: FlowGraph, persona: string): FlowGraph {
  const nodes = input.nodes.filter((node) => node.persona === persona);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...input,
    nodes,
    edges: input.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    journeys: input.journeys.filter((journey) => journey.nodeIds.every((nodeId) => nodeIds.has(nodeId))),
  };
}

function filterGraph(input: FlowGraph, view: "flows" | "screens" | "all", entryNodeId: string, flowFocusId: string): FlowGraph {
  if (view === "all") return input;
  if (view === "screens") return { ...input, edges: [] };
  const observedEdges = input.edges.filter((edge) => (edge.observations?.length ?? 0) > 0);
  if (flowFocusId) {
    const relatedNodeIds = new Set<string>([flowFocusId]);
    const relatedJourneys = input.journeys.filter((journey) => journey.kind === "observed" && journey.nodeIds.includes(flowFocusId));
    const journeyEdgeKeys = new Set<string>();
    relatedJourneys.forEach((journey) => {
      journey.nodeIds.forEach((nodeId, index) => {
        relatedNodeIds.add(nodeId);
        if (index > 0) journeyEdgeKeys.add(`${journey.nodeIds[index - 1]}->${nodeId}`);
      });
    });
    input.edges.forEach((edge) => {
      if (edge.source === flowFocusId) relatedNodeIds.add(edge.target);
      if (edge.target === flowFocusId) relatedNodeIds.add(edge.source);
    });
    return {
      ...input,
      nodes: input.nodes.filter((node) => relatedNodeIds.has(node.id)),
      edges: dedupeEdges(input.edges.filter((edge) => relatedNodeIds.has(edge.source) && relatedNodeIds.has(edge.target) && (edge.source === flowFocusId || edge.target === flowFocusId || journeyEdgeKeys.has(`${edge.source}->${edge.target}`)))),
      journeys: relatedJourneys,
    };
  }
  const levels = new Map<string, number>([[entryNodeId, 0]]);
  const queue = [entryNodeId];
  while (queue.length > 0) {
    const source = queue.shift();
    if (!source) continue;
    const level = levels.get(source) ?? 0;
    for (const edge of observedEdges.filter((candidate) => candidate.source === source)) {
      if (levels.has(edge.target)) continue;
      levels.set(edge.target, level + 1);
      queue.push(edge.target);
    }
  }
  const flowNodeIds = new Set(levels.keys());
  const nodes = input.nodes.filter((node) => flowNodeIds.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  return {
    ...input,
    nodes,
    edges: observedEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && (levels.get(edge.target) ?? 0) > (levels.get(edge.source) ?? 0)),
    journeys: input.journeys.filter((journey) => journey.kind === "observed"),
  };
}

function layoutNodes(graph: FlowGraph, journeySet: Set<string>, entryNodeId: string, flowFocusId: string, reviewAudit: boolean, auditNodeIds: Set<string>, auditLabel: string, displayMode: "ui" | "routes", handoffNodeIds: Set<string>, contextNodeIds: Set<string>, reviews: Record<string, ScreenReview>, inspectedNodeId = ""): Node<FlowNodeData>[] {
  const reachableNodeIds = reachableFrom(entryNodeId, graph.edges);
  const incomingPortIds = new Map(graph.nodes.map((node) => [node.id, graph.edges.filter((edge) => edge.target === node.id).map((edge) => edge.id)]));
  const outgoingPortIds = new Map(graph.nodes.map((node) => [node.id, graph.edges.filter((edge) => edge.source === node.id).map((edge) => edge.id)]));
  const nodeData = (node: FlowGraph["nodes"][number], isFocus: boolean, laneLabel?: string): FlowNodeData => {
    const classification = classifyMapNode(node, reachableNodeIds, entryNodeId);
    return {
      ...node,
      selectedJourney: !reviewAudit && journeySet.has(node.id),
      isEntry: node.id === entryNodeId,
      isFocus,
      isCaptureGap: !node.capture,
      mapGroup: classification.group,
      mapRole: classification.role,
      mapGroupReason: classification.reason,
      showRouteOnly: displayMode === "routes",
      isAuditActive: reviewAudit,
      isAuditFinding: auditNodeIds.has(node.id),
      isHandoffSelected: handoffNodeIds.has(node.id),
      isInspected: node.id === inspectedNodeId,
      reviewStatus: reviews[node.id]?.status,
      hasReviewNote: Boolean(reviews[node.id]?.note?.trim()),
      isContextMuted: !reviewAudit && contextNodeIds.size > 0 && !contextNodeIds.has(node.id),
      incomingPortIds: incomingPortIds.get(node.id) ?? [],
      outgoingPortIds: outgoingPortIds.get(node.id) ?? [],
      laneLabel,
      experienceStage: screenStageLabel(node),
      auditLabel,
    };
  };
  if (flowFocusId && graph.nodes.some((node) => node.id === flowFocusId)) {
    const incoming = new Set(graph.edges.filter((edge) => edge.target === flowFocusId).map((edge) => edge.source));
    const outgoing = new Set(graph.edges.filter((edge) => edge.source === flowFocusId).map((edge) => edge.target));
    const outerRowCount = Math.max(incoming.size, outgoing.size, 1);
    const rowCounts = new Map<number, number>();
    return graph.nodes.map((node) => {
      const column = node.id === flowFocusId ? 1 : incoming.has(node.id) ? 0 : outgoing.has(node.id) ? 2 : 3;
      const row = rowCounts.get(column) ?? 0;
      rowCounts.set(column, row + 1);
      const xGap = displayMode === "routes" ? 350 : 400;
      const yGap = displayMode === "routes" ? 150 : 225;
      const basePosition = { x: column * xGap, y: node.id === flowFocusId ? (outerRowCount - 1) * yGap / 2 : row * yGap };
      return {
        id: node.id,
        type: "screen",
        ariaRole: "button" as const,
        focusable: true,
        position: basePosition,
        data: nodeData(node, node.id === flowFocusId, node.id === flowFocusId ? "Selected screen" : incoming.has(node.id) && row === 0 ? "Arrived from" : outgoing.has(node.id) && row === 0 ? "Doors from here" : undefined),
      };
    });
  }
  const levels = topologyLevels(graph, entryNodeId);
  const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const rowsByLevel = new Map<number, string[]>();
  const maxLinkedLevel = Math.max(0, ...levels.values());
  for (let level = 0; level <= maxLinkedLevel; level += 1) {
    const previousRows = rowsByLevel.get(level - 1) ?? [];
    const previousIndex = new Map(previousRows.map((nodeId, index) => [nodeId, index]));
    const candidates = graph.nodes.filter((node) => levels.get(node.id) === level);
    candidates.sort((a, b) => {
      const parentScore = (nodeId: string) => {
        const parentRows = graph.edges
          .filter((edge) => edge.target === nodeId && (levels.get(edge.source) ?? -1) < level)
          .map((edge) => previousIndex.get(edge.source))
          .filter((value): value is number => value !== undefined);
        return parentRows.length > 0 ? parentRows.reduce((sum, value) => sum + value, 0) / parentRows.length : Number.POSITIVE_INFINITY;
      };
      const scoreDifference = parentScore(a.id) - parentScore(b.id);
      if (Number.isFinite(scoreDifference) && scoreDifference !== 0) return scoreDifference;
      if (a.route === b.route && a.stateKey !== b.stateKey) return a.stateKey === "default" ? -1 : b.stateKey === "default" ? 1 : a.stateKey.localeCompare(b.stateKey);
      return (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0);
    });
    rowsByLevel.set(level, candidates.map((node) => node.id));
  }
  const maxRows = Math.max(1, ...[...rowsByLevel.values()].map((rows) => rows.length));
  const xGap = displayMode === "routes" ? 350 : 400;
  const yGap = displayMode === "routes" ? 150 : 225;
  const linkedColumnCount = maxLinkedLevel + 1;
  const detachedColumnCount = Math.max(linkedColumnCount, 3);
  const detachedGroups = (["known", "source-only"] as const).map((group) => ({
    group,
    nodes: graph.nodes.filter((node) => !levels.has(node.id) && classifyMapNode(node, reachableNodeIds, entryNodeId).group === group),
  })).filter(({ nodes }) => nodes.length > 0);
  const detachedPositions = new Map<string, { x: number; y: number; laneLabel?: string }>();
  let detachedTop = maxRows * yGap + 240;
  detachedGroups.forEach(({ group, nodes }) => {
    nodes.forEach((node, index) => detachedPositions.set(node.id, {
      x: (index % detachedColumnCount) * xGap,
      y: detachedTop + Math.floor(index / detachedColumnCount) * yGap,
      laneLabel: index === 0 ? group === "known" ? "Other screens · no way in found" : "Found in code · not reached yet" : undefined,
    }));
    detachedTop += Math.ceil(nodes.length / detachedColumnCount) * yGap + 150;
  });
  return graph.nodes.map((node) => {
    const linkedLevel = levels.get(node.id);
    const levelRows = linkedLevel === undefined ? [] : rowsByLevel.get(linkedLevel) ?? [];
    const row = linkedLevel === undefined ? 0 : Math.max(0, levelRows.indexOf(node.id));
    const detachedPosition = detachedPositions.get(node.id);
    const basePosition = linkedLevel === undefined
      ? detachedPosition ?? { x: 0, y: detachedTop }
      : { x: linkedLevel * xGap, y: ((maxRows - levelRows.length) / 2 + row) * yGap };
    return {
      id: node.id,
      type: "screen",
      ariaRole: "button" as const,
      focusable: true,
      position: basePosition,
      data: nodeData(node, false, linkedLevel === undefined ? detachedPosition?.laneLabel : row === 0 && linkedLevel > 0 ? linkedLevel === 1 ? "First choices" : `Step ${linkedLevel}` : undefined),
    };
  });
}

function layoutEdges(graph: FlowGraph, journeyEdgeSet: Set<string>, reviewAudit: boolean, auditNodeIds: Set<string>, auditEdgeKeys: Set<string>, displayMode: "ui" | "routes", contextEdgeIds: Set<string>): Edge[] {
  const entryNodeId = graph.nodes.find((node) => node.route === "/")?.id ?? graph.nodes[0]?.id ?? "";
  const levels = topologyLevels(graph, entryNodeId);
  const outgoingCounts = new Map<string, number>();
  const titleById = new Map(graph.nodes.map((node) => [node.id, node.title]));
  graph.edges.forEach((edge) => outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1));
  return graph.edges.map((edge) => {
    const active = journeyEdgeSet.has(`${edge.source}->${edge.target}`);
    const observed = (edge.observations?.length ?? 0) > 0;
    const contextMatch = contextEdgeIds.has(edge.id);
    const returnEdge = (levels.get(edge.target) ?? 0) <= (levels.get(edge.source) ?? 0);
    const edgeKey = auditEdgeKey(edge);
    const auditMatch = auditEdgeKeys.size > 0 ? auditEdgeKeys.has(edgeKey) : auditNodeIds.has(edge.source) || auditNodeIds.has(edge.target);
    const stroke = reviewAudit ? auditMatch ? "#a65f20" : "#b9b0a5" : active ? "#3f5bd8" : observed ? "#3d8762" : "#a9a093";
    const mutedByContext = !reviewAudit && contextEdgeIds.size > 0 && !contextMatch;
    const siblingCount = outgoingCounts.get(edge.source) ?? 0;
    const showLabel = displayMode === "ui" && !mutedByContext && (Boolean(edge.conditions?.length) || active || (!returnEdge && ((siblingCount > 1 && siblingCount <= 5) || (contextMatch && siblingCount <= 6))));
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.id,
      targetHandle: edge.id,
      label: showLabel ? conditionalEdgeLabel(edge, graph.nodes.find((node) => node.id === edge.target)) : undefined,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      interactionWidth: 24,
      pathOptions: { borderRadius: 18, offset: returnEdge ? 46 : 34 },
      style: {
        stroke,
        strokeWidth: reviewAudit ? auditMatch ? 2.4 : 1.2 : active ? 3 : observed ? 1.8 : 1.35,
        strokeDasharray: returnEdge ? "3 7" : observed ? undefined : "8 6",
        opacity: reviewAudit && !auditMatch ? 0.16 : mutedByContext ? 0.1 : returnEdge && !active && !contextMatch ? 0.14 : 1,
      },
      zIndex: active || contextMatch ? 3 : 0,
      labelStyle: { fill: active ? "#3048b8" : "#5f584f", fontSize: 11, fontWeight: 700 },
      labelBgStyle: { fill: "#fbfaf7", fillOpacity: 0.98, stroke: active ? "#b9c4f5" : "#d8d1c7", strokeWidth: 1 },
      labelBgPadding: [8, 5] as [number, number],
      labelBgBorderRadius: 6,
    };
  });
}

function conditionalEdgeLabel(edge: FlowGraph["edges"][number], target?: FlowGraph["nodes"][number]): string {
  if (edge.conditions?.length) {
    const joiner = edge.conditionLogic === "any" ? " or " : " + ";
    return `If ${edge.conditions.map((condition) => condition.label).join(joiner)}`;
  }
  const action = edgeActionLabel(edge.action, target?.title);
  const signal = `${edge.action} ${target?.title ?? ""} ${target?.route ?? ""} ${target?.stateKey ?? ""}`.toLowerCase();
  if (target?.stateKey === "error" || /\b(error|failed|failure|denied|declined|retry)\b/.test(signal)) return `Failure · ${action}`;
  if (/\b(success|complete|completed|approved|confirmed|receipt|thank-you)\b/.test(signal)) return `Success · ${action}`;
  if (/\b(login|log-in|sign-in|signin|password|oauth|authenticate)\b/.test(signal)) return `Signed out · ${action}`;
  return action;
}

function screenStageLabel(node: FlowGraph["nodes"][number]): string {
  if (node.route === "/") return "Entry";
  if (node.stateKey === "error" || node.stateKey === "not-found") return "Recovery";
  const signal = `${node.route} ${node.title}`.toLowerCase();
  if (/\b(auth|login|log-in|signin|sign-in|password|oauth|verify|security)\b/.test(signal)) return "Access";
  if (/\b(onboard(?:ing)?|enroll|setup|install|get-started|welcome|activate)\b/.test(signal)) return "Onboarding";
  if (/\b(checkout|payment|billing|pricing|subscribe|upgrade|purchase)\b/.test(signal)) return "Conversion";
  if (/\b(terms|privacy|cookies?|accessibility)\b/.test(signal) || node.route === "/legal") return "Policy";
  if (/\b(docs|help|support|contact|status|changelog)\b/.test(signal)) return "Reference";
  if (/\b(dashboard|account|profile|settings|admin|console|workspace|projects?)\b/.test(signal)) return "Product";
  return node.stateKey === "loading" ? "Transition" : "Screen";
}

function classifyMapNode(node: FlowGraph["nodes"][number], reachableNodeIds: Set<string>, entryNodeId: string): MapClassification {
  if (node.id === entryNodeId || reachableNodeIds.has(node.id)) {
    return { group: "connected", role: "connected", reason: "Reached from the starting screen" };
  }
  const signal = `${node.route} ${node.title}`.toLowerCase();
  const likelyPolicy = /(^|[/\s-])(terms(?:-of-service)?|privacy(?:-policy)?|third-party-service-terms|cookies?|accessibility)([/\s-]|$)/.test(signal) || node.route === "/legal";
  const likelyReference = /(^|[/\s-])(docs?|help|support|status|changelog)([/\s-]|$)/.test(signal);
  const hasBrowserProof = Boolean(node.capture) || node.evidence.some((evidence) => evidence.kind === "observed");
  const role: MapRole = likelyPolicy ? "policy" : likelyReference ? "reference" : hasBrowserProof ? "direct-entry" : "unknown";
  if (hasBrowserProof) {
    return {
      group: "known",
      role,
      reason: likelyPolicy ? "Opened directly; this looks like policy content" : likelyReference ? "Opened directly; this looks like help or reference content" : "Opened directly; Screenwalk did not find a way into it",
    };
  }
  return {
    group: "source-only",
    role,
    reason: likelyPolicy ? "Found in code; this looks like policy content" : likelyReference ? "Found in code; this looks like help or reference content" : "Found in code, but Screenwalk could not open it or find a way in",
  };
}

function mapRoleLabel(role: MapRole): string {
  if (role === "policy") return "Likely policy";
  if (role === "reference") return "Likely help screen";
  if (role === "direct-entry") return "Other entry point";
  if (role === "connected") return "Connected path";
  return "Needs context";
}

function inferJourneyCondition(graph: FlowGraph, journey: FlowGraph["journeys"][number], activePersona: string): ExperienceCondition {
  if (activePersona !== "default") return "signed-in";
  const nodes = journey.nodeIds.map((id) => graph.nodes.find((node) => node.id === id)).filter((node): node is FlowGraph["nodes"][number] => Boolean(node));
  const edges = (journey.edgeIds ?? []).map((id) => graph.edges.find((edge) => edge.id === id)).filter((edge): edge is FlowGraph["edges"][number] => Boolean(edge));
  const signal = [...nodes.map((node) => `${node.route} ${node.title} ${node.stateKey}`), ...edges.map((edge) => edge.action)].join(" ").toLowerCase();
  if (nodes.some((node) => node.stateKey === "error") || /\b(failed|failure|denied|declined|retry)\b/.test(signal)) return "failure";
  if (/\b(success|complete|completed|approved|confirmed|receipt|thank-you)\b/.test(signal)) return "success";
  if (/\b(login|log-in|signin|sign-in|password|oauth|authenticate)\b/.test(signal)) return "signed-out";
  return "public";
}

function journeyStageLabels(graph: FlowGraph, journey: FlowGraph["journeys"][number]): string[] {
  const stages = journey.nodeIds.flatMap((id) => {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    return node ? [screenStageLabel(node)] : [];
  });
  return stages.filter((stage, index) => index === 0 || stage !== stages[index - 1]).slice(0, 5);
}

function experienceConditionLabel(condition: ExperienceCondition): string {
  return experienceConditionChoices.find(([candidate]) => candidate === condition)?.[1] ?? "Not sure yet";
}

function topologyLevels(graph: Pick<FlowGraph, "nodes" | "edges">, entryNodeId: string): Map<string, number> {
  const levels = new Map<string, number>();
  const roots = graph.nodes.some((node) => node.id === entryNodeId)
    ? [entryNodeId]
    : graph.nodes.filter((node) => !graph.edges.some((edge) => edge.target === node.id)).map((node) => node.id);
  const queue = roots.map((id) => ({ id, level: 0 }));
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const knownLevel = levels.get(item.id);
    if (knownLevel !== undefined && knownLevel <= item.level) continue;
    levels.set(item.id, item.level);
    graph.edges.filter((edge) => edge.source === item.id).forEach((edge) => queue.push({ id: edge.target, level: item.level + 1 }));
  }
  return levels;
}

function buildCausalCorridor(selectedNodeId: string, graph: FlowGraph): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!selectedNodeId) return { nodeIds, edgeIds };
  const entryNodeId = graph.nodes.find((node) => node.route === "/")?.id ?? graph.nodes[0]?.id ?? "";
  const levels = topologyLevels(graph, entryNodeId);
  nodeIds.add(selectedNodeId);
  const queue = [selectedNodeId];
  while (queue.length > 0) {
    const target = queue.shift();
    if (!target) continue;
    for (const edge of graph.edges.filter((candidate) => candidate.target === target && (levels.get(candidate.source) ?? -1) < (levels.get(candidate.target) ?? 0))) {
      edgeIds.add(edge.id);
      if (nodeIds.has(edge.source)) continue;
      nodeIds.add(edge.source);
      queue.push(edge.source);
    }
  }
  for (const edge of graph.edges.filter((candidate) => candidate.source === selectedNodeId)) {
    edgeIds.add(edge.id);
    nodeIds.add(edge.target);
  }
  return { nodeIds, edgeIds };
}

function buildAudit(graph: FlowGraph, entryNodeId: string): Record<AuditCategory, AuditFinding[]> {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const staticReachable = reachableFrom(entryNodeId, graph.edges);
  const observedReachable = reachableFrom(entryNodeId, graph.edges.filter((edge) => (edge.observations?.length ?? 0) > 0));
  const screens: AuditFinding[] = [];

  for (const node of graph.nodes) {
    const reasons: string[] = [];
    const classification = classifyMapNode(node, staticReachable, entryNodeId);
    const desktopCapture = node.captureVariants?.desktop ?? node.capture;
    if (node.identity?.review.status === "needs-review") reasons.push(...node.identity.review.reasons);
    if (!desktopCapture) {
      reasons.push(node.route.includes("[") ? "This screen needs a real example, such as an ID, before Screenwalk can open it" : "No desktop screenshot yet");
    }
    if (node.id !== entryNodeId && !staticReachable.has(node.id)) {
      reasons.push(classification.group === "known"
        ? `${mapRoleLabel(classification.role)}; Screenwalk opened it directly but did not find a way in. This does not mean it should be removed`
        : `${mapRoleLabel(classification.role)}; found in code but not opened. It may require sign-in, specific data, or a direct link`);
    } else if (node.id !== entryNodeId && !observedReachable.has(node.id)) {
      reasons.push("A path exists in code, but Screenwalk did not reach it from the starting screen");
    }
    if (reasons.length > 0) {
      screens.push({
        id: `screen-audit:${node.id}`,
        category: "screens",
        nodeId: node.id,
        title: node.title,
        route: node.route,
        detail: reasons.join(" · "),
        sourceFile: node.sourceFile,
        evidence: desktopCapture ? "captured" : node.sourceFile === "(browser discovery)" ? "observed" : "static",
      });
    }
  }

  const uniqueUnobservedEdges = new Map<string, FlowGraph["edges"][number]>();
  graph.edges.filter((edge) => (edge.observations?.length ?? 0) === 0).forEach((edge) => uniqueUnobservedEdges.set(auditEdgeKey(edge), edge));
  const staticInteractions = [...uniqueUnobservedEdges.entries()].flatMap(([edgeKey, edge]): AuditFinding[] => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return [];
    return [{
      id: `interaction-audit:${edgeKey}`,
      category: "interactions",
      nodeId: source.id,
      relatedNodeId: target.id,
      edgeKey,
      title: `${source.title} → ${target.title}`,
      route: `${source.route} → ${target.route}`,
      detail: `${edge.action.replace(/^(Follow link|Navigate) to /, "Go to ")} · Screenwalk has not tried this step yet`,
      sourceFile: edge.evidence[0]?.sourceFile ?? source.sourceFile,
      evidence: "static",
    }];
  });
  const inventoriedInteractions = graph.nodes.flatMap((node) => node.interactiveTargets.filter((target) => target.status === "unobserved" || target.status === "failed").map((target): AuditFinding => ({
    id: `target-audit:${node.id}:${target.id}`,
    category: "interactions",
    nodeId: node.id,
    title: `${node.title} · ${target.name}`,
    route: node.route,
    detail: `${target.role} · ${target.status === "unobserved" ? "not tried" : target.status} · ${target.reason ?? "Screenwalk did not complete this step"}`,
    sourceFile: node.sourceFile,
    evidence: "captured",
  })));
  const interactions = [...staticInteractions, ...inventoriedInteractions];

  const quality = graph.nodes.flatMap((node): AuditFinding[] => {
    const capture = node.captureVariants?.desktop ?? node.capture;
    if (!capture || capture.quality === "ready") return [];
    return [{
      id: `quality-audit:${node.id}`,
      category: "quality",
      nodeId: node.id,
      title: node.title,
      route: node.route,
      detail: capture.quality === "loading" ? "The desktop screen never finished loading" : "The desktop screen opened without enough recognizable content",
      sourceFile: node.sourceFile,
      evidence: "captured",
    }];
  });

  const responsive = graph.nodes.flatMap((node): AuditFinding[] => {
    const hasDesktop = Boolean(node.captureVariants?.desktop ?? node.capture);
    const hasMobile = Boolean(node.captureVariants?.mobile);
    if (hasDesktop === hasMobile) return [];
    return [{
      id: `responsive-audit:${node.id}`,
      category: "responsive",
      nodeId: node.id,
      title: node.title,
      route: node.route,
      detail: hasDesktop ? "Desktop checked · mobile still needs checking" : "Mobile checked · desktop still needs checking",
      sourceFile: node.sourceFile,
      evidence: "captured",
    }];
  });

  const runtime = clusterRuntimeFindings(graph.nodes.flatMap((node) => node.diagnostics.flatMap((diagnostic): AuditFinding[] => {
    if (diagnostic.kind === "capture-quality" || diagnostic.severity === "info") return [];
    return [{
      id: `runtime-audit:${node.id}:${diagnostic.id}`,
      category: "runtime",
      nodeId: node.id,
      title: `${node.title} · ${diagnostic.kind}`,
      route: node.route,
      detail: `${diagnostic.severity}: ${diagnostic.message}${diagnostic.url ? ` · ${diagnostic.url}` : ""} · ${diagnosticNextAction(diagnostic.kind)}`,
      sourceFile: node.sourceFile,
      evidence: "observed",
    }];
  })));

  return { screens, interactions, quality, responsive, runtime };
}

function clusterRuntimeFindings(findings: AuditFinding[]): AuditFinding[] {
  const groups = new Map<string, AuditFinding & { routes: string[] }>();
  for (const finding of findings) {
    const signature = finding.detail
      .replace(/ · https?:\/\/\S+/g, "")
      .replace(/ · Open the request URL directly or fix the missing response$/, "")
      .replace(/ · Check the request URL and local server or network configuration$/, "")
      .replace(/ · Reproduce this route and inspect the browser (?:exception|console)$/, "");
    const kind = finding.title.split(" · ").at(-1) ?? finding.title;
    const key = `${kind}|${signature}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...finding, routes: [finding.route] });
      continue;
    }
    if (!existing.routes.includes(finding.route)) existing.routes.push(finding.route);
    const count = existing.routes.length;
    existing.title = count > 1 ? `${kind} · ${count} screens` : existing.title;
    existing.route = count > 1 ? `${count} routes` : existing.route;
    existing.detail = `${signature} · seen on ${count} screen${count === 1 ? "" : "s"} · ${finding.detail.split(" · ").at(-1) ?? ""}`.trim();
  }
  return [...groups.values()];
}

type SavedPositions = Record<string, { x: number; y: number }>;

function workspaceKey(graph: FlowGraph, scope: string): string {
  return `screenwalk.workspace.v2:${graph.project.root}:${scope}`;
}

function readSavedPositions(key: string): SavedPositions {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as SavedPositions;
  } catch {
    return {};
  }
}

function applySavedPositions(nodes: Node<FlowNodeData>[], key: string): Node<FlowNodeData>[] {
  const positions = readSavedPositions(key);
  return nodes.map((node) => {
    const position = positions[node.id];
    return position ? { ...node, position } : node;
  });
}

function reachableFrom(entryNodeId: string, edges: FlowGraph["edges"]): Set<string> {
  const reachable = new Set<string>(entryNodeId ? [entryNodeId] : []);
  const queue = entryNodeId ? [entryNodeId] : [];
  while (queue.length > 0) {
    const source = queue.shift();
    if (!source) continue;
    for (const edge of edges.filter((candidate) => candidate.source === source)) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      queue.push(edge.target);
    }
  }
  return reachable;
}

function auditEdgeKey(edge: FlowGraph["edges"][number]): string {
  return `${edge.source}->${edge.target}:${edge.action.replace(/^(Follow link|Navigate) to /, "")}`;
}

function dedupeEdges(edges: FlowGraph["edges"]): FlowGraph["edges"] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const action = edge.action.replace(/^(Follow link|Navigate) to /, "");
    const key = `${edge.source}->${edge.target}:${action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeJourneys(journeys: FlowGraph["journeys"]): FlowGraph["journeys"] {
  const seen = new Set<string>();
  return journeys.filter((journey) => {
    const key = journey.nodeIds.join("->");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatFindingsForClipboard(findings: AuditFinding[]): string {
  return findings.map((finding, index) => [
    `${index + 1}. [${auditEvidenceLabel(finding.evidence)}] ${finding.title}`,
    `Route: ${finding.route}`,
    `Source: ${finding.sourceFile}`,
    `Detail: ${finding.detail}`,
  ].join("\n")).join("\n\n");
}

function auditEvidenceLabel(evidence: AuditEvidence): string {
  if (evidence === "static") return "Found in code";
  if (evidence === "observed") return "Seen in app";
  return "Screenshot saved";
}

function diagnosticNextAction(kind: FlowGraph["nodes"][number]["diagnostics"][number]["kind"]): string {
  if (kind === "http") return "Open the request URL directly or fix the missing response";
  if (kind === "request-failed") return "Check the request URL and local server or network configuration";
  if (kind === "page-error") return "Reproduce this route and inspect the browser exception";
  return "Reproduce this route and inspect the browser console";
}

function readScreenReviews(key: string): Record<string, ScreenReview> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, ScreenReview>;
  } catch {
    return {};
  }
}

function readJourneyReviews(key: string): Record<string, JourneyReview> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, JourneyReview>;
  } catch {
    return {};
  }
}

function reviewStatusLabel(status?: ReviewStatus): string {
  if (status === "in-flow") return "keep in the selected path";
  if (status === "out-of-flow") return "review as part of another path";
  if (status === "needs-review") return "needs a closer look";
  return "not classified";
}

function reviewChoiceLabel(status: ReviewStatus): string {
  return reviewChoices.find(([candidate]) => candidate === status)?.[1] ?? "Review";
}

function recommendScreenPlacement(
  graph: FlowGraph,
  node: FlowGraph["nodes"][number],
  journey: FlowGraph["journeys"][number] | undefined,
  entryNodeId: string,
): ScreenRecommendation {
  const activeIndex = journey?.nodeIds.indexOf(node.id) ?? -1;
  const journeyEdges = activeIndex >= 0 && journey
    ? graph.edges.filter((edge) => {
      const sourceIndex = journey.nodeIds.indexOf(edge.source);
      return sourceIndex >= 0 && journey.nodeIds[sourceIndex + 1] === edge.target;
    })
    : [];
  const observedJourneyEdges = journeyEdges.filter((edge) => (edge.observations?.length ?? 0) > 0);

  if (activeIndex >= 0 && journey) {
    const isObserved = journey.kind === "observed" || journey.provenance === "end-to-end" || journey.provenance === "composed-from-observed";
    return {
      status: "in-flow",
      evidenceClass: isObserved ? "Screenwalk followed this path" : "This path came from code",
      action: `Keep in “${journey.title}”`,
      reasons: [
        `Step ${activeIndex + 1} of ${journey.nodeIds.length} in the selected path.`,
        observedJourneyEdges.length > 0
          ? `Screenwalk successfully followed ${observedJourneyEdges.length} nearby step${observedJourneyEdges.length === 1 ? "" : "s"}.`
          : node.capture?.quality === "ready" ? "Screenwalk opened the screen, but has not followed this whole path." : "This path was found in code and has not been tried from start to finish.",
      ],
    };
  }

  const otherJourneys = graph.journeys.filter((candidate) => candidate.nodeIds.includes(node.id));
  const observedElsewhere = otherJourneys.find((candidate) => candidate.kind === "observed" || candidate.provenance === "end-to-end" || candidate.provenance === "composed-from-observed");
  if (observedElsewhere) {
    return {
      status: "out-of-flow",
      evidenceClass: "Found in another path",
      action: `Review in “${observedElsewhere.title}” instead`,
      reasons: [
        `This screen is not in “${journey?.title ?? "the selected path"}”.`,
        `It appears in ${otherJourneys.length} mapped path${otherJourneys.length === 1 ? "" : "s"}, including one Screenwalk followed.`,
      ],
    };
  }

  if (node.stateKey !== "default") {
    return {
      status: "needs-review",
      evidenceClass: "A screen state found in code",
      action: `Trigger the ${node.stateKey} state to verify it`,
      reasons: [
        "The state exists in code but is not part of the selected path.",
        node.capture ? "A screenshot exists, but Screenwalk did not find how a user gets here." : "Screenwalk has not opened this state or found how a user gets here.",
      ],
    };
  }

  const reachable = reachableFrom(entryNodeId, graph.edges);
  if (reachable.has(node.id)) {
    return {
      status: "out-of-flow",
      evidenceClass: "Connected outside this path",
      action: "Review as another path",
      reasons: [
        `A mapped route connects this screen to the app entry, but not through “${journey?.title ?? "the selected path"}”.`,
        otherJourneys.length > 0 ? `It appears in ${otherJourneys.length} other suggested path${otherJourneys.length === 1 ? "" : "s"}.` : "No named path currently includes this connection.",
      ],
    };
  }

  const classification = classifyMapNode(node, reachable, entryNodeId);
  if (classification.group === "known") {
    return {
      status: "needs-review",
      evidenceClass: `${mapRoleLabel(classification.role)} · opened directly`,
      action: classification.role === "policy" || classification.role === "reference" ? "Confirm its intended navigation role" : "Confirm this direct entry point",
      reasons: [
        "Screenwalk opened this screen, but did not find a way into it from the starting screen.",
        classification.role === "policy" || classification.role === "reference"
          ? "The role is inferred from the route or title; it may legitimately live in footer, utility, contextual, or direct navigation."
          : "A screen can intentionally open only from a direct link. Not finding a path does not mean it should be removed.",
      ],
    };
  }

  return {
    status: "needs-review",
    evidenceClass: "Found in code · not reached yet",
    action: "Identify its intended context",
    reasons: [
      "Screenwalk found the screen in code, but could not open it or find a way in.",
      classification.role === "policy" || classification.role === "reference"
        ? `Its route or title looks like ${classification.role} content, but Screenwalk still needs to open it.`
        : "Its route and title do not tell us enough to understand where it belongs.",
      "It may be gated, parameterized, experimental, intentionally direct-linked, or stale. Verify before connecting, hiding, or deleting it.",
    ],
  };
}

function formatScreenSelection(graph: FlowGraph, nodes: FlowGraph["nodes"], reviews: Record<string, ScreenReview>): string {
  const reachable = reachableFrom(graph.nodes.find((node) => node.route === "/")?.id ?? "", graph.edges);
  return [
    `Screenwalk selection · ${graph.project.name}`,
    `Project: ${graph.project.root}`,
    `Run: ${graph.run?.id ?? graph.project.generatedAt}`,
    "",
    ...nodes.flatMap((node, index) => {
      const observed = node.interactiveTargets.filter((target) => target.status === "observed").length;
      const unobserved = node.interactiveTargets.filter((target) => target.status === "unobserved").length;
      const errors = node.diagnostics.filter((diagnostic) => diagnostic.severity === "error").reduce((total, diagnostic) => total + (diagnostic.count ?? 1), 0);
      return [
        `${index + 1}. ${node.title} · ${node.route}`,
        `   Source: ${node.sourceFile}`,
        `   State: ${node.stateKey} · ${node.capture ? `${node.capture.quality} ${node.capture.viewport.width}x${node.capture.viewport.height} capture` : "not captured"}`,
        `   Identity: ${node.identity ? `${node.identity.routeTemplate} · family ${node.identity.familyId} · variant ${node.identity.variantId}${node.identity.review.status === "needs-review" ? " · grouping needs review" : ""}` : "legacy graph"}`,
        `   Reachability: ${node.id === graph.nodes.find((candidate) => candidate.route === "/")?.id ? "entry screen" : reachable.has(node.id) ? "connected from entry" : "not connected from entry in current evidence"}`,
        `   Review: ${reviewStatusLabel(reviews[node.id]?.status)}${reviews[node.id]?.note ? ` · ${reviews[node.id]?.note}` : ""}`,
        `   Interactions: ${observed} observed · ${unobserved} unobserved route links · ${errors} runtime errors`,
        "",
      ];
    }),
  ].join("\n").trim();
}

function journeyProvenanceLabel(journey: FlowGraph["journeys"][number]): string {
  if (journey.provenance === "verified-end-to-end") return "Screenwalk verified the end of this path";
  if (journey.provenance === "recorded-unverified") return "Screenwalk followed this path; the ending was not checked";
  if (journey.provenance === "end-to-end") return "Screenwalk followed the whole path";
  if (journey.provenance === "composed-from-observed") return "built from steps Screenwalk followed";
  if (journey.provenance === "static-candidate" || journey.kind === "static") return "suggested from code";
  if (journey.provenance === "curated" || journey.kind === "curated") return "added by a person";
  return journey.kind === "observed" ? "Screenwalk followed this path" : "suggested from code";
}

function interactionCoverageSummary(node: FlowGraph["nodes"][number]): string {
  if (node.interactiveTargets.length === 0) {
    return node.stateKey !== "default"
      ? `${node.stateKey} state found in code; Screenwalk still needs to open it`
      : "Screenwalk did not find any navigation controls on this screen";
  }
  const observed = node.interactiveTargets.filter((target) => target.status === "observed").length;
  const navigable = node.interactiveTargets.filter((target) => target.status === "observed" || target.status === "unobserved").length;
  const classified = node.interactiveTargets.filter((target) => target.status === "unsafe" || target.status === "blocked" || target.status === "local").length;
  return `${observed} of ${navigable} links tried · ${classified} controls identified without clicking`;
}

function formatJourneyForClipboard(graph: FlowGraph, journey: FlowGraph["journeys"][number], condition: ExperienceCondition): string {
  const nodes = journey.nodeIds.map((id) => graph.nodes.find((node) => node.id === id)).filter((node): node is FlowGraph["nodes"][number] => Boolean(node));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const edges = (journey.edgeIds ?? []).map((id) => edgeById.get(id)).filter((edge): edge is FlowGraph["edges"][number] => Boolean(edge));
  return [
    `Screenwalk path · ${journey.title}`,
    `Project: ${graph.project.root}`,
    `Evidence: ${journeyProvenanceLabel(journey)}`,
    `Experience condition: ${experienceConditionLabel(condition)}`,
    `Stages: ${journeyStageLabels(graph, journey).join(" -> ") || "not classified"}`,
    journey.provenance === "composed-from-observed" ? "Note: each transition was observed separately; this exact sequence was not recorded as one end-to-end session." : "",
    "",
    ...nodes.flatMap((node, index) => [
      `${index + 1}. ${node.title} · ${node.route}`,
      `   Source: ${node.sourceFile}`,
      `   Capture: ${node.capture ? `${node.capture.quality} · ${node.capture.viewport.width}x${node.capture.viewport.height}` : "not captured"}`,
      ...(edges[index] ? [`   Next: ${edges[index]?.action} · ${edges[index]?.observations?.length ?? 0} observation(s)`] : []),
      ...(edges[index]?.conditions?.length ? [`   When: ${edges[index]?.conditions?.map((condition) => condition.label).join(edges[index]?.conditionLogic === "any" ? " or " : " and ")}`] : []),
      "",
    ]),
    "Please reproduce this path, preserve its evidence boundary, and use the route/source context above when reviewing or changing the UI.",
  ].filter((line, index, values) => line !== "" || values[index - 1] !== "").join("\n").trim();
}
