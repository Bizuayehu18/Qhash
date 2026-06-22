import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const migrationsRoot = path.join(repoRoot, "netlify", "database", "migrations");
const migrationsTable = "public._qhash_migrations";
const advisoryLockKey = "qhash_netlify_database_migrations";

function isEnabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findMigrationFiles(dir) {
  if (!(await pathExists(dir))) return [];

  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const migrationPath = path.join(fullPath, "migration.sql");
      if (await pathExists(migrationPath)) files.push(migrationPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".sql")) files.push(fullPath);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function getMigrationId(filePath) {
  return path.relative(migrationsRoot, filePath).replaceAll(path.sep, "/");
}

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists public._qhash_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function applyMigration(client, migration) {
  const { id, checksum, sql } = migration;

  await client.query("begin");
  try {
    const existing = await client.query(
      `select checksum from ${migrationsTable} where id = $1 for update`,
      [id],
    );

    if (existing.rowCount > 0) {
      const recordedChecksum = existing.rows[0].checksum;
      if (recordedChecksum !== checksum) {
        throw new Error(
          `Migration ${id} was already applied with a different checksum. Do not edit applied migrations; create a new migration instead.`,
        );
      }

      await client.query("commit");
      console.log(`✓ skipped ${id}`);
      return;
    }

    console.log(`→ applying ${id}`);
    await client.query(sql);
    await client.query(
      `insert into ${migrationsTable} (id, checksum) values ($1, $2)`,
      [id, checksum],
    );
    await client.query("commit");
    console.log(`✓ applied ${id}`);
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

async function main() {
  if (!isEnabled(process.env.APPLY_DB_MIGRATIONS)) {
    console.log("QHash DB migrations skipped: APPLY_DB_MIGRATIONS is not true.");
    return;
  }

  const netlifyContext = process.env.CONTEXT;
  if (netlifyContext && netlifyContext !== "production") {
    console.log(`QHash DB migrations skipped: Netlify CONTEXT=${netlifyContext}.`);
    return;
  }

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is required when APPLY_DB_MIGRATIONS=true.");
  }

  const migrationFiles = await findMigrationFiles(migrationsRoot);
  if (migrationFiles.length === 0) {
    console.log("QHash DB migrations: no migration files found.");
    return;
  }

  const migrations = await Promise.all(
    migrationFiles.map(async (filePath) => {
      const sql = await readFile(filePath, "utf8");
      return {
        id: getMigrationId(filePath),
        checksum: sha256(sql),
        sql,
      };
    }),
  );

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  console.log(`QHash DB migrations: checking ${migrations.length} migration(s).`);

  await client.connect();
  try {
    await ensureMigrationsTable(client);
    await client.query("select pg_advisory_lock(hashtext($1))", [advisoryLockKey]);

    try {
      for (const migration of migrations) {
        await applyMigration(client, migration);
      }
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [advisoryLockKey]);
    }
  } finally {
    await client.end();
  }

  console.log("QHash DB migrations complete.");
}

main().catch((err) => {
  console.error("QHash DB migrations failed:");
  console.error(err);
  process.exit(1);
});
