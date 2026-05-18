// Local semantic-release plugin: appends Subresource Integrity hashes from
// dist/sri.txt to the auto-generated release notes. Wired in .releaserc.json
// AFTER @semantic-release/release-notes-generator so notes get concatenated.
import { readFileSync, existsSync } from "node:fs";

export function generateNotes(_pluginConfig, context) {
  const path = "dist/sri.txt";
  if (!existsSync(path)) {
    context.logger?.warn?.("[sri-notes] dist/sri.txt missing — skipping SRI block");
    return "";
  }
  const sri = readFileSync(path, "utf8").trim();
  return ["", "", "## Subresource Integrity", "", "```", sri, "```", ""].join("\n");
}
