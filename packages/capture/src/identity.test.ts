import assert from "node:assert/strict";
import test from "node:test";
import { buildScreenIdentity, meaningfulRoute, routeLookupKey, semanticUrlState } from "./identity.ts";

test("keeps meaningful query state while ignoring tracking and record noise", () => {
  assert.deepEqual(
    semanticUrlState("/settings?tab=billing&utm_source=x&cursor=abc&q=chair&preview=yes"),
    { query: { tab: "billing" }, unknownQueryKeys: ["preview"], hash: undefined },
  );
  assert.equal(routeLookupKey("/settings?utm_source=x&tab=billing"), "/settings?tab=billing");
});

test("supports project overrides for meaningful and ignored query state", () => {
  const policy = {
    schemaVersion: "screenwalk.identity.v0" as const,
    query: { include: ["preview", "page"], ignore: ["tab"] },
    hash: { include: ["pane"], treatPathAsRoute: true },
  };
  assert.equal(meaningfulRoute("/settings?tab=billing&preview=yes#pane=history", policy), "/settings?preview=yes#pane=history");
  assert.equal(meaningfulRoute("/settings?page=2", policy), "/settings?page=2");
});

test("separates family, variant, and capture-independent persona state", () => {
  const member = buildScreenIdentity({ route: "/settings?tab=billing", routeTemplate: "/settings", persona: "member", stateKey: "default" });
  const admin = buildScreenIdentity({ route: "/settings?tab=billing", routeTemplate: "/settings", persona: "admin", stateKey: "default" });
  const profile = buildScreenIdentity({ route: "/settings?tab=profile", routeTemplate: "/settings", persona: "member", stateKey: "default" });
  assert.equal(member.familyId, admin.familyId);
  assert.equal(member.familyId, profile.familyId);
  assert.notEqual(member.variantId, admin.variantId);
  assert.notEqual(member.variantId, profile.variantId);
});

test("marks unknown query state for review instead of silently splitting", () => {
  const identity = buildScreenIdentity({ route: "/search?layout=grid", persona: "default", stateKey: "default" });
  assert.equal(identity.review.status, "needs-review");
  assert.equal(identity.review.suggestions[0]?.action, "split");
  assert.equal(identity.semanticUrlState.query.layout, undefined);
});

test("distinguishes standalone and modal presentation families", () => {
  const page = buildScreenIdentity({ route: "/login", persona: "default", stateKey: "default" });
  const modal = buildScreenIdentity({
    route: "/login",
    persona: "default",
    stateKey: "modal",
    presentation: { kind: "modal", overlays: ["dialog:Sign in"], slots: [] },
  });
  assert.notEqual(page.familyId, modal.familyId);
});
