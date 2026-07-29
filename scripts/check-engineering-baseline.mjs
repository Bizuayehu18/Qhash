import { execFileSync } from "node:child_process";
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
const ownershipRegistryPath = path.join(
  root,
  "docs",
  "architecture",
  "domain-ownership.json",
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

function listRepositoryFiles(checkRoot) {
  try {
    return execFileSync(
      "git",
      [
        "-C",
        checkRoot,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    )
      .split("\0")
      .filter(Boolean)
      .map((filePath) => filePath.replaceAll("\\", "/"));
  } catch (error) {
    throw new Error(
      `Unable to derive the required Git tracked/unignored inventory for ${checkRoot}.`,
      { cause: error },
    );
  }
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function fail(message) {
  console.error(`- ${message}`);
  process.exitCode = 1;
}

const ownershipAssetKinds = [
  "documents",
  "governanceFiles",
  "netlifyDatabaseArtifacts",
  "netlifySupportModules",
  "publicAssets",
  "publicSurfaces",
  "repositoryFiles",
  "routes",
  "sourceModules",
  "supabaseInternalFunctions",
  "supabaseMigrations",
  "supabaseTables",
  "supabaseFunctions",
  "tests",
];

const ownershipFileAssetKinds = [
  "documents",
  "governanceFiles",
  "netlifyDatabaseArtifacts",
  "netlifyFunctions",
  "netlifySupportModules",
  "publicAssets",
  "publicSurfaces",
  "repositoryFiles",
  "routes",
  "sourceModules",
  "supabaseMigrations",
  "tests",
];

const netlifyProductionGates = new Set([
  "none",
  "published-netlify-context",
]);
const netlifyAuthenticationKinds = new Set([
  "external-verifier-api-key",
  "netlify-scheduled-invocation",
  "nowpayments-hmac",
  "supabase-bearer",
]);
const netlifyAuthorizationKinds = new Set([
  "active-admin-profile",
  "active-non-admin-profile",
  "active-non-admin-profile-and-fund-pin",
  "active-profile",
  "active-profile-and-deposit-enablement",
  "database-authoritative-admin-rpc",
  "none",
  "provider-payment-refetch",
  "verifier-key-holder",
]);
const netlifyHttpMethods = new Set([
  "DELETE",
  "GET",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);
const liveOnlyStatuses = new Set([
  "live-create-source-missing",
  "live-event-trigger-helper-source-missing",
  "live-function-body-source-missing",
  "live-trigger-helper-source-missing",
  "manual-standalone-sql-drift",
]);

function sortStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function extractNetlifyMethodContract(source) {
  const configStart = source.indexOf("export const config");
  const handlerSource =
    configStart === -1 ? source : source.slice(0, configStart);
  const configSource =
    configStart === -1 ? "" : source.slice(configStart);
  const configMethods = [
    ...configSource.matchAll(/\bmethod:\s*["']([A-Z]+)["']/g),
  ].map((match) => match[1]);
  const handlerMethods = [
    ...handlerSource.matchAll(
      /\b(?:req|request)\.method\s*(?:===|!==)\s*["']([A-Z]+)["']/g,
    ),
  ].map((match) => match[1]);
  const methods = sortStrings(
    [...new Set([...configMethods, ...handlerMethods])],
  );
  const methodLayersAgree =
    configMethods.length === 0 ||
    handlerMethods.length === 0 ||
    JSON.stringify(sortStrings([...new Set(configMethods)])) ===
      JSON.stringify(sortStrings([...new Set(handlerMethods)]));
  const methodEnforcement =
    configMethods.length > 0 && handlerMethods.length > 0
      ? "both"
      : configMethods.length > 0
        ? "config"
        : handlerMethods.length > 0
          ? "handler"
          : null;
  return { methods, methodEnforcement, methodLayersAgree };
}

function sourceContainsEvery(source, anchors) {
  return anchors.every((anchor) => source.includes(anchor));
}

function parseNetlifyFunctionsDirectory(source) {
  let inFunctionsSection = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+]$/.test(trimmed)) {
      inFunctionsSection = trimmed === "[functions]";
      continue;
    }
    if (!inFunctionsSection) continue;
    const directory = trimmed.match(/^directory\s*=\s*"([^"]+)"$/)?.[1];
    if (directory) return directory.replaceAll("\\", "/").replace(/\/+$/, "");
  }
  return undefined;
}

function classifyOwnershipFileAssets({
  repositoryInventory,
  databaseBaseline,
  engineeringBaseline,
}) {
  const routeFiles = repositoryInventory.filter((filePath) =>
    /^src\/routes\/.+\.(?:ts|tsx)$/.test(filePath),
  );
  const publicSurfaces = repositoryInventory.filter((filePath) =>
    /^src\/domains\/[^/]+\/public\.ts$/.test(filePath),
  );
  const excludedSourceFiles = new Set([...routeFiles, ...publicSurfaces]);
  const sourceModules = repositoryInventory
    .filter((filePath) => filePath.startsWith("src/"))
    .filter((filePath) => !excludedSourceFiles.has(filePath));
  const functionEntries = repositoryInventory.filter(
    (filePath) => {
      if (/^netlify\/functions\/[^/]+\.(?:[cm]?[jt]s)$/.test(filePath)) {
        return true;
      }
      const nested = filePath.match(
        /^netlify\/functions\/([^/]+)\/([^/]+)\.(?:[cm]?[jt]s)$/,
      );
      return Boolean(
        nested &&
          nested[1] !== "lib" &&
          (nested[2] === "index" || nested[2] === nested[1]),
      );
    },
  );
  const functionEntrySet = new Set(functionEntries);
  const functionSupport = repositoryInventory.filter(
    (filePath) =>
      /^netlify\/functions\/.+\.(?:[cm]?[jt]s)$/.test(filePath) &&
      !functionEntrySet.has(filePath),
  );
  const fixedGovernanceFiles = [
    "netlify.toml",
    "package-lock.json",
    "package.json",
    "tsconfig.json",
    "tsconfig.netlify.json",
    "vite.config.ts",
    "docs/architecture/domain-ownership.json",
  ];
  const governanceFiles = [
    ...repositoryInventory.filter(
      (filePath) =>
        /^\.github\/workflows\/.+\.ya?ml$/.test(filePath) ||
        /^scripts\/.+\.(?:mjs|json)$/.test(filePath) ||
        (/^supabase\/.+\.sql$/.test(filePath) &&
          !filePath.startsWith("supabase/migrations/")),
    ),
    ...fixedGovernanceFiles,
  ];

  const discovered = {
    documents: repositoryInventory.filter((filePath) =>
      /^docs\/.+\.md$/.test(filePath),
    ),
    governanceFiles,
    netlifyDatabaseArtifacts: repositoryInventory.filter((filePath) =>
      filePath.startsWith("netlify/database/"),
    ),
    netlifyFunctions: functionEntries,
    netlifySupportModules: functionSupport,
    publicAssets: repositoryInventory.filter((filePath) =>
      filePath.startsWith("public/"),
    ),
    publicSurfaces,
    routes: routeFiles,
    sourceModules,
    supabaseMigrations: databaseBaseline.migrations.map((entry) => entry.path),
    supabaseTables: databaseBaseline.generatedSnapshot.tables.map(
      (table) => `public.${table}`,
    ),
    supabaseFunctions: databaseBaseline.generatedSnapshot.functions.map(
      (functionName) => `public.${functionName}`,
    ),
    supabaseInternalFunctions:
      engineeringBaseline.ownership.supabaseInternalFunctions,
    tests: repositoryInventory.filter((filePath) =>
      /^tests\/[^/]+\.test\.mjs$/.test(filePath),
    ),
  };
  const specializedFilePaths = new Set(
    Object.entries(discovered)
      .filter(
        ([kind]) =>
          kind !== "supabaseFunctions" && kind !== "supabaseTables",
      )
      .flatMap(([, values]) => values),
  );
  discovered.repositoryFiles = repositoryInventory.filter(
    (filePath) => !specializedFilePaths.has(filePath),
  );
  discovered.repositoryInventory = repositoryInventory;
  return discovered;
}

function discoverOwnershipAssets(checkRoot) {
  const configuredFunctionsDirectory = parseNetlifyFunctionsDirectory(
    fs.readFileSync(path.join(checkRoot, "netlify.toml"), "utf8"),
  );
  if (configuredFunctionsDirectory !== "netlify/functions") {
    throw new Error(
      `Netlify Functions directory must remain netlify/functions; received ${JSON.stringify(configuredFunctionsDirectory)}.`,
    );
  }
  const databaseBaseline = JSON.parse(
    fs.readFileSync(
      path.join(checkRoot, "scripts", "database-types-baseline.json"),
      "utf8",
    ),
  );
  const engineeringBaseline = JSON.parse(
    fs.readFileSync(
      path.join(checkRoot, "scripts", "engineering-baseline.json"),
      "utf8",
    ),
  );
  return classifyOwnershipFileAssets({
    repositoryInventory: listRepositoryFiles(checkRoot),
    databaseBaseline,
    engineeringBaseline,
  });
}

function validateOwnershipRegistry({
  checkRoot = root,
  registry,
  discovered = discoverOwnershipAssets(checkRoot),
} = {}) {
  const errors = [];
  const ownershipBaseline = JSON.parse(
    fs.readFileSync(
      path.join(checkRoot, "scripts", "engineering-baseline.json"),
      "utf8",
    ),
  ).ownership;
  const knownTopLevelFields = new Set([
    "schemaVersion",
    "scope",
    "domains",
    "netlifyFunctions",
    "knownLiveOnlyResources",
  ]);
  const knownDomainFields = new Set(["id", "kind", "description", "assets"]);
  const validDomainKinds = new Set(["product", "platform", "quarantine"]);
  const domainIds = new Set();

  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return ["Ownership registry must be a JSON object."];
  }
  for (const field of Object.keys(registry)) {
    if (!knownTopLevelFields.has(field)) {
      errors.push(`Ownership registry has unknown field ${field}.`);
    }
  }
  if (registry.schemaVersion !== 1) {
    errors.push("Ownership registry schemaVersion must equal 1.");
  }
  if (registry.scope !== "current-cross-system-domain-ownership") {
    errors.push(
      "Ownership registry scope must equal current-cross-system-domain-ownership.",
    );
  }
  if (!Array.isArray(registry.domains) || registry.domains.length === 0) {
    errors.push("Ownership registry must contain at least one domain.");
  }

  const registrations = Object.fromEntries(
    [...ownershipAssetKinds, "netlifyFunctions"].map((kind) => [kind, new Map()]),
  );
  const register = (kind, value, domainId) => {
    const owners = registrations[kind].get(value) ?? [];
    owners.push(domainId);
    registrations[kind].set(value, owners);
  };
  const validPath = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    !/[?*[\]{}]/.test(value);

  for (const domain of Array.isArray(registry.domains) ? registry.domains : []) {
    if (!domain || typeof domain !== "object" || Array.isArray(domain)) {
      errors.push("Every ownership domain must be an object.");
      continue;
    }
    for (const field of Object.keys(domain)) {
      if (!knownDomainFields.has(field)) {
        errors.push(`Ownership domain has unknown field ${field}.`);
      }
    }
    const domainId = domain.id;
    if (typeof domainId !== "string" || !/^[a-z][a-z0-9-]*$/.test(domainId)) {
      errors.push(`Invalid ownership domain id ${JSON.stringify(domainId)}.`);
      continue;
    }
    if (domainIds.has(domainId)) {
      errors.push(`Duplicate ownership domain id ${domainId}.`);
    }
    domainIds.add(domainId);
    if (!validDomainKinds.has(domain.kind)) {
      errors.push(`Domain ${domainId} has invalid kind ${domain.kind}.`);
    }
    if (typeof domain.description !== "string" || domain.description.trim() === "") {
      errors.push(`Domain ${domainId} must have a nonempty description.`);
    }
    if (!domain.assets || typeof domain.assets !== "object") {
      errors.push(`Domain ${domainId} must declare assets.`);
      continue;
    }
    for (const field of Object.keys(domain.assets)) {
      if (!ownershipAssetKinds.includes(field)) {
        errors.push(`Domain ${domainId} has unknown asset kind ${field}.`);
      }
    }
    for (const kind of ownershipAssetKinds) {
      const values = domain.assets[kind] ?? [];
      if (!Array.isArray(values)) {
        errors.push(`Domain ${domainId} asset ${kind} must be an array.`);
        continue;
      }
      if (JSON.stringify(values) !== JSON.stringify(sortStrings(values))) {
        errors.push(`Domain ${domainId} asset ${kind} must be sorted.`);
      }
      for (const value of values) {
        if (
          [
            "supabaseFunctions",
            "supabaseInternalFunctions",
            "supabaseTables",
          ].includes(kind)
        ) {
          if (typeof value !== "string" || !/^public\.[a-z0-9_]+$/.test(value)) {
            errors.push(`Domain ${domainId} has invalid ${kind} value ${value}.`);
            continue;
          }
        } else if (!validPath(value)) {
          errors.push(`Domain ${domainId} has invalid ${kind} path ${value}.`);
          continue;
        }
        register(kind, value, domainId);
      }
    }
  }

  if (!Array.isArray(registry.netlifyFunctions)) {
    errors.push("Ownership registry netlifyFunctions must be an array.");
  } else {
    const functionFiles = registry.netlifyFunctions.map((entry) => entry?.file);
    if (
      JSON.stringify(functionFiles) !==
      JSON.stringify(sortStrings(functionFiles.filter((value) => typeof value === "string")))
    ) {
      errors.push("Ownership registry netlifyFunctions must be sorted by file.");
    }
    for (const entry of registry.netlifyFunctions) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push("Every Netlify Function registry entry must be an object.");
        continue;
      }
      const allowedFields = new Set([
        "file",
        "domain",
        "capability",
        "runtime",
        "trust",
        "supportModules",
        "handlerTests",
        "coverageWaiver",
        "ownershipStatus",
        "remediation",
      ]);
      for (const field of Object.keys(entry)) {
        if (!allowedFields.has(field)) {
          errors.push(`Netlify Function ${entry.file} has unknown field ${field}.`);
        }
      }
      if (!validPath(entry.file)) {
        errors.push(`Netlify Function has invalid file path ${entry.file}.`);
        continue;
      }
      register("netlifyFunctions", entry.file, entry.domain);
      if (!domainIds.has(entry.domain)) {
        errors.push(
          `Netlify Function ${entry.file} references unknown domain ${entry.domain}.`,
        );
      }
      if (
        typeof entry.capability !== "string" ||
        entry.capability.trim() === ""
      ) {
        errors.push(`Netlify Function ${entry.file} needs a capability.`);
      }
      const runtime = entry.runtime;
      if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
        errors.push(`Netlify Function ${entry.file} needs a valid runtime kind.`);
      } else if (runtime.kind === "http") {
        const allowedRuntimeFields = new Set([
          "kind",
          "methodEnforcement",
          "methods",
          "path",
        ]);
        for (const field of Object.keys(runtime)) {
          if (!allowedRuntimeFields.has(field)) {
            errors.push(
              `Netlify Function ${entry.file} runtime has unknown field ${field}.`,
            );
          }
        }
        if (typeof runtime.path !== "string" || !runtime.path.startsWith("/")) {
          errors.push(`Netlify Function ${entry.file} needs an HTTP path.`);
        }
        if (
          !Array.isArray(runtime.methods) ||
          runtime.methods.length === 0 ||
          runtime.methods.some(
            (method) =>
              typeof method !== "string" || !netlifyHttpMethods.has(method),
          ) ||
          JSON.stringify(runtime.methods) !==
            JSON.stringify(sortStrings([...new Set(runtime.methods ?? [])]))
        ) {
          errors.push(
            `Netlify Function ${entry.file} needs sorted unique HTTP methods.`,
          );
        }
        if (!["both", "config", "handler"].includes(runtime.methodEnforcement)) {
          errors.push(
            `Netlify Function ${entry.file} needs a valid method enforcement layer.`,
          );
        }
      } else if (runtime.kind === "schedule") {
        const allowedRuntimeFields = new Set(["kind", "schedule"]);
        for (const field of Object.keys(runtime)) {
          if (!allowedRuntimeFields.has(field)) {
            errors.push(
              `Netlify Function ${entry.file} runtime has unknown field ${field}.`,
            );
          }
        }
        if (
          typeof runtime.schedule !== "string" ||
          runtime.schedule.trim() === ""
        ) {
          errors.push(`Netlify Function ${entry.file} needs a schedule.`);
        }
      } else {
        errors.push(`Netlify Function ${entry.file} needs a valid runtime kind.`);
      }

      const trust = entry.trust;
      if (!trust || typeof trust !== "object" || Array.isArray(trust)) {
        errors.push(`Netlify Function ${entry.file} needs an explicit trust boundary.`);
      } else {
        const expectedTrustFields = [
          "authentication",
          "authorization",
          "productionGate",
        ];
        if (
          JSON.stringify(sortStrings(Object.keys(trust))) !==
          JSON.stringify(expectedTrustFields)
        ) {
          errors.push(
            `Netlify Function ${entry.file} trust must use only the closed trust fields.`,
          );
        }
        if (!netlifyProductionGates.has(trust.productionGate)) {
          errors.push(
            `Netlify Function ${entry.file} has invalid production gate ${trust.productionGate}.`,
          );
        }
        if (!netlifyAuthenticationKinds.has(trust.authentication)) {
          errors.push(
            `Netlify Function ${entry.file} has invalid authentication ${trust.authentication}.`,
          );
        }
        if (!netlifyAuthorizationKinds.has(trust.authorization)) {
          errors.push(
            `Netlify Function ${entry.file} has invalid authorization ${trust.authorization}.`,
          );
        }
        const pinnedTrust =
          ownershipBaseline.netlifyTrustContracts?.[entry.file];
        if (
          !pinnedTrust ||
          JSON.stringify(trust) !== JSON.stringify(pinnedTrust)
        ) {
          errors.push(
            `Netlify Function ${entry.file} trust does not match its pinned source-reviewed contract.`,
          );
        }
      }

      const supportModules = entry.supportModules ?? [];
      if (
        !Array.isArray(supportModules) ||
        JSON.stringify(supportModules) !==
          JSON.stringify(sortStrings([...new Set(supportModules ?? [])]))
      ) {
        errors.push(
          `Netlify Function ${entry.file} supportModules must be sorted and unique.`,
        );
      } else {
        for (const supportPath of supportModules) {
          if (!(discovered.netlifySupportModules ?? []).includes(supportPath)) {
            errors.push(
              `Netlify Function ${entry.file} references unknown support module ${supportPath}.`,
            );
          }
        }
      }

      const handlerTests = entry.handlerTests ?? [];
      if (
        !Array.isArray(handlerTests) ||
        JSON.stringify(handlerTests) !==
          JSON.stringify(sortStrings([...new Set(handlerTests ?? [])]))
      ) {
        errors.push(`Netlify Function ${entry.file} handlerTests must be an array.`);
      } else {
        for (const testPath of handlerTests) {
          const fullTestPath = path.join(checkRoot, testPath);
          if (
            !validPath(testPath) ||
            !(discovered.tests ?? []).includes(testPath) ||
            !fs.existsSync(fullTestPath) ||
            !fs.statSync(fullTestPath).isFile()
          ) {
            errors.push(
              `Netlify Function ${entry.file} references non-runnable handler test ${testPath}.`,
            );
            continue;
          }
          const testSource = fs.readFileSync(fullTestPath, "utf8");
          const importedFiles = [
            ...testSource.matchAll(
              /^\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/gm,
            ),
          ].map((match) =>
            path.posix.normalize(
              path.posix.join(path.posix.dirname(testPath), match[1]),
            ),
          );
          const runtimeMarker =
            runtime?.kind === "http" ? runtime.path : runtime?.schedule;
          if (
            !importedFiles.includes(entry.file) ||
            typeof runtimeMarker !== "string" ||
            !testSource.includes(runtimeMarker)
          ) {
            errors.push(
              `Netlify Function ${entry.file} handler test ${testPath} does not import its exact adapter and reference its runtime contract.`,
            );
          }
        }
      }
      if (
        handlerTests.length === 0 &&
        (typeof entry.coverageWaiver !== "string" ||
          entry.coverageWaiver.trim() === "")
      ) {
        errors.push(
          `Netlify Function ${entry.file} needs a handler test or coverage waiver.`,
        );
      }
      if (
        handlerTests.length > 0 &&
        Object.hasOwn(entry, "coverageWaiver")
      ) {
        errors.push(
          `Netlify Function ${entry.file} cannot keep a coverage waiver when handler tests are registered.`,
        );
      }
      if (!["clear", "mixed"].includes(entry.ownershipStatus)) {
        errors.push(
          `Netlify Function ${entry.file} needs ownershipStatus clear or mixed.`,
        );
      }
      if (
        entry.ownershipStatus === "mixed" &&
        (typeof entry.remediation !== "string" || entry.remediation.trim() === "")
      ) {
        errors.push(
          `Mixed-ownership Netlify Function ${entry.file} needs remediation.`,
        );
      }
      if (
        entry.ownershipStatus === "clear" &&
        Object.hasOwn(entry, "remediation")
      ) {
        errors.push(
          `Clear-ownership Netlify Function ${entry.file} cannot declare remediation.`,
        );
      }

      const sourcePath = path.join(checkRoot, entry.file);
      if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
        const source = fs.readFileSync(sourcePath, "utf8");
        if (runtime?.kind === "http") {
          const configuredPath = source.match(/\bpath:\s*"([^"]+)"/)?.[1];
          if (configuredPath !== runtime.path) {
            errors.push(
              `Netlify Function ${entry.file} runtime path ${runtime.path} does not match source ${configuredPath}.`,
            );
          }
          const sourceMethods = extractNetlifyMethodContract(source);
          if (!sourceMethods.methodLayersAgree) {
            errors.push(
              `Netlify Function ${entry.file} has contradictory Config and handler method enforcement.`,
            );
          }
          if (
            JSON.stringify(sourceMethods.methods) !==
            JSON.stringify(runtime.methods)
          ) {
            errors.push(
              `Netlify Function ${entry.file} runtime methods ${JSON.stringify(runtime.methods)} do not match source ${JSON.stringify(sourceMethods.methods)}.`,
            );
          }
          if (sourceMethods.methodEnforcement !== runtime.methodEnforcement) {
            errors.push(
              `Netlify Function ${entry.file} method enforcement ${runtime.methodEnforcement} does not match source ${sourceMethods.methodEnforcement}.`,
            );
          }
        } else if (runtime?.kind === "schedule") {
          const configuredSchedule = source.match(/\bschedule:\s*"([^"]+)"/)?.[1];
          if (configuredSchedule !== runtime.schedule) {
            errors.push(
              `Netlify Function ${entry.file} schedule ${runtime.schedule} does not match source ${configuredSchedule}.`,
            );
          }
        }

        const directSupportModules = sortStrings(
          [
            ...source.matchAll(
              /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](\.[^"']+)["']/g,
            ),
          ]
            .map((match) =>
              path.posix.normalize(
                path.posix.join(path.posix.dirname(entry.file), match[1]),
              ),
            )
            .filter((filePath) =>
              (discovered.netlifySupportModules ?? []).includes(filePath),
            ),
        );
        if (
          JSON.stringify(directSupportModules) !==
          JSON.stringify(supportModules)
        ) {
          errors.push(
            `Netlify Function ${entry.file} supportModules do not match direct source imports.`,
          );
        }

        if (
          trust?.productionGate === "published-netlify-context" &&
          !source.includes("isPublishedProductionDeployContext")
        ) {
          errors.push(
            `Netlify Function ${entry.file} claims a production gate absent from source.`,
          );
        }
        if (
          trust?.productionGate === "none" &&
          source.includes("isPublishedProductionDeployContext")
        ) {
          errors.push(
            `Netlify Function ${entry.file} production-gate metadata contradicts source.`,
          );
        }
        const authenticationAnchors = {
          "external-verifier-api-key": ["verifyVerifierRequest"],
          "netlify-scheduled-invocation": ["schedule:"],
          "nowpayments-hmac": [
            'headers.get("x-nowpayments-sig")',
            "verifyNowpaymentsIpn",
          ],
          "supabase-bearer": ['headers.get("authorization")'],
        };
        if (
          trust?.authentication &&
          !sourceContainsEvery(
            source,
            authenticationAnchors[trust.authentication] ?? [],
          )
        ) {
          errors.push(
            `Netlify Function ${entry.file} authentication metadata is not supported by source.`,
          );
        }

        const authorizationAnchors = {
          "active-admin-profile": ["is_admin", "is_frozen"],
          "active-non-admin-profile": ["is_admin", "is_frozen"],
          "active-non-admin-profile-and-fund-pin": [
            "is_admin",
            "is_frozen",
            "verify_fund_password_tx",
          ],
          "active-profile": ["is_frozen"],
          "active-profile-and-deposit-enablement": [
            "is_frozen",
            "deposits_paused",
            "configRow.enabled",
          ],
          "database-authoritative-admin-rpc": ["approve_deposit_tx"],
          none: [],
          "provider-payment-refetch": [
            "getPaymentDetails",
            "verifiedPayment.providerPaymentId !== providerPaymentId",
          ],
          "verifier-key-holder": ["verifyVerifierRequest"],
        };
        if (
          trust?.authorization &&
          !sourceContainsEvery(
            source,
            authorizationAnchors[trust.authorization] ?? [],
          )
        ) {
          errors.push(
            `Netlify Function ${entry.file} authorization metadata is not supported by source.`,
          );
        }
      }
    }
    const pinnedTrustFiles = Object.keys(
      ownershipBaseline.netlifyTrustContracts ?? {},
    );
    const discoveredFunctionFiles = discovered.netlifyFunctions ?? [];
    for (const filePath of discoveredFunctionFiles) {
      if (!pinnedTrustFiles.includes(filePath)) {
        errors.push(
          `Netlify Function ${filePath} lacks a pinned trust contract.`,
        );
      }
    }
    for (const filePath of pinnedTrustFiles) {
      if (!discoveredFunctionFiles.includes(filePath)) {
        errors.push(`Stale pinned Netlify trust contract ${filePath}.`);
      }
    }
  }

  const liveOnlyResources = registry.knownLiveOnlyResources;
  if (!Array.isArray(liveOnlyResources)) {
    errors.push("knownLiveOnlyResources must be an array.");
  } else {
    const resources = liveOnlyResources.map((entry) => entry?.resource);
    if (
      JSON.stringify(resources) !==
      JSON.stringify(sortStrings(resources.filter((value) => typeof value === "string")))
    ) {
      errors.push("knownLiveOnlyResources must be sorted by resource.");
    }
    if (new Set(resources).size !== resources.length) {
      errors.push("knownLiveOnlyResources cannot contain duplicate resources.");
    }
    const expectedLiveOnly = new Set(
      ownershipBaseline.knownLiveOnlyResources,
    );
    const actualLiveOnly = new Set(
      resources.filter((value) => typeof value === "string"),
    );
    for (const resource of expectedLiveOnly) {
      if (!actualLiveOnly.has(resource)) {
        errors.push(`Missing pinned live-only resource ${resource}.`);
      }
    }
    for (const resource of actualLiveOnly) {
      if (!expectedLiveOnly.has(resource)) {
        errors.push(`Unpinned live-only resource ${resource}.`);
      }
    }
    for (const entry of liveOnlyResources) {
      const allowedFields = [
        "owner",
        "remediation",
        "resource",
        "status",
      ];
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        JSON.stringify(sortStrings(Object.keys(entry))) !==
          JSON.stringify(allowedFields)
      ) {
        errors.push(
          `Invalid known live-only resource entry ${JSON.stringify(entry?.resource)}.`,
        );
        continue;
      }
      if (
        typeof entry.resource !== "string" ||
        !domainIds.has(entry.owner) ||
        !liveOnlyStatuses.has(entry.status) ||
        typeof entry.remediation !== "string" ||
        entry.remediation.trim() === ""
      ) {
        errors.push(
          `Invalid known live-only resource entry ${JSON.stringify(entry?.resource)}.`,
        );
      }
      const registeredOwners = [
        ...(registrations.supabaseFunctions.get(entry.resource) ?? []),
        ...(registrations.supabaseInternalFunctions.get(entry.resource) ?? []),
        ...(registrations.supabaseTables.get(entry.resource) ?? []),
      ];
      if (
        registeredOwners.length !== 1 ||
        registeredOwners[0] !== entry.owner
      ) {
        errors.push(
          `Live-only resource ${entry.resource} owner ${entry.owner} does not match its canonical Supabase owner.`,
        );
      }
    }
  }

  const repositoryInventory = new Set(discovered.repositoryInventory ?? []);
  const fileCategoryOwners = new Map();
  for (const kind of ownershipFileAssetKinds) {
    for (const filePath of discovered[kind] ?? []) {
      const categories = fileCategoryOwners.get(filePath) ?? [];
      categories.push(kind);
      fileCategoryOwners.set(filePath, categories);
    }
  }
  for (const filePath of repositoryInventory) {
    const categories = fileCategoryOwners.get(filePath) ?? [];
    if (categories.length === 0) {
      errors.push(`Repository file ${filePath} has no ownership asset category.`);
    } else if (categories.length > 1) {
      errors.push(
        `Repository file ${filePath} belongs to multiple ownership asset categories: ${categories.join(", ")}.`,
      );
    }
    if (
      /^tests\/.+\/.+\.test\.mjs$/.test(filePath) &&
      !(discovered.tests ?? []).includes(filePath)
    ) {
      errors.push(
        `Nested test ${filePath} is not runnable by the canonical top-level test manifest.`,
      );
    }
  }
  for (const [filePath] of fileCategoryOwners) {
    if (!repositoryInventory.has(filePath)) {
      errors.push(
        `Ownership asset ${filePath} is not in the Git tracked/unignored inventory.`,
      );
    }
  }

  for (const kind of ownershipAssetKinds) {
    const expected = new Set(discovered[kind] ?? []);
    const actual = registrations[kind];
    for (const value of expected) {
      const owners = actual.get(value) ?? [];
      if (owners.length === 0) errors.push(`Missing ${kind} owner for ${value}.`);
      if (owners.length > 1) {
        errors.push(`Duplicate ${kind} owners for ${value}: ${owners.join(", ")}.`);
      }
    }
    for (const [value] of actual) {
      if (!expected.has(value)) errors.push(`Stale ${kind} registration ${value}.`);
      if (
        ![
          "supabaseFunctions",
          "supabaseInternalFunctions",
          "supabaseTables",
        ].includes(kind) &&
        !fs.existsSync(path.join(checkRoot, value))
      ) {
        errors.push(`Registered ${kind} path does not exist: ${value}.`);
      }
    }
  }
  const expectedFunctions = new Set(discovered.netlifyFunctions ?? []);
  for (const value of expectedFunctions) {
    const owners = registrations.netlifyFunctions.get(value) ?? [];
    if (owners.length === 0) {
      errors.push(`Missing Netlify Function registry entry for ${value}.`);
    } else if (owners.length > 1) {
      errors.push(
        `Duplicate Netlify Function registry entries for ${value}: ${owners.join(", ")}.`,
      );
    }
  }
  for (const [value] of registrations.netlifyFunctions) {
    if (!expectedFunctions.has(value)) {
      errors.push(`Stale Netlify Function registry entry ${value}.`);
    }
  }

  return sortStrings(errors);
}

