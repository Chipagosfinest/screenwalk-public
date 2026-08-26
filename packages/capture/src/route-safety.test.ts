import assert from "node:assert/strict";
import test from "node:test";
import { unsafePath } from "./route-safety.js";

test("blocks consequential route segments including compound HTML-era names", () => {
  for (const path of ["/delete", "/delete-account", "/settings/remove_user", "/checkout-now", "/sign-out", "/report.pdf"]) {
    assert.equal(unsafePath(path), true, `${path} should be blocked`);
  }
});

test("does not block ordinary routes that merely contain similar text", () => {
  for (const path of ["/account", "/plans.html", "/removable-labels", "/purchases", "/about-deletion"]) {
    assert.equal(unsafePath(path), false, `${path} should remain discoverable`);
  }
});
