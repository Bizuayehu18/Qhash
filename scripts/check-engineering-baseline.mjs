import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(root, "scripts", "engineering-baseline.json"),
    "utf8",
  ),
);

function walk(directory, predicate = () => true) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walk(fullPath, predicate));
    else if (predicate(fullPath)) results.push(fullPath);
  }
  return results;
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function fail(message) {
  console.error(`- ${message}`);
  process.exitCode = 1;
}

function checkBoundaries() {
  const sourceFiles = walk(path.join(root, "src"), (filePath) =>
    /\.(?:ts|tsx|mts)$/.test(filePath),
  );
  const importPattern =
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  const forbiddenClientFragments = [
    "supabase-admin",
    "/db/",
    "netlify/functions",
    "supabase/migrations",
  ];
  let serverBridgeImports = 0;

  for (const filePath of sourceFiles) {
    const fileRelative = relative(filePath);
    if (
      fileRelative === "src/routeTree.gen.ts" ||
      fileRelative === "src/lib/database.generated.ts"
    ) {
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");
    const isServerModule = fileRelative.startsWith("src/lib/server/");
    const isRouteModule = fileRelative.startsWith("src/routes/");

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1].replaceAll("\\", "/");
      const normalizedSpecifier = specifier.toLowerCase();

      if (
        !isServerModule &&
        forbiddenClientFragments.some((fragment) =>
          normalizedSpecifier.includes(fragment),
        )
      ) {
        fail(`${fileRelative} imports forbidden client dependency ${specifier}.`);
      }

      if (!isServerModule && normalizedSpecifier.includes("/lib/server/")) {
        serverBridgeImports += 1;
      }

      if (!isRouteModule && specifier.startsWith(".")) {
        const resolved = path
          .normalize(path.resolve(path.dirname(filePath), specifier))
          .replaceAll("\\", "/");
        if (resolved.includes("/src/routes/")) {
          fail(`${fileRelative} introduces a reverse dependency into routes.`);
        }
      }
    }

    if (
      !isServerModule &&
      /SUPABASE_SERVICE_ROLE_KEY|NOWPAYMENTS_(?:API|IPN)_KEY/.test(source)
    ) {
      fail(`${fileRelative} references a server-only secret name.`);
    }
  }

  const functionDirectory = path.join(root, "netlify", "functions");
  const entrypoints = fs
    .readdirSync(functionDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mts"))
    .map((entry) => entry.name)
    .sort();
  const netlifyConfig = JSON.parse(
    fs.readFileSync(path.join(root, "tsconfig.netlify.json"), "utf8"),
  );
  if (!netlifyConfig.include?.includes("netlify/functions/**/*.mts")) {
    fail(
      "tsconfig.netlify.json must cover every Netlify Function through netlify/functions/**/*.mts.",
    );
  }

  if (serverBridgeImports > baseline.boundaries.serverBridgeImports) {
    fail(
      `Server bridge imports increased from ${baseline.boundaries.serverBridgeImports} to ${serverBridgeImports}.`,
    );
  }

  console.log(
    `Boundary check complete: ${entrypoints.length} Function entrypoints; ${serverBridgeImports} existing createServerFn bridge imports.`,
  );
}

function thresholdFor(fileRelative) {
  if (fileRelative.startsWith("src/routes/")) return 150;
  if (fileRelative.startsWith("src/components/")) return 300;
  if (fileRelative.startsWith("netlify/functions/")) return 250;
  if (fileRelative.startsWith("src/lib/server/")) return 400;
  if (fileRelative.startsWith("tests/")) return 800;
  return null;
}

