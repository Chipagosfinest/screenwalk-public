import assert from "node:assert/strict";
import test from "node:test";
import { pickEntryCta } from "./entry-cta.ts";

test("picks the product action on an auth-walled home screen and ignores Sign in", () => {
  const cta = pickEntryCta([
    { name: "Sign in", role: "button" },
    { name: "Find matches", role: "button", type: "submit" },
    { name: "N", role: "button" },
  ]);
  assert.equal(cta?.name, "Find matches");
});

test("never auto-clicks auth or destructive entry actions", () => {
  assert.equal(pickEntryCta([
    { name: "Sign in", role: "button" },
    { name: "Delete account", role: "button" },
    { name: "Log out", role: "button" },
  ]), undefined);
});

test("does not treat a generic password-form submit as a product CTA", () => {
  assert.equal(pickEntryCta([
    { name: "Come in", role: "button", type: "submit" },
    { name: "Go", role: "button", type: "submit" },
  ]), undefined);
});
