type Diagnostic = {
  id: string;
  kind: "console" | "page-error" | "request-failed" | "http" | "capture-quality";
  severity: "info" | "warning" | "error";
  message: string;
  count?: number;
  observedAt: string;
  url?: string;
  status?: number;
};

export function normalizeDiagnosticUrl(url?: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id")
      .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, "/:id");
    return `${parsed.origin}${path}`;
  } catch {
    return (url.split("?")[0] ?? url).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  }
}

export function normalizeDiagnosticMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s)'"]+/g, (url) => normalizeDiagnosticUrl(url) || url)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/[0-9a-f]{20,}/gi, ":id")
    .replace(/\s+/g, " ")
    .trim();
}

export function diagnosticClusterKey(diagnostic: Pick<Diagnostic, "kind" | "severity" | "message" | "url">): string {
  return [
    diagnostic.kind,
    diagnostic.severity,
    normalizeDiagnosticMessage(diagnostic.message),
    normalizeDiagnosticUrl(diagnostic.url),
  ].join("|");
}

export function clusterDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const groups = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics) {
    const key = diagnosticClusterKey(diagnostic);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...diagnostic,
        message: normalizeDiagnosticMessage(diagnostic.message),
        url: diagnostic.url ? normalizeDiagnosticUrl(diagnostic.url) : undefined,
        count: diagnostic.count ?? 1,
      });
      continue;
    }
    existing.count = (existing.count ?? 1) + (diagnostic.count ?? 1);
    if (diagnostic.observedAt < existing.observedAt) existing.observedAt = diagnostic.observedAt;
  }
  return [...groups.values()];
}

export function appendDiagnostic(list: Diagnostic[], diagnostic: Diagnostic): void {
  const key = diagnosticClusterKey(diagnostic);
  const existing = list.find((candidate) => diagnosticClusterKey(candidate) === key);
  if (existing) {
    existing.count = (existing.count ?? 1) + (diagnostic.count ?? 1);
    return;
  }
  list.push({
    ...diagnostic,
    message: normalizeDiagnosticMessage(diagnostic.message),
    url: diagnostic.url ? normalizeDiagnosticUrl(diagnostic.url) : undefined,
    count: diagnostic.count ?? 1,
  });
}