function collectComplexityWarnings() {
  const files = [
    ...walk(path.join(root, "src"), (filePath) => /\.(?:ts|tsx)$/.test(filePath)),
    ...walk(path.join(root, "netlify", "functions"), (filePath) =>
      /\.mts$/.test(filePath),
    ),
    ...walk(path.join(root, "tests"), (filePath) => /\.mjs$/.test(filePath)),
  ];
  const warnings = {};

  for (const filePath of files) {
    const fileRelative = relative(filePath);
    if (
      fileRelative === "src/routeTree.gen.ts" ||
      fileRelative === "src/lib/database.generated.ts" ||
      fileRelative === "src/lib/database.types.ts"
    ) {
      continue;
    }

    const threshold = thresholdFor(fileRelative);
    if (threshold === null) continue;
    const nonblankLines = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
    if (nonblankLines > threshold) warnings[fileRelative] = nonblankLines;
  }

  return warnings;
}

function checkComplexity() {
  const current = collectComplexityWarnings();
  const expected = baseline.complexity.warnings;

  for (const [fileRelative, lineCount] of Object.entries(current)) {
    const baselineCount = expected[fileRelative];
    if (baselineCount === undefined) {
      fail(`New complexity warning: ${fileRelative} (${lineCount} nonblank lines).`);
    } else if (lineCount > baselineCount) {
      fail(
        `Complexity debt increased: ${fileRelative} ${baselineCount} -> ${lineCount} nonblank lines.`,
      );
    }
  }

  console.log(
    `Complexity baseline: ${Object.keys(current).length} existing report-only warnings; no increase.`,
  );
}

function checkDocs() {
  const requiredDocuments = baseline.docs.required;
  for (const document of requiredDocuments) {
    if (!fs.existsSync(path.join(root, document))) {
      fail(`Required architecture document is missing: ${document}.`);
    }
  }

  const markdownFiles = [
    path.join(root, "README.md"),
    ...walk(path.join(root, "docs"), (filePath) => filePath.endsWith(".md")),
  ];
  const linkPattern = /\[[^\]]*]\(([^)]+)\)/g;

  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const fenceCount = (content.match(/^```/gm) ?? []).length;
    if (fenceCount % 2 !== 0) fail(`${relative(filePath)} has unbalanced fences.`);

    for (const match of content.matchAll(linkPattern)) {
      const rawTarget = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, "");
      if (
        !rawTarget ||
        rawTarget.startsWith("#") ||
        /^(?:https?:|mailto:)/.test(rawTarget)
      ) {
        continue;
      }
      const withoutAnchor = decodeURIComponent(rawTarget.split("#")[0]);
      const target = path.resolve(path.dirname(filePath), withoutAnchor);
      if (!fs.existsSync(target)) {
        fail(`${relative(filePath)} has broken link ${rawTarget}.`);
      }
    }
  }

  const adrDirectory = path.join(root, "docs", "architecture", "decisions");
  const adrIndex = fs.readFileSync(path.join(adrDirectory, "README.md"), "utf8");
  const adrFiles = fs
    .readdirSync(adrDirectory)
    .filter((name) => /^(?:ADR-)?\d{4}.*\.md$/i.test(name))
    .sort();
  for (const adrFile of adrFiles) {
    if (!adrIndex.includes(adrFile)) fail(`ADR index omits ${adrFile}.`);
    const adr = fs.readFileSync(path.join(adrDirectory, adrFile), "utf8");
    const status = adr.match(/^Status:\s*(.+)$/im)?.[1]?.trim();
    if (
      !status ||
      !["Proposed", "Accepted", "Rejected", "Deprecated", "Superseded"].includes(
        status,
      )
    ) {
      fail(`${adrFile} has an invalid or missing Status.`);
    }
  }

  console.log(
    `Documentation check complete: ${markdownFiles.length} files and ${adrFiles.length} ADRs.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const commands = {
    boundaries: checkBoundaries,
    complexity: checkComplexity,
    docs: checkDocs,
  };

  if (!commands[mode]) {
    console.error(
      "Usage: node scripts/check-engineering-baseline.mjs <boundaries|complexity|docs>",
    );
    process.exit(2);
  }

  commands[mode]();
}

export { checkBoundaries, checkComplexity, checkDocs, collectComplexityWarnings };
