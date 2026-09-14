import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const pages = [
  "index.html",
  "overlay.html",
  "minoverlay.html",
  "days-gone-noguns.html",
  "days-gone-noguns-overlay.html",
  "splits.html",
  "phases.html",
  "game-editor.html",
  "run-comparison.html"
];

const failures = [];

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function stripQuery(value) {
  return value.split("?")[0].split("#")[0];
}

function isLocalReference(value) {
  return (
    value &&
    !value.startsWith("http://") &&
    !value.startsWith("https://") &&
    !value.startsWith("//") &&
    !value.startsWith("data:") &&
    !value.startsWith("#")
  );
}

for (const page of pages) {
  if (!(await exists(page))) {
    failures.push(`${page}: missing entry page`);
    continue;
  }

  const html = await readFile(path.join(root, page), "utf8");
  const refs = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)]
    .map((match) => stripQuery(match[1]))
    .filter(isLocalReference);

  for (const ref of refs) {
    const normalized = path.normalize(path.join(path.dirname(page), ref));
    if (normalized.startsWith("..")) {
      failures.push(`${page}: reference escapes project root: ${ref}`);
      continue;
    }

    if (!(await exists(normalized))) {
      failures.push(`${page}: missing referenced file ${ref}`);
    }
  }
}

if (failures.length) {
  console.error("Static page check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Static page check passed for ${pages.length} pages.`);
