import { readFile, readdir, access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
const required = ["product-spec", "architecture", "domain-model", "planning-engine", "integrations", "build-plan"];
for (const name of required) await access(`docs/${name}.md`);
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await scan(path); continue; }
    if (!path.endsWith(".md")) continue;
    const content = await readFile(path, "utf8");
    if ((content.match(/```/g)?.length ?? 0) % 2) throw new Error(`Unclosed fence in ${path}`);
    for (const [, link] of content.matchAll(/\]\(([^)]+)\)/g)) {
      if (link.includes("://") || link.startsWith("#")) continue;
      await access(resolve(dirname(path), link.split("#")[0]));
    }
  }
}
await scan("docs");
console.log("Six required documents, ADR links, and Markdown fences: PASS");
