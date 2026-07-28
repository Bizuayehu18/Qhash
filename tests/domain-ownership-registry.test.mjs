import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyOwnershipFileAssets,
  discoverOwnershipAssets,
  extractNetlifyMethodContract,
  listRepositoryFiles,
  parseNetlifyFunctionsDirectory,
  validateOwnershipRegistry,
} from "../scripts/check-engineering-baseline.mjs";

const root = process.cwd();
const registryPath = path.join(
  root,
  "docs",
  "architecture",
  "domain-ownership.json",
);
const canonicalRegistry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const discovered = discoverOwnershipAssets(root);

function cloneRegistry() {
  return structuredClone(canonicalRegistry);
}

function validate(registry) {
  return validateOwnershipRegistry({ checkRoot: root, registry, discovered });
}

function domainWithAsset(registry, kind, value) {
  return registry.domains.find((domain) =>
    (domain.assets[kind] ?? []).includes(value),
  );
}

test("canonical cross-system ownership registry passes", () => {
  assert.deepEqual(validate(canonicalRegistry), []);
});

for (const [kind, value] of [
  ["routes", discovered.routes[0]],
  ["sourceModules", discovered.sourceModules[0]],
  ["netlifySupportModules", discovered.netlifySupportModules[0]],
  ["tests", discovered.tests[0]],
  ["documents", discovered.documents[0]],
  ["governanceFiles", discovered.governanceFiles[0]],
  ["netlifyDatabaseArtifacts", discovered.netlifyDatabaseArtifacts[0]],
  ["publicAssets", discovered.publicAssets[0]],
  ["publicSurfaces", discovered.publicSurfaces[0]],
  ["repositoryFiles", discovered.repositoryFiles[0]],
  ["supabaseTables", discovered.supabaseTables[0]],
  ["supabaseFunctions", discovered.supabaseFunctions[0]],
  ["supabaseInternalFunctions", discovered.supabaseInternalFunctions[0]],
  ["supabaseMigrations", discovered.supabaseMigrations[0]],
]) {
  test(`missing ${kind} ownership fails closed`, () => {
    const registry = cloneRegistry();
    const domain = domainWithAsset(registry, kind, value);
    assert.ok(domain, `fixture owner exists for ${value}`);
    domain.assets[kind] = domain.assets[kind].filter((entry) => entry !== value);
    assert.ok(
      validate(registry).some((error) =>
        error.includes(`Missing ${kind} owner for ${value}.`),
      ),
    );
  });
}

test("duplicate ownership fails closed", () => {
  const registry = cloneRegistry();
  const value = discovered.routes[0];
  const owner = domainWithAsset(registry, "routes", value);
  const other = registry.domains.find((domain) => domain.id !== owner.id);
  other.assets.routes = [...(other.assets.routes ?? []), value].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  assert.ok(
    validate(registry).some((error) =>
      error.includes(`Duplicate routes owners for ${value}`),
    ),
  );
});

test("stale and unsafe file registrations fail closed", () => {
  for (const invalidPath of [
    "src/does-not-exist.ts",
    "../outside.ts",
    "src\\lib\\errors.ts",
    "src/**/*.ts",
    "C:/absolute.ts",
  ]) {
    const registry = cloneRegistry();
    const domain = registry.domains.find((entry) => entry.id === "platform");
    domain.assets.sourceModules = [
      ...(domain.assets.sourceModules ?? []),
      invalidPath,
    ].sort((left, right) => left.localeCompare(right, "en"));
    const errors = validate(registry);
    assert.ok(
      errors.some(
        (error) =>
          error.includes("invalid sourceModules path") ||
          error.includes("Stale sourceModules registration") ||
          error.includes("does not exist"),
      ),
      `${invalidPath} rejected`,
    );
  }
});