function checkOwnership() {
  const registry = JSON.parse(fs.readFileSync(ownershipRegistryPath, "utf8"));
  const discovered = discoverOwnershipAssets(root);
  const errors = validateOwnershipRegistry({ checkRoot: root, registry, discovered });
  for (const error of errors) fail(error);
  if (errors.length === 0) {
    const domainCount = registry.domains.length;
    const assetCount =
      ownershipAssetKinds.reduce(
        (total, kind) => total + (discovered[kind]?.length ?? 0),
        0,
      ) + discovered.netlifyFunctions.length;
    console.log(
      `Ownership check complete: ${domainCount} domains and ${assetCount} cross-system assets.`,
    );
  }
}

function normalizeSourceImport(importerRelative, specifier) {
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (normalizedSpecifier.startsWith("@/")) {
    return path.posix.normalize(`src/${normalizedSpecifier.slice(2)}`);
  }
  if (normalizedSpecifier.startsWith(".")) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(importerRelative), normalizedSpecifier),
    );
  }
  if (normalizedSpecifier.startsWith("src/")) {
    return path.posix.normalize(normalizedSpecifier);
  }
  return null;
}

function isDomainServerModule(fileRelative) {
  return /^src\/domains\/[^/]+\/server(?:\/|\.|$)/.test(fileRelative);
}

