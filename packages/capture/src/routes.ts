export function canonicalPath(path: string): string {
  const pathname = `/${path.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : "/";
}

export function limitCapturableRoutes<T extends { route: string }>(nodes: T[], maxScreens: number): T[] {
  return [...nodes]
    .sort((left, right) => Number(right.route === "/") - Number(left.route === "/"))
    .slice(0, maxScreens);
}

export function runtimeEvidenceCount<T extends { persona: string; stateKey?: string; capture?: unknown; sourceFile?: string }>(nodes: T[], persona: string): number {
  return nodes.filter((node) => node.persona === persona
    && node.stateKey === "default"
    && (Boolean(node.capture) || node.sourceFile === "(browser discovery)"))
    .length;
}
