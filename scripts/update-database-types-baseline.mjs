import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { collectDatabaseTypesBaseline } from "./database-types-baseline-lib.mjs";

const root = process.cwd();
const baselinePath = path.join(
  root,
  "scripts",
  "database-types-baseline.json",
);
const existing = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
  : {};
const baseline = collectDatabaseTypesBaseline(root, {
  ...existing,
  generatedAt: new Date().toISOString(),
});

fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(
  `Updated ${path.relative(root, baselinePath)} for ${baseline.migrations.length} migrations.`,
);
