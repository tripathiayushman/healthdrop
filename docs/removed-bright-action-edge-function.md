# `bright-action` — removed 2026-08-02 (DEL-14)

An ACTIVE Supabase Edge Function, deployed 2026-03-27 (v4), that existed only on
the server. Deleted from the project on 2026-08-02. Its source is kept here so
the removal is reversible and so NEW-04 can reuse the idea without archaeology.

## Why it went

- **Nothing called it.** A repo-wide grep for `bright-action` returned only
  documentation and one code *comment*; zero call sites in `App.tsx`,
  `components/`, `lib/`, `src/` or `supabase/`.
- **It held the service-role key.** It built a client with
  `SUPABASE_SERVICE_ROLE_KEY`, so it ran with RLS entirely bypassed. Its
  `verify_jwt: true` only proves a valid *project* JWT — and the anon key ships
  inside every published APK, so any holder of the APK could reach it. A
  service-role endpoint that nothing uses is pure attack surface.
- **Its duplicate rule would have been wrong anyway.** "Any report of the same
  `disease_name` in the same `district` within 10 minutes is a duplicate" would
  reject two genuine reports from different villages in one district minutes
  apart — exactly what happens at the start of an outbreak, which is the moment
  the system must not drop a report.

## What replaces it

Nothing, yet. NEW-04 (near-duplicate guard) is a **rewrite**, not a revival: the
useful part is the shape of the question ("was this already reported nearby,
recently?"), which needs distance and time thresholds and a human confirmation
step rather than a silent 409. The client-side cluster hint already in
`DiseaseReportForm` (`nearbyRecentReports`) is the better starting point.

Separately, the duplicate-report risk that actually mattered — a resend after a
lost response filing the same report twice — was fixed on 2026-08-02 by making
`client_idempotency_key` caller-supplied and stable across a draft restore. That
is a different problem from near-duplicate detection and is already closed.

## Source as deployed (v4, verbatim)

```ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

serve(async (req) => {
  const body = await req.json();

  const {
    disease_name,
    district,
    latitude,
    longitude,
    cases_count,
    deaths_count
  } = body;

  // -------------------------
  // 1. Coordinate Validation
  // -------------------------
  if (latitude < -90 || latitude > 90) {
    return new Response(JSON.stringify({ error: "Invalid latitude" }), { status: 400 });
  }

  if (longitude < -180 || longitude > 180) {
    return new Response(JSON.stringify({ error: "Invalid longitude" }), { status: 400 });
  }

  // -------------------------
  // 2. Case Validation
  // -------------------------
  if (cases_count <= 0) {
    return new Response(JSON.stringify({ error: "Cases must be > 0" }), { status: 400 });
  }

  if (deaths_count > cases_count) {
    return new Response(JSON.stringify({ error: "Deaths cannot exceed cases" }), { status: 400 });
  }

  // -------------------------
  // 3. Duplicate Detection
  // -------------------------
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  const { data } = await supabase
    .from("disease_reports")
    .select("id")
    .eq("disease_name", disease_name)
    .eq("district", district)
    .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  if (data && data.length > 0) {
    return new Response(JSON.stringify({ error: "Duplicate report detected" }), { status: 409 });
  }

  // -------------------------
  // PASS VALIDATION
  // -------------------------
  return new Response(JSON.stringify({ success: true }), { status: 200 });
});
```

Note the unpinned imports (`deno.land/std` and `esm.sh/@supabase/supabase-js`
with no version): the deployed behaviour could change under it without any
change here. The two functions that remain — `openrouter-proxy` and
`push-notifications` — and `delete-account`, recovered in the same pass, all pin
`@supabase/supabase-js@2`.