test("unknown and duplicate domains fail closed", () => {
  const unknown = cloneRegistry();
  unknown.netlifyFunctions[0].domain = "not-a-domain";
  assert.ok(
    validate(unknown).some((error) => error.includes("unknown domain")),
  );

  const duplicate = cloneRegistry();
  duplicate.domains.push(structuredClone(duplicate.domains[0]));
  assert.ok(
    validate(duplicate).some((error) =>
      error.includes("Duplicate ownership domain id"),
    ),
  );
});

test("unsorted ownership arrays fail closed", () => {
  const registry = cloneRegistry();
  const domain = registry.domains.find(
    (entry) => (entry.assets.sourceModules ?? []).length >= 2,
  );
  domain.assets.sourceModules = [...domain.assets.sourceModules].reverse();
  assert.ok(
    validate(registry).some((error) =>
      error.includes(`Domain ${domain.id} asset sourceModules must be sorted.`),
    ),
  );
});

test("Netlify Function path and coverage drift fail closed", () => {
  const wrongPath = cloneRegistry();
  wrongPath.netlifyFunctions[0].runtime.path = "/api/wrong";
  assert.ok(
    validate(wrongPath).some((error) =>
      error.includes("runtime path /api/wrong does not match source"),
    ),
  );

  const uncovered = cloneRegistry();
  const covered = uncovered.netlifyFunctions.find(
    (entry) => entry.handlerTests.length > 0,
  );
  covered.handlerTests = [];
  assert.ok(
    validate(uncovered).some((error) =>
      error.includes("needs a handler test or coverage waiver"),
    ),
  );
});

test("Netlify Function runtime schema, methods, and support drift fail closed", () => {
  const unknownRuntime = cloneRegistry();
  unknownRuntime.netlifyFunctions[0].runtime.timeout = 30;
  assert.ok(
    validate(unknownRuntime).some((error) =>
      error.includes("runtime has unknown field timeout"),
    ),
  );

  const missingPath = cloneRegistry();
  delete missingPath.netlifyFunctions.find(
    (entry) => entry.runtime.kind === "http",
  ).runtime.path;
  assert.ok(
    validate(missingPath).some((error) => error.includes("needs an HTTP path")),
  );

  const wrongMethods = cloneRegistry();
  const httpEntry = wrongMethods.netlifyFunctions.find(
    (entry) => entry.runtime.kind === "http",
  );
  httpEntry.runtime.methods = ["DELETE"];
  assert.ok(
    validate(wrongMethods).some((error) =>
      error.includes("runtime methods") && error.includes("do not match source"),
    ),
  );

  const unsupportedMethod = cloneRegistry();
  unsupportedMethod.netlifyFunctions.find(
    (entry) => entry.runtime.kind === "http",
  ).runtime.methods = ["POTS"];
  assert.ok(
    validate(unsupportedMethod).some((error) =>
      error.includes("needs sorted unique HTTP methods"),
    ),
  );

  const missingSupport = cloneRegistry();
  const supported = missingSupport.netlifyFunctions.find(
    (entry) => entry.supportModules.length > 0,
  );
  supported.supportModules = [];
  assert.ok(
    validate(missingSupport).some((error) =>
      error.includes("supportModules do not match direct source imports"),
    ),
  );
});

test("contradictory Config and handler method enforcement is rejected", () => {
  const contract = extractNetlifyMethodContract(`
    export default async function handler(request) {
      if (request.method !== "GET") return new Response(null, { status: 405 });
    }
    export const config = { path: "/api/example", method: "POST" };
  `);
  assert.deepEqual(contract.methods, ["GET", "POST"]);
  assert.equal(contract.methodEnforcement, "both");
  assert.equal(contract.methodLayersAgree, false);
});

