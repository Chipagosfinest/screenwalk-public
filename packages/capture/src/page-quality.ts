export type PageQuality = "ready" | "loading" | "empty";

export type PageQualitySnapshot = {
  explicitLoader: boolean;
  loadingCopy: boolean;
  substantialVisual: boolean;
  mainTextLength: number;
  mainControlCount: number;
  chromeOnly: boolean;
  animatedLoader: boolean;
  smallVisibleShape: boolean;
  mediaCount: number;
  bodyTextLength: number;
};

export const COLLECT_PAGE_QUALITY_SCRIPT = `(() => {
  const isVisible = function (element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const isChrome = function (element) {
    if (element.closest("header, footer, [role=banner], [role=contentinfo], [data-screenwalk-chrome]")) return true;
    let current = element;
    while (current && current !== document.body) {
      const style = getComputedStyle(current);
      const rect = current.getBoundingClientRect();
      const topBar = (style.position === "fixed" || style.position === "sticky")
        && rect.top <= 8
        && rect.height > 0
        && rect.height <= 120
        && rect.width >= window.innerWidth * 0.8;
      if (topBar) return true;
      current = current.parentElement;
    }
    return false;
  };
  const visibleText = function (root, skipChrome) {
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) continue;
      if (skipChrome && isChrome(parent)) continue;
      const text = (node.textContent || "").replace(/\\\\s+/g, " ").trim();
      if (text) parts.push(text);
    }
    return parts.join(" ");
  };
  const controls = Array.from(document.querySelectorAll("a, button, input, select, textarea")).filter(isVisible);
  const mainControls = controls.filter(function (element) { return !isChrome(element); });
  const mainText = visibleText(document.body, true);
  const bodyText = visibleText(document.body, false);
  const explicitLoader = Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"], [data-loading="true"], .animate-spin')).some(isVisible);
  const substantialVisual = Array.from(document.querySelectorAll("img, canvas, video")).some(function (element) {
    if (!isVisible(element) || isChrome(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height >= window.innerWidth * window.innerHeight * 0.12;
  });
  const animatedLoader = Array.from(document.querySelectorAll("body *")).some(function (element) {
    if (!isVisible(element) || isChrome(element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const duration = Number.parseFloat(style.animationDuration) || 0;
    return duration > 0 && rect.width <= 120 && rect.height <= 120;
  });
  const smallVisibleShape = Array.from(document.querySelectorAll("body *")).some(function (element) {
    if (!isVisible(element) || isChrome(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 8 && rect.width <= 140 && rect.height >= 8 && rect.height <= 140;
  });
  const mediaCount = Array.from(document.querySelectorAll("img, svg, canvas, video, input, button, a")).filter(isVisible).length;
  const loadingCopy = /\\\\b(loading|please wait|finding|searching|almost ready)\\\\b/i.test(mainText);
  const chromeOnly = mainText.length < 40 && mainControls.length < 2 && !substantialVisual;
  return {
    explicitLoader: explicitLoader,
    loadingCopy: loadingCopy,
    substantialVisual: substantialVisual,
    mainTextLength: mainText.length,
    mainControlCount: mainControls.length,
    chromeOnly: chromeOnly,
    animatedLoader: animatedLoader,
    smallVisibleShape: smallVisibleShape,
    mediaCount: mediaCount,
    bodyTextLength: bodyText.length,
  };
})()`;

export function assessPageSnapshot(snapshot: PageQualitySnapshot): PageQuality {
  if (snapshot.explicitLoader && !snapshot.substantialVisual && snapshot.mainTextLength < 80) return "loading";
  if (snapshot.substantialVisual || snapshot.mainControlCount >= 2 || snapshot.mainTextLength >= 80) return "ready";
  if (snapshot.chromeOnly || snapshot.loadingCopy || snapshot.animatedLoader) return "loading";
  if (snapshot.bodyTextLength < 4 && snapshot.mediaCount < 2) return "empty";
  if (snapshot.mainTextLength < 24 && snapshot.smallVisibleShape) return "loading";
  return "ready";
}
