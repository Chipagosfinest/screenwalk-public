import assert from "node:assert/strict";
import test from "node:test";
import { appendDiagnostic, clusterDiagnostics, diagnosticClusterKey, normalizeDiagnosticUrl } from "./diagnostics.ts";
import type { Diagnostic } from "./index.ts";

const observedAt = "2026-08-19T00:00:00.000Z";

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  id: overrides.id ?? "diagnostic:1",
  kind: "request-failed",
  severity: "error",
  message: "net::ERR_BLOCKED_BY_RESPONSE",
  observedAt,
  ...overrides,
});

test("collapses Privy URLs that only differ by request ids", () => {
  assert.equal(
    normalizeDiagnosticUrl("https://auth.privy.io/apps/cmrfwbl2r00iu0biicnf28ucl/embedded-wallets?caid=a53729e5-8951-4c7a-9d57-faffff8828a8"),
    "https://auth.privy.io/apps/cmrfwbl2r00iu0biicnf28ucl/embedded-wallets",
  );
  assert.equal(
    diagnosticClusterKey(diagnostic({
      url: "https://auth.privy.io/apps/cmrfwbl2r00iu0biicnf28ucl/embedded-wallets?caid=11111111-1111-1111-1111-111111111111",
    })),
    diagnosticClusterKey(diagnostic({
      url: "https://auth.privy.io/apps/cmrfwbl2r00iu0biicnf28ucl/embedded-wallets?caid=22222222-2222-2222-2222-222222222222",
    })),
  );
});

test("clusters repeated CSP framing errors into one counted diagnostic", () => {
  const clustered = clusterDiagnostics([
    diagnostic({
      id: "a",
      kind: "console",
      message: "Framing 'https://auth.privy.io/' violates the following Content Security Policy directive: \"frame-ancestors 'self'\".",
    }),
    diagnostic({
      id: "b",
      kind: "console",
      message: "Framing 'https://auth.privy.io/' violates the following Content Security Policy directive: \"frame-ancestors 'self'\".",
      observedAt: "2026-08-19T00:00:01.000Z",
    }),
    diagnostic({
      id: "c",
      kind: "request-failed",
      message: "net::ERR_ABORTED",
      severity: "info",
    }),
  ]);
  assert.equal(clustered.length, 2);
  assert.equal(clustered.find((item) => item.kind === "console")?.count, 2);
  assert.equal(clustered.find((item) => item.kind === "request-failed")?.count, 1);
});

test("appendDiagnostic merges as events arrive", () => {
  const list: Diagnostic[] = [];
  appendDiagnostic(list, diagnostic({
    url: "https://auth.privy.io/apps/abc/embedded-wallets?caid=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  }));
  appendDiagnostic(list, diagnostic({
    id: "diagnostic:2",
    url: "https://auth.privy.io/apps/abc/embedded-wallets?caid=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  }));
  assert.equal(list.length, 1);
  assert.equal(list[0]?.count, 2);
  assert.equal(list[0]?.url, "https://auth.privy.io/apps/abc/embedded-wallets");
});
