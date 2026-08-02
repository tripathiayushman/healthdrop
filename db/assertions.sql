-- =====================================================================
-- HealthDrop — database assertion suite
-- =====================================================================
--
-- WHAT THIS IS
--   A single, idempotent, READ-ONLY script. It touches no data and no
--   schema: every statement below reads system catalogues only. Running
--   it a hundred times leaves the database byte-identical.
--
-- WHY IT EXISTS
--   Every security and correctness claim in this project that was
--   "verified by reading" later turned out to be wrong. docs/REFINEMENT_PLAN.md
--   §8 Phase 0 makes the point plainly: SEC-01, SEC-02, SEC-03, SEC-12,
--   BRK-02 and BRK-06 are all *mechanically* detectable, and BRK-08 — a
--   cron job — failed 960 times without anyone noticing. Assertions that
--   execute are the only durable defence.
--
-- HOW IT REPORTS
--   Each violated invariant emits one WARNING per offending object,
--   naming the object, so the output says WHAT is wrong, not just that
--   something is. Passing invariants emit a NOTICE. At the end the script
--   RAISEs an exception whose message and DETAIL carry the per-invariant
--   counts, so a caller that only sees the error still learns everything.
--
-- HOW TO RUN
--   node scripts/check-db.cjs          (preferred — see db/README.md)
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f db/assertions.sql
--
-- HOW TO ADD AN INVARIANT / AN EXCEPTION
--   See db/README.md. Short version: copy an existing `-- ── A<n> ──`
--   block, and never widen a detection query to make it pass — put the
--   intentional exception in the matching allowlist below, with a reason.
--
-- =====================================================================