test("Netlify Function trust and ownership metadata are pinned closed", () => {
  const fabricatedTrust = cloneRegistry();
  fabricatedTrust.netlifyFunctions[0].trust.authentication = "looks-secure";
  assert.ok(
    validate(fabricatedTrust).some((error) =>
      error.includes("invalid authentication looks-secure"),
    ),
  );

  const validTrustSwap = cloneRegistry();
  const withdrawal = validTrustSwap.netlifyFunctions.find(
    (entry) =>
      entry.trust.authorization === "active-non-admin-profile",
  );
  withdrawal.trust.authorization = "active-admin-profile";
  assert.ok(
    validate(validTrustSwap).some((error) =>
      error.includes("does not match its pinned source-reviewed contract"),
    ),
  );

  for (const invalidStatus of [undefined, "almost-clear"]) {
    const registry = cloneRegistry();
    if (invalidStatus === undefined) {
      delete registry.netlifyFunctions[0].ownershipStatus;
    } else {
      registry.netlifyFunctions[0].ownershipStatus = invalidStatus;
    }
    assert.ok(
      validate(registry).some((error) =>
        error.includes("needs ownershipStatus clear or mixed"),
      ),
    );
  }
});

test("unrelated runnable tests cannot spoof Netlify handler coverage", () => {
  const registry = cloneRegistry();
  const covered = registry.netlifyFunctions.find(
    (entry) => entry.handlerTests.length > 0,
  );
  const unrelatedTest = discovered.tests.find((testPath) => {
    if (covered.handlerTests.includes(testPath)) return false;
    const source = fs.readFileSync(path.join(root, testPath), "utf8");
    const functionName = path.posix.basename(
      covered.file,
      path.posix.extname(covered.file),
    );
    return (
      !source.includes(functionName) &&
      !source.includes(covered.runtime.path)
    );
  });
  assert.ok(unrelatedTest, "unrelated runnable test fixture exists");
  covered.handlerTests = [unrelatedTest];
  assert.ok(
    validate(registry).some((error) =>
      error.includes("does not import its exact adapter"),
    ),
  );
});

test("mixed Netlify Function ownership requires named remediation", () => {
  const registry = cloneRegistry();
  const mixed = registry.netlifyFunctions.find(
    (entry) => entry.ownershipStatus === "mixed",
  );
  delete mixed.remediation;
  assert.ok(
    validate(registry).some((error) =>
      error.includes("needs remediation"),
    ),
  );
});

test("live-only resources require a known owner and remediation", () => {
  const registry = cloneRegistry();
  registry.knownLiveOnlyResources[0].owner = "unknown";
  registry.knownLiveOnlyResources[0].remediation = "";
  assert.ok(
    validate(registry).some((error) =>
      error.includes("Invalid known live-only resource entry"),
    ),
  );
});

test("live-only inventory is exact, unique, and owner-consistent", () => {
  const missing = cloneRegistry();
  const removed = missing.knownLiveOnlyResources.shift();
  assert.ok(
    validate(missing).some((error) =>
      error.includes(`Missing pinned live-only resource ${removed.resource}`),
    ),
  );

  const invented = cloneRegistry();
  invented.knownLiveOnlyResources.push({
    resource: "public.unreviewed_live_object",
    owner: "platform",
    status: "live-create-source-missing",
    remediation: "Review and reconcile this object.",
  });
  invented.knownLiveOnlyResources.sort((left, right) =>
    left.resource.localeCompare(right.resource, "en"),
  );
  assert.ok(
    validate(invented).some((error) =>
      error.includes("Unpinned live-only resource public.unreviewed_live_object"),
    ),
  );

  const duplicate = cloneRegistry();
  duplicate.knownLiveOnlyResources.push(
    structuredClone(duplicate.knownLiveOnlyResources[0]),
  );
  duplicate.knownLiveOnlyResources.sort((left, right) =>
    left.resource.localeCompare(right.resource, "en"),
  );
  assert.ok(
    validate(duplicate).some((error) =>
      error.includes("cannot contain duplicate resources"),
    ),
  );

  const ownerMismatch = cloneRegistry();
  ownerMismatch.knownLiveOnlyResources[0].owner = "platform";
  assert.ok(
    validate(ownerMismatch).some((error) =>
      error.includes("does not match its canonical Supabase owner"),
    ),
  );
});

