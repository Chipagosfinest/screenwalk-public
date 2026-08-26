import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "apps", "web-dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, "apps", "studio", "dist"), output, { recursive: true });
await cp(join(root, "apps", "docs", ".vitepress", "dist"), join(output, "__docs"), { recursive: true });

console.log("Built screenwalk.app and screenwalk.dev into apps/web-dist/");
