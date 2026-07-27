import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { collectDatabaseTypesBaseline } from "./database-types-baseline-lib.mjs";

const root = process.cwd();
const baselinePath = path.join(
  root,
  "scripts",
  "database-types-baseline.json",
);
const expected = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const actual = collectDatabaseTypesBaseline(root, expected);

if (!isDeepStrictEqual(actual, expected)) {
  console.error(
    "Database type or migration provenance drifted. Regenerate the live Supabase type snapshot deliberately, then run npm run update:database-types-baseline.",
  );
  process.exit(1);
}

console.log(
  `Database provenance verified: ${actual.generatedSnapshot.tables.length} live tables, ${actual.generatedSnapshot.functions.length} live functions, ${actual.migrations.length} migrations, and ${actual.compatibilityGaps.tables.length + actual.compatibilityGaps.functions.length} recorded compatibility gaps.`,
);