test("Git inventory includes tracked and unignored files and rejects ignored state", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "qhash-ownership-git-"));
  try {
    execFileSync("git", ["init", "--quiet", fixture], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    fs.writeFileSync(path.join(fixture, ".gitignore"), ".env\nignored.log\n");
    fs.writeFileSync(path.join(fixture, "tracked.ts"), "export {};\n");
    fs.writeFileSync(path.join(fixture, "untracked.md"), "# Included\n");
    fs.writeFileSync(path.join(fixture, ".env"), "SECRET=not-real\n");
    fs.writeFileSync(path.join(fixture, "ignored.log"), "local state\n");
    execFileSync("git", ["-C", fixture, "add", ".gitignore", "tracked.ts"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    assert.deepEqual(
      listRepositoryFiles(fixture).sort(),
      [".gitignore", "tracked.ts", "untracked.md"],
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("Git inventory fails closed outside a repository", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "qhash-ownership-no-git-"));
  try {
    assert.throws(
      () => listRepositoryFiles(fixture),
      /Unable to derive the required Git tracked\/unignored inventory/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("Netlify discovery distinguishes nested entries from support modules", () => {
  const classified = classifyOwnershipFileAssets({
    repositoryInventory: [
      "netlify/functions/foo/index.mts",
      "netlify/functions/foo/helper.ts",
      "netlify/functions/lib/shared.mjs",
      "netlify/functions/top-level.cjs",
    ],
    databaseBaseline: {
      migrations: [],
      generatedSnapshot: { functions: [], tables: [] },
    },
    engineeringBaseline: {
      ownership: { supabaseInternalFunctions: [] },
    },
  });
  assert.deepEqual(classified.netlifyFunctions, [
    "netlify/functions/foo/index.mts",
    "netlify/functions/top-level.cjs",
  ]);
  assert.deepEqual(classified.netlifySupportModules, [
    "netlify/functions/foo/helper.ts",
    "netlify/functions/lib/shared.mjs",
  ]);
});

test("Netlify Function discovery is bound to the configured deployment directory", () => {
  assert.equal(
    parseNetlifyFunctionsDirectory(`
      [build]
      command = "npm run build"
      [functions]
      directory = "netlify/functions"
      node_bundler = "esbuild"
      [dev]
      port = 3000
    `),
    "netlify/functions",
  );
  assert.equal(
    parseNetlifyFunctionsDirectory(`
      [functions]
      directory = "functions-v2"
    `),
    "functions-v2",
  );
  assert.equal(parseNetlifyFunctionsDirectory("[build]\ncommand = \"x\"\n"), undefined);
});

test("repository files form one exact partition and nested tests fail closed", () => {
  const duplicateCategory = structuredClone(discovered);
  duplicateCategory.routes.push(duplicateCategory.sourceModules[0]);
  assert.ok(
    validateOwnershipRegistry({
      checkRoot: root,
      registry: canonicalRegistry,
      discovered: duplicateCategory,
    }).some((error) => error.includes("multiple ownership asset categories")),
  );

  const nestedTest = structuredClone(discovered);
  nestedTest.repositoryInventory.push("tests/nested/unrun.test.mjs");
  nestedTest.repositoryFiles.push("tests/nested/unrun.test.mjs");
  assert.ok(
    validateOwnershipRegistry({
      checkRoot: root,
      registry: canonicalRegistry,
      discovered: nestedTest,
    }).some((error) =>
      error.includes("is not runnable by the canonical top-level test manifest"),
    ),
  );
});

test("ownership does not duplicate or change immutable migration checksums", () => {
  const baseline = JSON.parse(
    fs.readFileSync(
      path.join(root, "scripts", "database-types-baseline.json"),
      "utf8",
    ),
  );
  assert.equal(JSON.stringify(canonicalRegistry).includes("sha256"), false);
  for (const migration of baseline.migrations) {
    const bytes = fs.readFileSync(path.join(root, migration.path));
    assert.equal(
      crypto.createHash("sha256").update(bytes).digest("hex"),
      migration.sha256,
      migration.path,
    );
  }
});
