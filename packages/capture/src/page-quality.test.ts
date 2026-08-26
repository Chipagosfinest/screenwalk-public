import assert from "node:assert/strict";
import test from "node:test";
import { assessPageSnapshot, type PageQualitySnapshot } from "./page-quality.ts";

const snapshot = (overrides: Partial<PageQualitySnapshot> = {}): PageQualitySnapshot => ({
  explicitLoader: false,
  loadingCopy: false,
  substantialVisual: false,
  mainTextLength: 0,
  mainControlCount: 0,
  chromeOnly: false,
  animatedLoader: false,
  smallVisibleShape: false,
  mediaCount: 0,
  bodyTextLength: 0,
  ...overrides,
});

test("does not treat header chrome as a ready product screen", () => {
  assert.equal(assessPageSnapshot(snapshot({
    chromeOnly: true,
    mainControlCount: 0,
    mainTextLength: 0,
    bodyTextLength: 18,
    mediaCount: 3,
  })), "loading");
});

test("product shell chrome waits instead of counting Sign in as ready", () => {
  const productShellChrome = assessPageSnapshot(snapshot({
    chromeOnly: true,
    mainControlCount: 1,
    mainTextLength: 1,
    bodyTextLength: 22,
    mediaCount: 3,
  }));
  assert.equal(productShellChrome, "loading");
});

test("keeps a populated hunt or home screen ready", () => {
  assert.equal(assessPageSnapshot(snapshot({
    substantialVisual: true,
    mainTextLength: 180,
    mainControlCount: 4,
    bodyTextLength: 220,
    mediaCount: 8,
  })), "ready");
});

test("a signed-out save page with real copy stays ready", () => {
  assert.equal(assessPageSnapshot(snapshot({
    mainTextLength: 160,
    mainControlCount: 2,
    bodyTextLength: 190,
    mediaCount: 4,
  })), "ready");
});

test("an explicit loader without product content stays loading", () => {
  assert.equal(assessPageSnapshot(snapshot({
    explicitLoader: true,
    mainTextLength: 24,
    mainControlCount: 0,
    bodyTextLength: 24,
  })), "loading");
});

test("a blank document is empty, not ready", () => {
  assert.equal(assessPageSnapshot(snapshot({
    bodyTextLength: 0,
    mediaCount: 1,
  })), "empty");
});
