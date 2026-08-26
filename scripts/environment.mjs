export function inferEnvironment(url) {
  try {
    const parsed = new URL(url);
    const signal = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return "local";
    if (/(staging|code-preview|stage\.|-stage[.-])/.test(signal)) return "staging";
    if (/(preview|deploy-preview|-git-)/.test(signal)) return "preview";
    if (parsed.hostname.endsWith(".vercel.app")) return "unknown";
    return "production";
  } catch {
    return "unknown";
  }
}