function isServerSourceModule(fileRelative) {
  return (
    fileRelative.startsWith("src/lib/server/") ||
    isDomainServerModule(fileRelative)
  );
}

function analyzeSourceBoundaries({
  sourceModules,
  allowedServerBridgeImports,
}) {
  const staticImportPattern =
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportPattern =
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const forbiddenClientFragments = [
    "supabase-admin",
    "/db/",
    "netlify/functions",
    "supabase/migrations",
  ];
  const errors = [];
  let serverBridgeImports = 0;

  for (const { fileRelative, source } of sourceModules) {
    if (
      fileRelative === "src/routeTree.gen.ts" ||
      fileRelative === "src/lib/database.generated.ts"
    ) {
      continue;
    }
    const isServerModule = isServerSourceModule(fileRelative);
    const isRouteModule = fileRelative.startsWith("src/routes/");

    const importMatches = [
      ...source.matchAll(staticImportPattern),
      ...source.matchAll(dynamicImportPattern),
    ];
    for (const match of importMatches) {
      const specifier = match[1].replaceAll("\\", "/");
      const normalizedSpecifier = specifier.toLowerCase();
      const importedSource = normalizeSourceImport(fileRelative, specifier);

      if (
        !isServerModule &&
        forbiddenClientFragments.some((fragment) =>
          normalizedSpecifier.includes(fragment),
        )
      ) {
        errors.push(
          `${fileRelative} imports forbidden client dependency ${specifier}.`,
        );
      }

      if (
        !isServerModule &&
        importedSource &&
        isDomainServerModule(importedSource)
      ) {
        errors.push(
          `${fileRelative} imports domain server-only module ${specifier}.`,
        );
      }

      if (
        !isServerModule &&
        importedSource?.startsWith("src/lib/server/")
      ) {
        serverBridgeImports += 1;
      }

      if (
        !isRouteModule &&
        specifier.startsWith(".") &&
        importedSource?.startsWith("src/routes/")
      ) {
        errors.push(
          `${fileRelative} introduces a reverse dependency into routes.`,
        );
      }
    }

    if (
      !isServerModule &&
      /SUPABASE_SERVICE_ROLE_KEY|NOWPAYMENTS_(?:API|IPN)_KEY/.test(source)
    ) {
      errors.push(`${fileRelative} references a server-only secret name.`);
    }
  }

  if (serverBridgeImports > allowedServerBridgeImports) {
    errors.push(
      `Server bridge imports increased from ${allowedServerBridgeImports} to ${serverBridgeImports}.`,
    );
  }

  return {
    errors: sortStrings(errors),
    serverBridgeImports,
  };
}

