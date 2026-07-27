import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const expectedNode = fs
  .readFileSync(path.join(root, ".nvmrc"), "utf8")
  .trim();
const expectedNpm = packageJson.packageManager?.replace(/^npm@/, "");
const failures = [];

if (process.versions.node !== expectedNode) {
  failures.push(
    `Node ${expectedNode} is required; running ${process.versions.node}.`,
  );
}

if (packageJson.engines?.node !== expectedNode) {
  failures.push("package.json engines.node must match .nvmrc exactly.");
}

if (packageJson.engines?.npm !== expectedNpm) {
  failures.push("package.json engines.npm must match packageManager exactly.");
}

const nodeVersionFile = fs
  .readFileSync(path.join(root, ".node-version"), "utf8")
  .trim();
if (nodeVersionFile !== expectedNode) {
  failures.push(".node-version must match .nvmrc exactly.");
}

const npmUserAgent = process.env.npm_config_user_agent ?? "";
if (!npmUserAgent.startsWith(`npm/${expectedNpm} `)) {
  failures.push(
    `npm ${expectedNpm} is required; run this command through the pinned npm toolchain.`,
  );
}

if (failures.length > 0) {
  console.error("Toolchain verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Toolchain verified: Node ${expectedNode}, npm ${expectedNpm}.`);
