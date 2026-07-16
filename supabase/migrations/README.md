# Supabase migrations

This directory is the source of truth for QHash's Supabase schema. Production
deploys apply migrations from here with `scripts/apply-migrations.mjs`.

- Never edit, rename, or delete an applied migration. Add a later corrective
  migration instead.
- Keep legacy subdirectory names and `migration.sql` files unchanged because
  their relative paths and checksums are recorded in `public._qhash_migrations`.
- Do not place Supabase migrations in `netlify/database/migrations`. Netlify
  reserves that directory and automatically applies its contents to the
  separate Netlify Database used by the Drizzle integration.
