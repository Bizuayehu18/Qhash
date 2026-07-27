import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const GENERATED_TYPES_PATH = "src/lib/database.generated.ts";
const COMPATIBILITY_TYPES_PATH = "src/lib/database.types.ts";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readUtf8(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sectionBody(source, section, nextSection) {
  const startMatch = new RegExp(`^    ${section}:`, "m").exec(source);
  if (!startMatch) {
    throw new Error(`Database type file has no ${section} section.`);
  }

  const remaining = source.slice(startMatch.index + startMatch[0].length);
  const endMatch = new RegExp(`^    ${nextSection}:`, "m").exec(remaining);
  if (!endMatch) {
    throw new Error(
      `Database type file has no ${nextSection} section after ${section}.`,
    );
  }

  return remaining.slice(0, endMatch.index);
}

function sectionKeys(source, section, nextSection) {
  const body = sectionBody(source, section, nextSection);
  return [...body.matchAll(/^      ([A-Za-z0-9_]+):\s*(?:\{|\()/gm)]
    .map((match) => match[1])
    .sort();
}

function inventoryMigrations(root) {
  const migrationsRoot = path.join(root, "supabase", "migrations");
  return fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith(".sql")) {
        return [`supabase/migrations/${entry.name}`];
      }
      if (entry.isDirectory()) {
        const relativePath = `supabase/migrations/${entry.name}/migration.sql`;
        if (fs.existsSync(path.join(root, relativePath))) return [relativePath];
      }
      return [];
    })
    .map((relativePath) => ({
      path: relativePath,
      sha256: sha256(readUtf8(root, relativePath)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function collectDatabaseTypesBaseline(root, existing = {}) {
  const generated = readUtf8(root, GENERATED_TYPES_PATH);
  const compatibility = readUtf8(root, COMPATIBILITY_TYPES_PATH);
  const generatedTables = sectionKeys(generated, "Tables", "Views");
  const generatedFunctions = sectionKeys(generated, "Functions", "Enums");
  const compatibilityTables = sectionKeys(compatibility, "Tables", "Views");
  const compatibilityFunctions = sectionKeys(
    compatibility,
    "Functions",
    "Enums",
  );

  return {
    projectRef: "wsgxmvmkibliccsktiqj",
    generatedAt: existing.generatedAt ?? new Date().toISOString(),
    generatedSnapshot: {
      path: GENERATED_TYPES_PATH,
      sha256: sha256(generated),
      tables: generatedTables,
      functions: generatedFunctions,
    },
    compatibilitySnapshot: {
      path: COMPATIBILITY_TYPES_PATH,
      sha256: sha256(compatibility),
      tables: compatibilityTables,
      functions: compatibilityFunctions,
    },
    compatibilityGaps: {
      tables: difference(generatedTables, compatibilityTables),
      functions: difference(generatedFunctions, compatibilityFunctions),
    },
    migrations: inventoryMigrations(root),
  };
}

export { collectDatabaseTypesBaseline };
