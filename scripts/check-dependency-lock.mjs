import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const failures = [];

if (lock.lockfileVersion !== 3) {
  failures.push(`Expected lockfileVersion 3, found ${lock.lockfileVersion}.`);
}

const rootLock = lock.packages?.[""];
if (!rootLock) {
  failures.push("package-lock.json has no root package entry.");
} else {
  for (const dependencyKind of ["dependencies", "devDependencies"]) {
    const manifestDependencies = packageJson[dependencyKind] ?? {};
    const lockDependencies = rootLock[dependencyKind] ?? {};
    if (JSON.stringify(manifestDependencies) !== JSON.stringify(lockDependencies)) {
      failures.push(
        `${dependencyKind} differ between package.json and package-lock.json.`,
      );
    }
  }

  if (rootLock.engines?.node !== packageJson.engines?.node) {
    failures.push("Root lock engines.node does not match package.json.");
  }
}

const packagePaths = new Set(Object.keys(lock.packages ?? {}));
const packageNames = new Set(
  [...packagePaths]
    .filter((packagePath) => packagePath.includes("node_modules/"))
    .map((packagePath) => packagePath.split("node_modules/").at(-1)),
);
const missingOptionalTargets = [];
let optionalEdges = 0;

for (const [packagePath, packageEntry] of Object.entries(lock.packages ?? {})) {
  for (const dependencyName of Object.keys(
    packageEntry.optionalDependencies ?? {},
  )) {
    optionalEdges += 1;
    if (!packageNames.has(dependencyName)) {
      missingOptionalTargets.push(`${packagePath || "<root>"} -> ${dependencyName}`);
    }
  }
}

if (missingOptionalTargets.length > 0) {
  failures.push(
    `The lockfile omits ${missingOptionalTargets.length} optional dependency target(s):\n` +
      missingOptionalTargets.map((item) => `  ${item}`).join("\n"),
  );
}

if (failures.length > 0) {
  console.error("Dependency lock verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Dependency lock verified: ${packagePaths.size} package entries and ${optionalEdges} optional edges.`,
);
