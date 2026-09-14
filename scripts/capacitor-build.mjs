import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webDir = path.join(root, "capacitor", "www");
const excluded = new Set([".git", "android", "ios", "node_modules", "capacitor", "docs", "scripts"]);

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

const entries = await (await import("node:fs/promises")).readdir(root, { withFileTypes: true });
await Promise.all(
  entries
    .filter((entry) => !excluded.has(entry.name))
    .map((entry) => cp(path.join(root, entry.name), path.join(webDir, entry.name), { recursive: true })),
);

console.log(`Copied web app to ${path.relative(root, webDir)}`);