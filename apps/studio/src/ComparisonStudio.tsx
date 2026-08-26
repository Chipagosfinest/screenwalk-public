import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FlowComparison } from "@screenbranch/schema";

type ComparisonChange = FlowComparison["surfaces"][number]["changes"][number];
type ChangeStatus = ComparisonChange["status"];
type RouteGroup = { id: string; label: string; prefix: string; status: ChangeStatus; changes: ComparisonChange[] };

const statusCopy: Record<ChangeStatus, { label: string; short: string }> = {
  "only-reference": { label: "Only before", short: "Before only" },
  "only-candidate": { label: "Only after", short: "After only" },
  "path-changed": { label: "Paths changed", short: "Path changed" },
  "evidence-missing": { label: "Still needs checking", short: "Not checked" },
};

export function ComparisonStudio({ comparison }: { comparison: FlowComparison }) {
  const [surfaceId, setSurfaceId] = useState(comparison.surfaces[0]?.id ?? "");
  const surface = comparison.surfaces.find((item) => item.id === surfaceId) ?? comparison.surfaces[0];
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimeout = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyResetTimeout.current), []);
  const groups = useMemo(() => groupChanges(surface?.changes ?? []), [surface]);
  const candidateGroups = groups.filter((group) => group.status === "only-candidate");
  const referenceGroups = groups.filter((group) => group.status === "only-reference");
  const selectedGroup = groups.find((group) => group.id === selectedGroupId)
    ?? candidateGroups[0]
    ?? referenceGroups[0];
  if (!surface) return null;
  const changedPathCount = surface.summary.addedPaths + surface.summary.removedPaths;
  const hasRuntimePair = comparison.reference.evidence === "runtime" && comparison.candidate.evidence === "runtime";
  const hasBoundedRuntimeSample = hasRuntimePair && surface.summary.referenceCaptured !== undefined && surface.summary.candidateCaptured !== undefined;
  const copyContext = async () => {
    window.clearTimeout(copyResetTimeout.current);
    const group = selectedGroup;
    const lines = [
      `Review this Screenwalk comparison for ${comparison.project.name} · ${surface.label}.`,
      `Before: ${comparison.reference.git.sha} (${comparison.reference.git.branch}, ${comparison.reference.environment}).`,
      `After: ${comparison.candidate.git.sha} (${comparison.candidate.git.branch}, ${comparison.candidate.environment}).`,
      `${surface.summary.onlyCandidate} screens exist only after the change; ${surface.summary.onlyReference} only before it; ${changedPathCount} mapped paths differ.`,
      hasBoundedRuntimeSample ? `Runtime sample: ${surface.summary.referenceCaptured}/${surface.summary.referenceScreens} reference screens and ${surface.summary.candidateCaptured}/${surface.summary.candidateScreens} candidate screens opened; ${surface.summary.sharedCaptured ?? 0} routes were opened in both.` : "This comparison comes from code.",
      "A difference is not automatically a regression. Confirm the same route and scenario in both environments before assigning a verdict.",
      group ? `\nInspect ${statusCopy[group.status].label.toLowerCase()} · ${group.label}:\n${group.changes.map((change) => `- ${change.route}${change.sourceFile ? ` · ${change.sourceFile}` : ""}`).join("\n")}` : "",
      "\nExplain whether this is intentional, a moved screen, or something that still needs to be opened and checked. Do not recommend deletion from absence alone.",
    ].filter(Boolean).join("\n");
    try {
      await writeClipboard(lines);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    copyResetTimeout.current = window.setTimeout(() => setCopyStatus("idle"), 5_000);
  };
  const copyKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void copyContext();
  };

  return <main className="comparison-shell">
    <header className="topbar comparison-topbar">
      <a className="brand comparison-brand" href="/">
        <span className="brand-mark">S</span>
        <div><strong>Screenwalk</strong><small>{comparison.project.name} · before and after</small></div>
      </a>
      <nav className="comparison-nav" aria-label="Comparison actions">
        <span className={hasRuntimePair ? "is-runtime" : "is-source-only"}>{hasRuntimePair ? "Both targets sampled" : "Compared from code"}</span>
        <a href="/?graph=local">Current map</a>
      </nav>
    </header>

    <div className="comparison-page">
      <section className="comparison-intro">
        <div>
          <p className="eyebrow">Before and after</p>
          <h1>What changes when this ships?</h1>
          <p>Understand the product change first. Open individual routes only when you need more detail.</p>
        </div>
        <button className="comparison-copy" type="button" onClick={() => void copyContext()} onKeyDown={copyKeyDown}>{copyLabel(copyStatus, "Copy agent context", "Copied for your agent")}</button>
        <span className="sr-only" aria-live="polite">{copyStatus === "copied" ? "Agent context copied." : copyStatus === "failed" ? "Could not access the clipboard." : ""}</span>
      </section>

      <section className="revision-pair" aria-label="Compared versions">
        <RevisionCard side="Before" revision={comparison.reference} />
        <div className="revision-direction" aria-hidden="true"><span />→<span /></div>
        <RevisionCard side="After" revision={comparison.candidate} />
      </section>

      {!hasRuntimePair && <aside className="comparison-boundary">
        <strong>Compared from code only</strong>
        <span>These are two exact commits, but Screenwalk has not opened both versions. Treat this as a list of possible changes, not confirmed visual problems.</span>
      </aside>}
      {hasBoundedRuntimeSample && <aside className="comparison-boundary">
        <strong>Bounded runtime sample</strong>
        <span>{surface.summary.referenceCaptured} of {surface.summary.referenceScreens} reference screens and {surface.summary.candidateCaptured} of {surface.summary.candidateScreens} candidate screens were opened. {surface.summary.sharedCaptured ?? 0} routes have runtime evidence in both environments. Source-only differences still need the same scenario opened on both sides.</span>
      </aside>}

      <section className="comparison-focus">
        <div className="surface-tabs" role="group" aria-label="Product surface">
          {comparison.surfaces.map((item) => <button
            aria-pressed={surface.id === item.id}
            className={surface.id === item.id ? "active" : ""}
            key={item.id}
            onClick={() => { setSurfaceId(item.id); setSelectedGroupId(""); setShowUnchanged(false); }}
            type="button"
          ><span>{item.label}</span><small>{item.summary.onlyCandidate + item.summary.onlyReference} differences</small></button>)}
        </div>

        <div className="comparison-statement">
          <p className="eyebrow">{surface.label} · what people can reach</p>
          <h2>These two source maps differ substantially.</h2>
          <p><strong>{surface.summary.onlyCandidate}</strong> screens appear only after the change, <strong>{surface.summary.onlyReference}</strong> only before it, and <strong>{changedPathCount}</strong> paths differ.</p>
        </div>

        <div className="comparison-content">
          <section className="route-shift" aria-label={`${surface.label} screens before and after`}>
            <header>
              <div><p className="eyebrow">Only what changed</p><h3>Screens before and after</h3></div>
              <button aria-pressed={showUnchanged} type="button" onClick={() => setShowUnchanged((value) => !value)}>{showUnchanged ? "Hide unchanged" : `Show ${surface.summary.sharedScreens} unchanged`}</button>
            </header>
            <div className="route-shift-grid">
              <RouteGroupColumn
                groups={referenceGroups}
                heading="Only before"
                hint={`${surface.summary.referenceScreens} screens before`}
                selectedGroupId={selectedGroup?.id}
                onSelect={setSelectedGroupId}
              />
              <section className="shared-spine" aria-label="Screens in both versions">
                <div><span>—</span><strong>In both</strong><small>{surface.summary.sharedScreens} screens</small></div>
                {(showUnchanged ? surface.sharedRoutes : surface.sharedRoutes.slice(0, 5)).map((route) => <code key={route}>{route}</code>)}
                {!showUnchanged && surface.sharedRoutes.length > 5 && <small>+ {surface.sharedRoutes.length - 5} unchanged</small>}
              </section>
              <RouteGroupColumn
                groups={candidateGroups}
                heading="Only after"
                hint={`${surface.summary.candidateScreens} screens after`}
                selectedGroupId={selectedGroup?.id}
                onSelect={setSelectedGroupId}
              />
            </div>
          </section>

          {selectedGroup && <aside className="comparison-inspector">
            <p className="eyebrow">{statusCopy[selectedGroup.status].short}</p>
            <h3>{selectedGroup.label}</h3>
            <p>{selectedGroup.changes.length} {selectedGroup.changes.length === 1 ? "route" : "routes"} share this area. This shows what changed; it does not decide whether the change is good or bad.</p>
            <div className="comparison-route-list">
              {selectedGroup.changes.map((change) => <div key={change.id}><code>{change.route}</code>{change.sourceFile && <small>{change.sourceFile}</small>}</div>)}
            </div>
            <button type="button" onClick={() => void copyContext()} onKeyDown={copyKeyDown}>{copyLabel(copyStatus, "Copy this area for an agent", "Copied")}</button>
          </aside>}
        </div>
      </section>
    </div>
  </main>;
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard access was denied");
  }
}