DO $assertions$
DECLARE
  r            record;
  v_n          integer;                 -- violations for the current invariant
  v_total      integer := 0;            -- violations overall
  v_summary    text[]  := ARRAY[]::text[];
  v_checked    integer := 0;

  -- ── The six roles. The single source of truth is types/index.ts:10
  --    (`Profile['role']`). Nothing in the database may reference a role
  --    string outside this list. BRK-06 is exactly what happens when it does.
  k_roles CONSTANT text[] := ARRAY[
    'super_admin','health_admin','clinic','asha_worker','volunteer','district_officer'
  ];

  -- ── ALLOWLIST A1: SECURITY DEFINER routines that anon is *intended* to
  --    be able to EXECUTE. Format: 'name(identity_args)'.
  --    Currently EMPTY, deliberately. The SEC-01 fix is a blanket
  --    `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon,
  --    authenticated` followed by re-GRANTing only what the client calls;
  --    when that lands, add each re-granted routine here with the reason
  --    it is safe for an unauthenticated caller. Routines owned by an
  --    extension (PostGIS et al.) are excluded structurally — we do not
  --    control their grants.
  k_secdef_anon_allow CONSTANT text[] := ARRAY[]::text[];

  -- ── ALLOWLIST A2: SECURITY DEFINER routines allowed to run without a
  --    pinned search_path. There is no good reason for one; keep empty.
  k_searchpath_allow CONSTANT text[] := ARRAY[]::text[];

  -- ── ALLOWLIST A3: 'object|literal' pairs where a non-Profile role string
  --    is intentional. Empty: every hit today is BRK-06 dead scaffolding.
  k_role_literal_allow CONSTANT text[] := ARRAY[]::text[];

  -- ── ALLOWLIST A4: 'table.column' permitted to carry >1 CHECK constraint.
  --    Empty. Three contradicting CHECKs on water_quality_reports.overall_quality
  --    (BRK-02) are why this invariant exists; there is no legitimate case
  --    where two independent CHECKs on one column are clearer than one.
  k_multi_check_allow CONSTANT text[] := ARRAY[]::text[];

  -- ── ALLOWLIST A5: foreign-key constraint names that may go unindexed.
  --    Empty for now. REF-06 argues only some of the 19 need covering
  --    indexes; when the owner decides which, list the rest here with the
  --    reason (e.g. "write-only column, never joined or cascaded on").
  k_fk_index_allow CONSTANT text[] := ARRAY[]::text[];

  -- ── ALLOWLIST A6: tables in `public` permitted to run without RLS.
  --    Extension-owned tables (PostGIS `spatial_ref_sys`) are excluded
  --    structurally, so this stays empty.
  k_rls_exempt CONSTANT text[] := ARRAY[]::text[];
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== HealthDrop DB assertions — % ===', now();
  RAISE NOTICE '';

  -- ═══════════════════════════════════════════════════════════════════
  -- A1 — No SECURITY DEFINER routine in `public` is EXECUTE-able by anon.
  --      Catches: SEC-01 (create_admin_user), SEC-02 (notify_users_push),
  --               SEC-03 (the geo RPCs), SEC-12 (update_push_outbox_status).
  --      A SECURITY DEFINER routine runs as its owner, so every RLS policy
  --      on every table it touches is bypassed. Granting EXECUTE to `anon`
  --      publishes that bypass to anyone holding the APK's publishable key.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
           pg_get_function_result(p.oid) AS ret,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_too
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e' AND d.classid = 'pg_proc'::regclass
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND d.objid IS NULL                                    -- not extension-owned
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') = ANY (k_secdef_anon_allow)
    ORDER BY 1
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A1  anon has EXECUTE on SECURITY DEFINER public.%  [returns %; authenticated=%]',
      r.sig, r.ret, r.auth_too;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A1 anon-EXECUTE on SECURITY DEFINER routine: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A1  no SECURITY DEFINER routine in public is EXECUTE-able by anon';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A2 — Every SECURITY DEFINER routine pins its search_path.
  --      Without `SET search_path`, a caller can prepend a schema they
  --      control and have the definer-privileged body resolve `profiles`
  --      to their own table. Same class as SEC-01: privilege escalation
  --      through a routine that was only meant to be a helper.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e' AND d.classid = 'pg_proc'::regclass
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND d.objid IS NULL
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                      WHERE c LIKE 'search\_path=%')
      AND NOT (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') = ANY (k_searchpath_allow)
    ORDER BY 1
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A2  SECURITY DEFINER public.% has no pinned search_path', r.sig;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A2 SECURITY DEFINER without pinned search_path: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A2  every SECURITY DEFINER routine pins its search_path';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A3 — No RLS policy and no routine body compares a role against a
  --      string outside Profile['role'].
  --      Catches: BRK-06. Zero profiles hold role='admin', yet policies on
  --      outbreaks, audit_logs, outbreak_thresholds, campaigns, user_feedback,
  --      notification_logs and campaign_volunteers still gate on it — so the
  --      national roles are blind to the outbreak table this product exists
  --      to fill, and `resolve_outbreak` refuses them.
  --      Matches `<anything>role[()] = | <> | != | IN | = ANY (ARRAY[…])`,
  --      so it covers `profiles.role`, `get_my_role()`, `v_caller_role`,
  --      `p_target_role` and `target_role` in one pass.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    WITH src AS (
      SELECT 'policy'  AS kind,
             c.relname || ' :: ' || pol.polname AS obj,
             coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
             coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS body
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'routine',
             p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             p.prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e' AND d.classid = 'pg_proc'::regclass
      WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') AND d.objid IS NULL
    ),
    hits AS (
      SELECT s.kind, s.obj, m[1] AS arr, m[2] AS inlist, m[3] AS lit
      FROM src s
      CROSS JOIN LATERAL regexp_matches(
        s.body,
        $re$[a-z_.]*role(?:\(\))?\s*(?:=|<>|!=|(?:not\s+)?in)\s*(?:any\s*)?(?:\(\s*array\s*\[([^\]]*)\]|\(([^)]*)\)|'([a-z_]+)')$re$,
        'gi') m
    ),
    lits AS (
      SELECT kind, obj, lit FROM hits WHERE lit IS NOT NULL
      UNION ALL
      SELECT kind, obj, (regexp_matches(arr,    $re$'([a-z_]+)'$re$, 'g'))[1] FROM hits WHERE arr    IS NOT NULL
      UNION ALL
      SELECT kind, obj, (regexp_matches(inlist, $re$'([a-z_]+)'$re$, 'g'))[1] FROM hits WHERE inlist IS NOT NULL
    )
    SELECT kind, obj, lit, count(*)::int AS n
    FROM lits
    WHERE NOT lit = ANY (k_roles)
      AND NOT (obj || '|' || lit) = ANY (k_role_literal_allow)
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A3  % % compares a role against ''%'' (x%) — not one of the six in Profile[''role'']',
      r.kind, r.obj, r.lit, r.n;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A3 role literal outside Profile[''role'']: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A3  no policy or routine references a role outside Profile[''role'']';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A4 — No column carries more than one CHECK constraint.
  --      Catches: BRK-02. Three CHECKs shipped on
  --      water_quality_reports.overall_quality; their intersection is
  --      {moderate, unsafe}, so an ASHA worker reporting a handpump "Safe"
  --      — the most common outcome there is — gets a raw 23514 and loses
  --      the submission. Multiple CHECKs on one column AND together and
  --      nobody ever reads all of them.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col, count(*)::int AS n,
           string_agg(con.conname, ', ' ORDER BY con.conname) AS names,
           string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n           '
                      ORDER BY con.conname) AS defs
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(con.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE con.contype = 'c'
      AND n.nspname = 'public'
      AND array_length(con.conkey, 1) = 1                     -- single-column CHECKs only
    GROUP BY 1, 2
    HAVING count(*) > 1
       AND NOT (c.relname || '.' || a.attname) = ANY (k_multi_check_allow)
    ORDER BY 3 DESC, 1, 2
  LOOP
    v_n := v_n + 1;
    RAISE WARNING E'FAIL A4  %.% carries % CHECK constraints (%)\n           %',
      r.tbl, r.col, r.n, r.names, r.defs;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A4 column with >1 CHECK constraint: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A4  no column carries more than one CHECK constraint';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A5 — Every foreign-key column has a supporting index.
  --      REF-06: the performance advisor reports 19 unindexed FKs. An
  --      unindexed FK makes every join and every cascading delete a
  --      sequential scan. Cheap insurance to take before the pilot loads
  --      data, and free to check.
  --      "Supporting" = an index whose leading columns are exactly the FK
  --      columns, in any order.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    WITH fk AS (
      SELECT con.conname, c.relname, con.conkey, con.conrelid
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'public'
    )
    SELECT fk.relname AS tbl, fk.conname,
           (SELECT string_agg(a.attname, ', ' ORDER BY ord)
              FROM unnest(fk.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = k.attnum) AS cols
    FROM fk
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = fk.conrelid
        AND (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] @> fk.conkey
        AND fk.conkey @> (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1]
    )
      AND NOT fk.conname = ANY (k_fk_index_allow)
    ORDER BY 1, 2
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A5  foreign key %.% (%) has no supporting index', r.tbl, r.conname, r.cols;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A5 foreign key without supporting index: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A5  every foreign key has a supporting index';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A6 — RLS is enabled on every table in `public`.
  --      A table without RLS is readable and writable by every role that
  --      holds the table grant — and `authenticated` holds them all here.
  --      Extension-owned tables are excluded: we do not control PostGIS.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    SELECT c.relname AS tbl,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_read,
           has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_read
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e' AND d.classid = 'pg_class'::regclass
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
      AND d.objid IS NULL
      AND NOT c.relname = ANY (k_rls_exempt)
    ORDER BY 1
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A6  RLS is DISABLED on public.%  [anon SELECT=%, authenticated SELECT=%]',
      r.tbl, r.anon_read, r.auth_read;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A6 table without RLS: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A6  RLS is enabled on every table in public';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A7 — No policy is unconditionally true for a write command.
  --      Permissive policies OR together, so one `USING (true)` on
  --      INSERT/UPDATE/DELETE/ALL silences every other rule on the table
  --      (REF-01: `disease_reports` carries nine policies, `health_campaigns`
  --      fourteen — security is decided by the loosest). A write policy that
  --      is literally `true` grants every authenticated user the table.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    SELECT c.relname AS tbl, pol.polname,
           CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                           WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END AS cmd,
           CASE WHEN coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') = 'true'
                THEN 'USING (true)' ELSE '' END ||
           CASE WHEN coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') = 'true'
                THEN ' WITH CHECK (true)' ELSE '' END AS what
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pol.polpermissive
      AND pol.polcmd IN ('a', 'w', 'd', '*')
      AND (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') = 'true'
        OR coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') = 'true')
    ORDER BY 1, 2
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A7  write policy %.% (%) is unconditional: %', r.tbl, r.polname, r.cmd, r.what;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A7 unconditional write policy: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A7  no write policy is unconditionally true';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A8/A9 — the client-write manifest.
  --
  --   Derived by grepping the app for `.from('<table>').<insert|update|
  --   upsert|delete>` across lib/, components/, src/ and App.tsx. When a
  --   new write lands in the client, add its row here — that is the whole
  --   maintenance burden.
  --
  --   `cmds`      : 'a'=INSERT, 'w'=UPDATE, 'd'=DELETE, as pg_policy.polcmd.
  --   `owner_col` : the column that must equal auth.uid() on INSERT, or
  --                 NULL where the table has no per-user author (see note).
  -- ═══════════════════════════════════════════════════════════════════

  -- ── A8 — every write the client performs is actually permitted.
  --      A write with no matching permissive policy, or no table GRANT, does
  --      not error loudly — PostgREST returns 200 and zero rows changed. That
  --      is the exact shape of BRK-01, where every UPDATE on disease_reports
  --      was silently discarded and the approval queue looked healthy.
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    WITH manifest(tbl, cmds, owner_col, note) AS (VALUES
      ('disease_reports',        ARRAY['a','w','d'], 'reporter_id',  'lib/services/diseaseReports.ts, src/services/offlineSync'),
      ('water_quality_reports',  ARRAY['a','w','d'], 'reporter_id',  'lib/services/waterQuality.ts'),
      ('health_alerts',          ARRAY['a'],         'created_by',   'components/forms/AlertForm.tsx'),
      ('health_campaigns',       ARRAY['a','w','d'], 'organizer_id', 'lib/services/campaigns.ts, components/forms/CampaignForm.tsx'),
      ('campaign_participants',  ARRAY['a','w'],     'user_id',      'components/screens/CampaignsScreen.tsx'),
      ('campaign_volunteers',    ARRAY['a','d'],     'volunteer_id', 'lib/services/campaigns.ts (enrol / unenrol)'),
      ('profiles',               ARRAY['a','w'],     'id',           'components/AuthScreen.tsx, lib/services/users.ts'),
      ('user_feedback',          ARRAY['a','w'],     'user_id',      'components/screens/ProfileScreen.tsx'),
      ('app_events',             ARRAY['a'],         'user_id',      'lib/services/analytics.ts'),
      ('alert_acknowledgements', ARRAY['a'],         'user_id',      'lib/services/alertAcks.ts (upsert ignoreDuplicates => ON CONFLICT DO NOTHING, no UPDATE needed)'),
      ('user_push_tokens',       ARRAY['d'],         'user_id',      'lib/services/users.ts'),
      -- owner_col NULL: no per-user author column. Writes are gated by role,
      -- not ownership, so A9 does not apply.
      ('notifications',          ARRAY['a','w','d'], NULL,           'lib/services/notifications.ts — user_id is the RECIPIENT, not the author; INSERT is role-gated'),
      ('role_invitations',       ARRAY['a','d'],     NULL,           'lib/services/provisioning.ts — admin-managed'),
      ('water_sources',          ARRAY['w'],         NULL,           'lib/services/waterSources.ts — official-managed registry'),
      ('outbreaks',              ARRAY['w'],         NULL,           'lib/services/outbreaks.ts — official-managed')
    ),
    want AS (SELECT tbl, unnest(cmds) AS cmd, note FROM manifest)
    SELECT w.tbl,
           CASE w.cmd WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END AS cmd,
           w.note,
           (SELECT count(*) FROM pg_policy pol
              JOIN pg_class c2 ON c2.oid = pol.polrelid
              JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
             WHERE n2.nspname = 'public' AND c2.relname = w.tbl
               AND pol.polpermissive AND pol.polcmd IN (w.cmd, '*')) AS policies,
           to_regclass('public.' || quote_ident(w.tbl)) IS NOT NULL AS tbl_exists,
           coalesce(has_table_privilege('authenticated', to_regclass('public.' || quote_ident(w.tbl)),
                    CASE w.cmd WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END), false) AS granted
    FROM want w
    ORDER BY 1, 2
  LOOP
    IF NOT r.tbl_exists THEN
      v_n := v_n + 1;
      RAISE WARNING 'FAIL A8  client writes (%) to public.% but the table does not exist — the manifest has drifted  [%]',
        r.cmd, r.tbl, r.note;
    ELSIF r.policies = 0 OR NOT r.granted THEN
      v_n := v_n + 1;
      RAISE WARNING 'FAIL A8  client performs % on public.% but %  [%]',
        r.cmd, r.tbl,
        CASE WHEN r.policies = 0 AND NOT r.granted THEN 'no permissive policy and no GRANT exist'
             WHEN r.policies = 0 THEN 'no permissive RLS policy allows it (write silently affects 0 rows)'
             ELSE 'authenticated lacks the table GRANT' END,
        r.note;
    END IF;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A8 client write with no policy/grant: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A8  every write the client performs has a permissive policy and a grant';
  END IF;

  -- ── A9 — owner-scoping: every INSERT policy on a client-written table
  --      binds that table's owner column to auth.uid().
  --      Without the binding a user forges authorship: they file a report,
  --      an alert or a campaign under someone else's name. It matters more
  --      than it looks, because `alerts_select` grants read access on
  --      `created_by = auth.uid()` and the approval screens attribute work
  --      by the same column. Permissive policies OR, so ONE unbound INSERT
  --      policy defeats every bound one on the same table.
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    WITH manifest(tbl, owner_col) AS (VALUES
      ('disease_reports','reporter_id'), ('water_quality_reports','reporter_id'),
      ('health_alerts','created_by'),    ('health_campaigns','organizer_id'),
      ('campaign_participants','user_id'),('campaign_volunteers','volunteer_id'),
      ('profiles','id'),                 ('user_feedback','user_id'),
      ('app_events','user_id'),          ('alert_acknowledgements','user_id'),
      ('user_push_tokens','user_id')
    )
    SELECT m.tbl, m.owner_col, pol.polname,
           CASE pol.polcmd WHEN 'a' THEN 'INSERT' ELSE 'ALL' END AS cmd
    FROM manifest m
    JOIN pg_class c ON c.relname = m.tbl
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_policy pol ON pol.polrelid = c.oid AND pol.polpermissive AND pol.polcmd IN ('a', '*')
    WHERE coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') !~*
          ( '(^|[^.[:alnum:]_])' || m.owner_col
            || '[[:>:]][[:space:]]*=[[:space:]]*\(?[[:space:]]*(select[[:space:]]+)?auth\.uid\(\)'
            || '|auth\.uid\(\)([[:space:]]+as[[:space:]]+uid)?[[:space:]]*\)?[[:space:]]*=[[:space:]]*'
            || '[^.[:alnum:]_]?' || m.owner_col || '[[:>:]]' )
    ORDER BY 1, 3
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A9  % policy "%" (%) never binds %.% to auth.uid() — authorship is forgeable',
      r.tbl, r.polname, r.cmd, r.tbl, r.owner_col;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A9 INSERT policy without owner binding: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A9  every INSERT policy on a client-written table binds its owner column';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A10 — No materialized view in `public` is readable by anon or authenticated.
  --      Catches: SEC-13. Materialized views NEVER enforce RLS, whatever
  --      relrowsecurity says, so a SELECT grant on one is an unconditional
  --      grant. `mv_campaign_effectiveness` hands every logged-in volunteer
  --      the campaign aggregates for every district, bypassing the district
  --      scoping the equivalent view enforces.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    SELECT c.relname AS mv,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_read,
           has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_read
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e' AND d.classid = 'pg_class'::regclass
    WHERE n.nspname = 'public' AND c.relkind = 'm' AND d.objid IS NULL
      AND (has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT'))
    ORDER BY 1
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A10 materialized view public.% is SELECT-able [anon=%, authenticated=%] — MVs never enforce RLS',
      r.mv, r.anon_read, r.auth_read;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A10 API-readable materialized view: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A10 no materialized view is readable by anon or authenticated';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- A11 — No table is readable without a session.
  --      Catches: SEC-15 (`campaigns` is anon-readable; readiness #3 wrongly
  --      claims a fix). A permissive SELECT policy that applies to PUBLIC or
  --      `anon` and whose qual never mentions the caller — no auth.uid(),
  --      no auth.jwt(), no get_my_role()/get_my_district() — is reachable by
  --      anyone holding the APK's publishable key.
  --
  --      KNOWN LIMIT, stated rather than hidden: a qual that mentions
  --      auth.uid() in one OR-branch and is identity-free in another (that is
  --      `alerts_select`, SEC-03) passes this check. Detecting it needs
  --      expression-tree analysis; splitting the printed qual on " OR " gives
  --      false positives on nested EXISTS. SEC-03 is tracked in the plan and
  --      by the anon-key probe, not here.
  -- ═══════════════════════════════════════════════════════════════════
  v_checked := v_checked + 1;
  v_n := 0;
  FOR r IN
    SELECT c.relname AS tbl, pol.polname,
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true') AS qual
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pol.polpermissive
      AND pol.polcmd IN ('r', '*')
      AND (0 = ANY (pol.polroles)                                   -- granted to PUBLIC
        OR EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.oid = ANY (pol.polroles) AND ro.rolname = 'anon'))
      AND has_table_privilege('anon', c.oid, 'SELECT')
      AND coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true') !~*
          $re$(auth\.uid\(\)|auth\.jwt\(\)|auth\.role\(\)|get_my_role\(\)|get_my_district\(\))$re$
    ORDER BY 1, 2
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'FAIL A11 public.% is anon-readable via policy "%" — qual never references the caller: %',
      r.tbl, r.polname, r.qual;
  END LOOP;
  IF v_n > 0 THEN
    v_total := v_total + v_n;
    v_summary := v_summary || format('A11 anon-readable table: %s', v_n);
  ELSE
    RAISE NOTICE 'PASS A11 no table is readable without a session';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- Verdict
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  IF v_total = 0 THEN
    RAISE NOTICE 'ALL CLEAR — % invariants checked, 0 violations.', v_checked;
  ELSE
    RAISE EXCEPTION 'DB ASSERTIONS FAILED: % violation(s) across % of % invariants',
      v_total, array_length(v_summary, 1), v_checked
      USING DETAIL = array_to_string(v_summary, E'\n           '),
            HINT   = 'Each violation is named on a WARNING line above. '
                     'Do not weaken a detection query to make it pass — '
                     'either fix the database or record the exception in the '
                     'matching allowlist in db/assertions.sql, with a reason.';
  END IF;
END
$assertions$;