function checkBoundaries() {
  const sourceFiles = walk(path.join(root, "src"), (filePath) =>
    /\.(?:ts|tsx|mts)$/.test(filePath),
  );
  const sourceModules = sourceFiles.map((filePath) => ({
    fileRelative: relative(filePath),
    source: fs.readFileSync(filePath, "utf8"),
  }));
  const sourceBoundaryResult = analyzeSourceBoundaries({
    sourceModules,
    allowedServerBridgeImports: baseline.boundaries.serverBridgeImports,
  });
  for (const error of sourceBoundaryResult.errors) fail(error);

  const functionDirectory = path.join(root, "netlify", "functions");
  const entrypoints = fs
    .readdirSync(functionDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mts"))
    .map((entry) => entry.name)
    .sort();
  const netlifyConfig = JSON.parse(
    fs.readFileSync(path.join(root, "tsconfig.netlify.json"), "utf8"),
  );
  if (
    !netlifyConfig.include?.includes("netlify/functions/**/*") ||
    netlifyConfig.compilerOptions?.allowJs !== true ||
    netlifyConfig.compilerOptions?.checkJs !== true
  ) {
    fail(
      "tsconfig.netlify.json must type-check every supported Netlify Function source extension.",
    );
  }

  console.log(
    `Boundary check complete: ${entrypoints.length} Function entrypoints; ${sourceBoundaryResult.serverBridgeImports} existing createServerFn bridge imports.`,
  );
}

function thresholdFor(fileRelative) {
  if (fileRelative.startsWith("src/routes/")) return 150;
  if (fileRelative.startsWith("src/components/")) return 300;
  if (
    /^src\/domains\/[^/]+\/ui\/.*\.tsx$/.test(fileRelative)
    || /^src\/domains\/[^/]+\/ui\/(?:[^/]+\/)*use[^/]*\.ts$/.test(fileRelative)
  ) {
    return 300;
  }
  if (
    /^src\/domains\/[^/]+\/(?:application|domain|infrastructure|server|ui)\//.test(
      fileRelative,
    )
  ) {
    return 400;
  }
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
    ownership: checkOwnership,
  };

  if (!commands[mode]) {
    console.error(
      "Usage: node scripts/check-engineering-baseline.mjs <boundaries|complexity|docs|ownership>",
    );
    process.exit(2);
  }

  commands[mode]();
}

export {
  analyzeSourceBoundaries,
  checkBoundaries,
  checkComplexity,
  checkDocs,
  checkOwnership,
  classifyOwnershipFileAssets,
  collectComplexityWarnings,
  discoverOwnershipAssets,
  extractNetlifyMethodContract,
  listRepositoryFiles,
  parseNetlifyFunctionsDirectory,
  thresholdFor,
  validateOwnershipRegistry,
};