function copyLabel(status: "idle" | "copied" | "failed", idle: string, copied: string) {
  if (status === "copied") return copied;
  if (status === "failed") return "Copy failed — try again";
  return idle;
}

function RevisionCard({ side, revision }: { side: string; revision: FlowComparison["reference"] }) {
  return <article className="revision-card">
    <div><p className="eyebrow">{side}</p><strong>{revision.label}</strong></div>
    <span className={`environment-pill is-${revision.environment}`}>{revision.environment}</span>
    <dl>
      <div><dt>Commit</dt><dd><code title={revision.git.sha}>{revision.git.sha.slice(0, 9)}</code></dd></div>
      <div><dt>Branch</dt><dd>{revision.git.branch}</dd></div>
      <div><dt>Checked by</dt><dd>{revision.evidence === "runtime" ? "Opening the app" : "Reading the code"}</dd></div>
    </dl>
  </article>;
}

function RouteGroupColumn({ groups, heading, hint, selectedGroupId, onSelect }: { groups: RouteGroup[]; heading: string; hint: string; selectedGroupId?: string; onSelect: (id: string) => void }) {
  return <section className="route-group-column">
    <header><strong>{heading}</strong><small>{hint}</small></header>
    <div>{groups.map((group) => <button className={group.id === selectedGroupId ? "active" : ""} key={group.id} onClick={() => onSelect(group.id)} type="button">
      <span>{group.status === "only-reference" ? "←" : "→"}</span>
      <div><strong>{group.label}</strong><code>{group.prefix}</code></div>
      <b>{group.changes.length}</b>
    </button>)}</div>
  </section>;
}

function groupChanges(changes: ComparisonChange[]): RouteGroup[] {
  const groups = new Map<string, RouteGroup>();
  for (const change of changes) {
    const { label, prefix } = routeFamily(change.route);
    const id = `${change.status}:${prefix}`;
    const group = groups.get(id) ?? { id, label, prefix, status: change.status, changes: [] };
    group.changes.push(change);
    groups.set(id, group);
  }
  return [...groups.values()].sort((left, right) => right.changes.length - left.changes.length || left.label.localeCompare(right.label));
}

function routeFamily(route: string): { label: string; prefix: string } {
  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0) return { label: "Home", prefix: "/" };
  const first = segments[0] ?? "other";
  const second = segments[1];
  const compound = first === "agent" && second === "enroll" || first === "merchant" && second === "dashboard";
  const familySegments = compound ? [first, second] : [first];
  const prefix = `/${familySegments.join("/")}`;
  const label = familySegments.map((segment) => segment.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())).join(" ");
  return { label, prefix };
}
