# db/migrations

Human-readable records of migrations that were applied live to the Supabase
project, kept so the schema is reproducible from source rather than only from
the running database.

These are **records, not a migration runner**. Each file is idempotent and safe
to re-run, but nothing replays them automatically — they were applied via the
Supabase MCP `apply_migration` and are written down here so the reasoning
survives.

## Why not `database_structure/`?

`database_structure/` is **gitignored** (`.gitignore:73`, "All SQL migration
files (may contain DB references / secrets)"). That rule exists for the legacy
folder of historical dumps, and it is a reasonable default — but it means
`git add database_structure/anything.sql` silently does nothing, and the commit
that "recorded" a migration can contain no migration at all. That happened once
already: the Phase 1 security record was written, added, and committed, and the
file was never in the tree.

Anything under `db/` is tracked. New migration records go here, and each one
must be free of connection strings, keys and passwords — the ignore rule was
protecting against those, so this folder has to earn the exemption. Check
before committing:

```sh
grep -niE "sb_(secret|publishable)|eyJ[A-Za-z0-9_-]{20,}|postgres://|password *= *['\"]" db/migrations/*.sql
```

## What is here

| File | What it changed |
|---|---|
| `2026-08-02_PHASE1_SECURITY.sql` | Revoked anon `EXECUTE` on privileged routines; dropped `create_admin_user`; locked default privileges. Documents which routines must **keep** `EXECUTE` (the RLS helpers) and why revoking them locks every user out of every table. |
| `2026-08-02_PHASE2_MISSION_LOOP.sql` | Four silent write failures: discarded officer approvals, a column that did not exist, three contradicting water CHECKs, and unsafe-water alerts that notified nobody. Plus a cron job that had failed 961 times and a missing DELETE policy. |

## Verifying a migration

Structural checks are not enough. A structural check of the unsafe-water
notification passed — the function existed, the trigger was attached — while
the feature was completely broken, because every insert violated a CHECK and
was swallowed by the function's own exception handler.

Verify **behaviourally**: perform the user's action, then re-read the row and
assert the change is actually there. Two traps worth knowing:

- `disease_reports` has an auto-approve trigger that sets `approval_status` on
  INSERT from the reporter's role. A test that inserts as an officer and then
  "approves" changes nothing and passes meaninglessly. Move the row to a value
  *different* from whatever the trigger left, and assert on a free-text field
  too.
- A `BEFORE UPDATE` trigger that returns `OLD` cancels the write, and PostgREST
  still answers 200. Success from the API is not evidence the row changed.

`db/assertions.sql` runs the standing invariants; `npm run check:db` is the
wrapper.
