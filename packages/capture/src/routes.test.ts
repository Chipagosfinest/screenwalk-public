import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPath, limitCapturableRoutes, runtimeEvidenceCount } from "./routes.ts";

test("canonicalizes route aliases without collapsing case-sensitive paths", () => {
  assert.equal(canonicalPath("/"), "/");
  assert.equal(canonicalPath("/account/"), "/account");
  assert.equal(canonicalPath("//account///settings//"), "/account/settings");
  assert.equal(canonicalPath("/Account"), "/Account");
});

test("caps captures while keeping the entry route first", () => {
  assert.deepEqual(limitCapturableRoutes([{ route: "/account" }, { route: "/" }, { route: "/docs" }], 2), [
    { route: "/" },
    { route: "/account" },
  ]);
});

test("runtime discovery budgets ignore uncaptured source-only screens", () => {
  const nodes = [
    ...Array.from({ length: 48 }, (_, index) => ({ persona: "default", stateKey: "default", sourceFile: `app/source-${index}/page.tsx` })),
    ...Array.from({ length: 12 }, (_, index) => ({ persona: "default", stateKey: "default", sourceFile: `app/captured-${index}/page.tsx`, capture: { quality: "ready" } })),
    { persona: "member", stateKey: "default", sourceFile: "(browser discovery)" },
  ];
  assert.equal(runtimeEvidenceCount(nodes, "default"), 12);
  assert.equal(runtimeEvidenceCount(nodes, "member"), 1);
});
