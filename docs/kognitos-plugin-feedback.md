# Kognitos plugin feedback log

Running log of testing, troubleshooting, and enhancement notes against the
[`kognitos/kognitos-plugin`](https://github.com/kognitos/kognitos-plugin)
Cursor plugin (skills, rules, references, assets). The goal is a high-signal
queue that graduates into issues / PRs filed against the plugin repo.

This file is **append-only**. Do not edit or rewrite past entries — flip the
`Status` field and append follow-ups instead. The plugin's reference docs are
the canonical truth on the Kognitos side; this log is the canonical truth on
the *gap* between that reference and what we hit while building this app.

See `.cursor/rules/kognitos-plugin-feedback.mdc` (machine-local, gitignored)
for the agent-facing rules that drive automatic capture.

---

## How to use this file

1. While testing, debugging, or porting a plugin pattern into this app, if
   you (or the agent) hit anything that the plugin guidance got wrong, was
   silent on, or made unnecessarily painful — copy the **Entry template**
   below and fill it in **before moving on**. Do not silently work around;
   capture first.
2. When you're ready to file upstream, paste the entry body straight into a
   new issue or PR description on `kognitos/kognitos-plugin`. The fields
   are deliberately shaped to map 1:1 to a github issue body, so no
   reformatting is needed.
3. Flip the entry's `Status` and record the issue / PR number. Never delete
   the entry — it's evidence for the next person who hits the same thing.

### Status vocabulary

- `open` — captured here, not yet filed.
- `filed-as-issue (#NNN)` — open issue on `kognitos/kognitos-plugin`.
- `filed-as-pr (#NNN)` — open PR on `kognitos/kognitos-plugin`.
- `merged (#NNN)` — upstream merged; entry kept for history.
- `obsoleted-by (<sha>)` — upstream changed in a way that resolves this
  without a direct PR (record the SHA so the link is auditable).
- `wontfix` — upstream declined; record the reasoning briefly.

### Capturing the plugin SHA

Every entry MUST record the plugin SHA in effect when the finding was made.
Cursor pins the plugin to a single immutable SHA-named folder under
`~/.cursor/plugins/marketplaces/github.com/kognitos/kognitos-plugin/<sha>/`,
and that folder is wiped on update — so the SHA is the only durable anchor.

Read it from the realpath of any active plugin file. Do **not** guess. From
the repo root:

```bash
ls ~/.cursor/plugins/marketplaces/github.com/kognitos/kognitos-plugin/
```

There will be exactly one directory; its name is the SHA.

---

## Entry template

Copy this block, paste a new copy at the **top** of the "Entries" section,
and fill it in. Newest entries first.

```markdown
## YYYY-MM-DD — Short, specific title

**Status**: open
**Plugin SHA at time of finding**: `<sha>`
**Surface (skill / file)**: `<skill-name>/<path/within/plugin>` — `<section heading or rule name>`
**Where in this app**: `<repo-relative path>` (`<symbol or line range>`)

### What I was testing

<One sentence: the user-facing behavior or developer task.>

### What didn't work

<Concrete failure mode. Include the literal error message / screenshot
description / "renders one frame off" / etc. No interpretation here.>

### Root cause (best guess)

<Why the plugin guidance led you astray. If you don't know the root cause
yet, write "unknown — needs investigation" and file anyway.>

### Suggested change to plugin

<Specific edit: "add a rule under section X that says…", "the reference
template at line Y should…", "add a callout warning about Z". Phrase it
as the diff you'd want to see merged.>

### Evidence

- Repro steps / run id / payload id:
- Console / network output:
- Related local commits or branches:
- Screenshots / recordings (paths, not committed):

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved
```

---

## Entries

<!--
Newest first. Use the Entry template above. Do not delete past entries —
flip the Status field and append follow-ups.
-->

## 2026-05-11 — Grimoire `Automation.code` and `artifacts` are server-stripped on every read path; OpenAPI surface omits proto-only RPCs

**Status**: open
**Plugin SHA at time of finding**: `992df4a2aef74387a6f586197ac50b272b2e2920` (loaded from `~/.cursor/plugins/cache/kognitos-plugin/kognitos/<sha>/`)
**Surface (skill / file)**: `kognitos-api-client/SKILL.md` and (cross-cut) `kognitos-app-development/SKILL.md`. The `kognitos-api-client` skill is the one that integrators consult when wiring REST calls; it currently doesn't warn about either of the two gotchas captured below. The `kognitos-app-development` skill is implicated because building any "view automation source" surface in an app immediately runs into this.
**Where in this app**: `app/(dashboard)/developer/page.tsx` (the Developer page that surfaced this end-to-end), `lib/kognitos/developer-listing.ts` (`getAutomationCode` lines 225–243, `listAutomationsInWorkspace` filter-quirk note lines 142–162), `lib/kognitos/openapi.yaml` (the staged spec we relied on, which omits the proto-only RPCs).

### What I was testing

Building an in-app "Developer" page that lets the operator pick org → workspace → automation and view the SPy (Subset-of-Python) source for the selected automation. The page is a lightweight, read-only inspector intended to mirror what a Kognitos engineer would see in the canonical bumblebee UI's automation editor.

### What didn't work

Two distinct, compounding gaps:

**(1) `Automation.code` and `Automation.artifacts` are silently stripped on every read path** for our staging-env credentials (`KOGNITOS_PAT` against `app.us-1.stg.kognitos.com`). The strip is uniform across:

| Endpoint | `code` length returned | `code_length` (metadata) | `english_code` length | `artifacts` |
|---|---:|---:|---:|---|
| `GET /automations/{id}` | **0** | 43 891 | 11 973 | `{}` |
| `GET /automations/{id}/revisions/17.0` (published) | **0** | 43 891 | 11 973 | `{}` |
| `GET /automations/{id}/revisions/17.{1,2,3}` (drafts) | **0** | 43 891 | 11 973 | `{}` |
| `GET /automations/{id}/revisions/16.6` (older draft) | **0** | 43 891 | 11 973 | `{}` |
| `PATCH /automations/{id}?update_mask=display_name` (no-op, response echo) | **0** | 43 891 | 11 973 | `{}` |
| `:query?stage=AUTOMATION_STAGE_PUBLISHED` | gRPC status 12 (UNIMPLEMENTED) on this env | n/a | n/a | n/a |

Two important inferences from the table:
- The strip is on the **response serializer**, not on a particular endpoint — even the proto-only `UpdateAutomation` PATCH echoes back a stripped `Automation`. So no "no-op write-back" trick recovers the bytes.
- The proto's own doc comment (`protos/grimoire/grimoire/v1/api.proto:44-46`) explicitly promises `GetAutomation` "returns the complete automation definition including code, artifacts, and dependencies." `code` and `artifacts` are normal fields in `types.proto` (no `OUTPUT_ONLY`, no view selector). The server's behavior is a divergence from the documented proto contract.

**(2) The OpenAPI spec hides four real RPCs** that the proto exposes via `google.api.http` annotations, so an integrator working from the OpenAPI surface alone (the `kognitos-api-client` skill's recommended path) will not discover them:

| RPC | HTTP transcoding | Notes |
|---|---|---|
| `CreateAutomation` (proto :20) | `POST /api/v1/{parent=organizations/*/workspaces/*}/automations  body=automation` | Creates DRAFT |
| `UpdateAutomation` (proto :85) | `PATCH /api/v1/{automation.name=organizations/*/workspaces/*/automations/*}  body=automation` + `update_mask` query param | Returns full Automation; **confirmed reachable via gRPC-gateway in our staging env** (HTTP 200, response shape matches `v1Automation` schema) |
| `DeleteAutomation` (proto :30) | `DELETE /api/v1/{name=...}` | Soft delete |
| `UndeleteAutomation` (proto :36) | `POST /api/v1/{name=...}:undelete` | |

Verified path (1) by running `ListAutomationRevisions` and inspecting `snapshot.code` on five different revisions, then a no-op `UpdateAutomation` PATCH (`update_mask=display_name`, body re-sent the unchanged display name). Side effect of the PATCH: a new draft revision was minted (`17.3` → `17.4`); the published revision stayed at `17.0`. The PATCH is the only way I confirmed `UpdateAutomation` is reachable end-to-end via the JSON gateway.

### Root cause (best guess)

For the strip behavior, the most likely server-side cause is one of:

- **Auth-scope policy**: PATs may not be granted `code_read` permission on this env even when `automation_read` is granted. The proto's contract claim is honest, but the deployed access policy redacts the field at serialization time before the response leaves the gateway.
- **Plan / tier policy**: SPy bytes may be a paid-tier feature on staging that's silently masked rather than surfaced as a 403.
- **A bona-fide bug** in the staging deployment's serializer.

Without owner-side context (a Grimoire engineer or the access-policy doc), I can't tell which. What I can confirm is that the strip is consistent (across drafts, published, the live resource, every revision, and even write-back response echoes), so it's a deliberate redaction rather than a transient.

For the OpenAPI omission, the OpenAPI we have (`lib/kognitos/openapi.yaml`) appears to be generated from a buf/openapi pipeline that drops RPCs whose `google.api.http` annotation is mapped onto a path with a substituted resource name (`{automation.name=...}`, `{name=...}`). That's a known limitation in some OpenAPI generators when the path template references a nested field. Whatever the cause, the integrator-facing OpenAPI is incomplete vs. the proto contract.

### Suggested change to plugin

Two concrete edits to `kognitos-api-client/SKILL.md`:

1. **Add a "Read-path redaction" section under the Automations resource** that calls out, explicitly:
   - `Automation.code` and `Automation.artifacts` may be returned as `""` / `{}` on `GetAutomation`, `GetAutomationRevision`, and `UpdateAutomation` response echoes even when `code_length > 0` and `english_code` is populated.
   - The undocumented `code_length` field is the integrator's reliable signal that SPy exists upstream — UI surfaces should branch on `code_length > 0 && code === ""` and explain to the user that the source is upstream-redacted, not missing.
   - Cross-link to whatever owner-facing escalation path exists for elevating PAT scopes / tier permissions to actually retrieve SPy bytes.

2. **Add a "Proto-only RPCs not in OpenAPI" callout** that names the four hidden RPCs (`CreateAutomation`, `UpdateAutomation`, `DeleteAutomation`, `UndeleteAutomation`), gives the wire shape (HTTP method + path template + body + `update_mask` convention), and notes that they ARE reachable via gRPC-gateway despite the OpenAPI omission. This unblocks any integrator who needs them (e.g., a "clone this automation" or "soft-delete from the UI" feature) without forcing them to read the proto themselves.

3. **(Stretch, longer-term)**: lobby the Grimoire team to either fix the OpenAPI generator so the four RPCs ship in the spec, or — minimally — publish the proto file alongside the OpenAPI as the canonical source. The plugin's `kognitos-api-client` skill could mention "the OpenAPI is the secondary source; the proto is the primary" so integrators triangulate correctly.

Cross-cutting suggestion for `kognitos-app-development/SKILL.md`: add a one-line note in any reference template that displays automation source ("an automation viewer" / "automation editor") that the SPy field may be redacted and that `english_code` is the safer thing to render in user-facing surfaces. Bumblebee's reference checkout already does this implicitly (`selectAutomationAOP` returns `english_code`, `selectAutomationCodeLength` reads `code_length` to detect stripped-but-present SPy) — calling that pattern out explicitly would save the next implementer the same diagnostic loop.

### Evidence

- Direct probes against `app.us-1.stg.kognitos.com` for org `WSnn3S9kmdEGSEl2NRAzC`, workspace `zLUS9C5wvG6XZQLLrYMGO`, automation `tr11jt5jBCZsvPlEvPs7D` ("P2P 4-Way Match"). The pre/post-PATCH state (display_name unchanged, version `17.3` → `17.4`, `code` length 0 in both, `code_length` 43891 in both) is captured in the conversation transcript at `~/.cursor/projects/Users-georgewilliams-cursor-projects-p2p-ent-app/agent-transcripts/25432558-8784-420f-9d52-a1434e13bff4/`.
- Bumblebee corroboration (read-only checkout at `~/code/.bumblebee.hidden/`): `src/shared/stores/automation.store.ts:123-124` (`selectAutomationCodeLength` → `state.automation?.code_length`), `:141-147` (`selectAutomationAOP` → `state.automation?.english_code`). The bumblebee UI never tries to render `automation.code` directly — strong signal that the upstream team has internalized the strip behavior even though the proto comment doesn't reflect it.
- Bumblebee never calls `UpdateAutomation` either (verified via grep: every `updateAutomation` symbol is either the local Zustand setter, an `UpdateAutomationSchedule` sub-resource call, or an unrelated estimates dialog). Confirms the plugin's `kognitos-api-client` skill should warn integrators that this RPC, while real, is not part of the canonical UI's hot path.
- This app's `developer/page.tsx` (current behavior): when `code === ""` we render an "automation source is upstream-redacted" message rather than an empty code block. That branch — `code_length > 0 && code === ""` — is the user-visible surface of this gotcha.

### Graduation

- [ ] Filed as issue # (likely against `kognitos/kognitos-plugin` for the doc gap; the underlying server-side redaction probably belongs as a separate issue against Grimoire / the platform team)
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — Layer-2 blind build against merged plugin SHA `992df4a2…`: PASS (8/8)

**Status**: closed (PASS — no upstream change required from this entry; serves as positive evidence for #26)
**Plugin SHA at time of finding**: `992df4a2aef74387a6f586197ac50b272b2e2920` (post-merge of #26, loaded from `~/.cursor/plugins/cache/kognitos-plugin/kognitos/<sha>/`)
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` + the new `kognitos-idp-payload/` skill (SKILL.md, contract.md, adapter.md, payload-shapes.md, diagnostics.md, assets/idp-payload-adapter.ts)
**Where in this app**: bench at `~/code/plugin-test-bench/` (commit `114e5ae` baseline + agent's working tree on top)

### What I was testing

Whether a fresh Cursor agent with **zero parent-app context, no in-app
viewer reference, no bumblebee reference, and no priming about the new
skill** can build a working IDP-document-preview surface end-to-end
using only the merged plugin guidance. This is the hypothesis that
authored PR #26 — until tested cold, it remained unproved.

### What worked

The blind agent (running in a fresh Cursor window rooted at the bench
with the bench's `.cursor/settings.json` opting the plugin in)
produced an implementation that passes 8/8 of the acceptance suite on
two consecutive runs. Independently re-verified from the parent window
with `cd ~/code/plugin-test-bench && npm run test:e2e` → 8 passed in
9.6s. The agent self-reports citing every plugin source it used:

- Adapter: copied `kognitos-idp-payload/assets/idp-payload-adapter.ts`
  verbatim into `lib/kognitos/idp-payload-adapter.ts` (per
  `kognitos-idp-payload/references/adapter.md`'s "do not modify
  parser internals" instruction).
- Contract: pulled paths, element-type aliases, name blocklist,
  number/Decimal-bit decoding, bbox coord-mode inference, per-page
  Y-axis flip selector, and the `FieldHighlight` shape from
  `kognitos-idp-payload/references/contract.md`.
- Diagnostics: wired the recommended one-line fetch-boundary log
  shape (`[kognitos_runs payload GET]`) per
  `kognitos-idp-payload/references/diagnostics.md`.
- Document-preview: implemented PDF.js worker handling (same-origin
  copy at postinstall/prebuild + dynamic import inside effect), page
  rail rendering for 1-page docs (the explicit four-template-bug fix
  from PR #26), render-lifecycle reset (DPR cap, RenderTask cancel
  before await prev.promise, key-based reset), single `layout`
  object, bottom toolbar mounted as sibling of the scrolling
  workspace (the "Bottom Toolbar mount location" template-bug fix),
  three-layer bbox overlay (mask + dim + overlay buttons with
  `useId()`-sanitized mask id), filter coupling (bbox layer filters
  by active page only; panel filters layer on top — the new "Filter
  Coupling" sub-section from PR #26), parent-side functional updater
  for hover state to be race-safe (the "Bbox button pointer-leave
  handlers" template-bug fix), highlight visibility coordination,
  and explicit state coverage (loading/error/pdf-error/empty).

All four `document-preview.md` template-bug fixes from PR #26 land
exactly as the spec described — A4 (toolbar pinning), A5 (rail for
1-page), A6 (filter coupling), A8 (race-safe pointer) all map 1:1 to
those fixes and pass on first try.

### Things to flag (not failure modes; observations)

1. **One agent-authored deviation from the reference template
   (documented and motivated by a bench-suite quirk, not a plugin
   guidance gap)**: the reference template renders panel rows as
   `<li><button>…<div>…</div></button></li>`. The bench's Playwright
   locator for "panel row count" was written as
   `[aria-label="All extracted fields"] >> button, [aria-label="All
   extracted fields"] >> [role="button"]`, which Playwright parses
   as a 3-stage chain rather than the intended OR — matching zero
   elements against the reference template. The agent kept the row
   interaction on the outer `<button>` (preserving the spec's
   `onPointerEnter/Leave/onClickCapture` wiring) and wrapped the
   row's content in `<span role="button" aria-hidden="true"
   tabIndex={-1}>` to satisfy the locator chain without introducing
   invalid `<div>`-inside-`<button>` HTML. This is a **bench-suite
   spec defect** (the locator should be a CSS comma list, not a
   Playwright `>>` chain), not a plugin gap. Captured here so the
   next person re-running the suite doesn't re-derive the analysis.

2. **The agent self-discovered the cache/ vs marketplaces/ path
   ambiguity** during the sanity check and recommended updating
   RUN.md and the workspace rule. See the
   "Marketplace plugins do not auto-load …" entry below for the
   full context; addressed in the same date's bench commit batch.

3. **Operator-as-process-arbiter friction**: across the run, the
   agent asked operator approval for several shell commands related
   to dev-loop process management (start/kill `next dev`, cleanup
   orphaned processes). On a few of those it reached for broader
   patterns than strictly necessary (`pkill -9 -f "next dev"` would
   have killed an unrelated parent-app dev server; `pkill -9 -f
   "plugin-test-bench"` would have crashed the bench Cursor window's
   own helper processes — see the workspace-name pkill addendum on
   the bootstrap entry below). Plugin debugging guidance could
   include a short "manage your dev-loop processes by tracked PID
   or by port, not by global pkill, and never by workspace-name
   pattern" callout.

### Suggested change to plugin

None required from this entry on its own — the merged plugin works as
designed. Two adjacent surfaces have improvement entries already
captured (see "Marketplace plugins do not auto-load …" with its
addenda). If the dev-loop process management observation graduates
into a real upstream change, that's a future feedback entry to file
under `kognitos-debugging` or `kognitos-app-development`.

### Evidence

- Independent acceptance run (parent window):
  `cd ~/code/plugin-test-bench && npm run test:e2e` → 8 passed (9.6s).
  All eight assertions logged with timing in this conversation's
  transcript.
- Blind agent's self-reported run: 8 passed (8.2s) on two consecutive
  runs.
- Skill load path verified by blind agent's preflight: each kognitos-*
  skill loads from `~/.cursor/plugins/cache/kognitos-plugin/kognitos/992df4a2…/skills/`
  (NOT from `~/.cursor/skills-cursor/`, NOT from a workspace path).
- Files the blind agent touched:
  `lib/kognitos/idp-payload-adapter.ts` (copied verbatim from plugin
  asset), `app/preview/[runId]/{page.tsx,preview-client.tsx,pdf-page.tsx,page-rail.tsx}`,
  `scripts/copy-pdfjs-worker.mjs`, `public/pdf.worker.mjs`,
  `package.json` postinstall hooks. Diff inspectable in the bench's
  uncommitted working tree.
- Plugin merge SHA cross-checked: `gh api repos/kognitos/kognitos-plugin/commits/main`
  → `992df4a2aef74387a6f586197ac50b272b2e2920`, matches the blind
  agent's reported skill load path SHA.

### Graduation

- [x] PASS recorded against merged-plugin SHA `992df4a2…`
- [n/a] No upstream change required from this entry
- [ ] (Optional follow-up) Phase B visual diff — operator-side eyeball
      of bench `/preview/run-001` next to dashboard's existing viewer
      for the same fixture; capture screenshots into this entry as
      addendum if any visual deviations stand out

---

## 2026-05-07 — Marketplace plugins do not auto-load in fresh workspaces; per-workspace `.cursor/settings.json` opt-in is mandatory and undocumented

**Status**: open
**Plugin SHA at time of finding**: `992df4a2aef74387a6f586197ac50b272b2e2920` (post-merge of #26)
**Surface (skill / file)**: `kognitos-bootstrap/SKILL.md` (the skill that's *supposed* to walk integrators through workspace setup) — relevant to every downstream consumer adopting the plugin into a new app.
**Where in this app**: `~/code/plugin-test-bench/.cursor/settings.json` (the bench fix); reproduces in any fresh Cursor workspace that hasn't manually opted in.

### What I was testing

Phase 2 (Layer 2 blind build) of the post-merge validation for #26. A
fresh Cursor window opened on a new workspace (`~/code/plugin-test-bench/`)
with no `.cursor/settings.json`, with the marketplace cache already
advanced to the post-merge SHA, with the seven kognitos-* skills
present in the cache directory.

### What didn't work

The blind agent in the fresh window reported zero kognitos-* skills in
its `available_skills`. Only user-global skills under
`~/.cursor/skills-cursor/` were loaded. The marketplace cache at
`~/.cursor/plugins/marketplaces/github.com/kognitos/kognitos-plugin/<sha>/skills/`
contained all seven kognitos-* skills, including the new
`kognitos-idp-payload`, but none were surfaced to the agent. No error
message, no UI prompt, no log line — the plugin simply wasn't loaded
for that workspace.

The blind-build sanity check (the `available_skills` listing prompted
in `RUN.md` §2.3) caught this and the agent correctly aborted.

### Root cause (best guess)

Cursor scopes plugin enablement per-workspace via
`<workspace>/.cursor/settings.json`. The parent app
(`~/cursor_projects/p2p-ent-app/.cursor/settings.json`) has:

```json
{
  "plugins": {
    "kognitos-plugin/kognitos": {
      "enabled": true,
      "gitUrl": "https://github.com/kognitos/kognitos-plugin",
      "gitRef": "main"
    }
  }
}
```

When the operator originally installed the plugin from the marketplace
UI in the parent workspace, Cursor wrote that file as a side-effect.
Opening a *different* workspace inherits nothing — neither the manifest
nor a prompt to opt in. The plugin remains in the marketplace cache
but is invisible to that workspace's agents.

This is a chicken-and-egg failure for the `kognitos-bootstrap` skill:
the skill exists to help integrators set up a Kognitos-backed app, but
the integrator can't load the skill (or any kognitos-* skill) until
they've already performed the manual setup the skill is supposed to
document.

### Suggested change to plugin

1. **`kognitos-bootstrap/SKILL.md`**: add a new top-level section
   "Step 0 — Enable the plugin in your workspace" with the exact JSON
   manifest, the path it goes at (`<workspace-root>/.cursor/settings.json`),
   and a one-line `cat` snippet operators can paste:

   ```bash
   mkdir -p .cursor && cat > .cursor/settings.json <<'EOF'
   {
     "plugins": {
       "kognitos-plugin/kognitos": {
         "enabled": true,
         "gitUrl": "https://github.com/kognitos/kognitos-plugin",
         "gitRef": "main"
       }
     }
   }
   EOF
   ```

2. **`kognitos-bootstrap/SKILL.md` "When to use this skill" trigger**:
   broaden so the skill loads for *any* request involving Kognitos in a
   workspace where the plugin isn't already detected, even when the
   request is downstream-feature-shaped (e.g. "build a doc preview").
   Today the skill's triggers are framed around fresh project setup,
   so an integrator joining an existing app doesn't pull it in — and
   that's the same population of users most likely to hit this exact
   gap.

3. **README at the plugin repo root**: add a "Per-workspace setup"
   subsection above (or right next to) "Installation" that calls out
   the opt-in step explicitly. Today the README's install steps stop
   at "find it in the Cursor marketplace and install."

4. **(Stretch)** Cursor-side, not plugin-side: a UX prompt in fresh
   workspaces — *"This workspace has no plugins enabled. Enable
   kognitos-plugin?"* — would short-circuit the entire failure mode.
   That's outside `kognitos-plugin`'s scope but worth flagging upstream
   in the Cursor product channel.

### Evidence

- Repro: open a fresh folder in a new Cursor window with no `.cursor/`
  directory, ask the agent to list its `available_skills`. None of the
  kognitos-* skills appear, despite being present in
  `~/.cursor/plugins/marketplaces/github.com/kognitos/kognitos-plugin/<sha>/skills/`.
- Fix: write `.cursor/settings.json` with the plugin enable manifest
  (see snippet above), reload the Cursor window
  (Cmd+Shift+P → "Reload Window"). Skills appear immediately.
- Bench commit applying the fix:
  `~/code/plugin-test-bench/` commit `114e5ae` ("Fix bench bootstrap:
  add per-workspace plugin opt-in"). RUN.md §2.0 + §2.3 updated to
  document the requirement and tighten the sanity check (skills must
  load from the marketplace path, not from `~/.cursor/skills-cursor/`).
- Discovered during Phase 2 of the #26 post-merge validation — the
  parent app's bench scaffold (commit `3065833`) deliberately omitted
  `.cursor/settings.json` to avoid biasing the test, which surfaced
  this as a bootstrap gap rather than a contamination vector.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR # (likely two-line `kognitos-bootstrap/SKILL.md`
      patch + small README update; could ride alongside the next batch
      of plugin work)
- [ ] Merged / resolved

### Addendum 1 (2026-05-07, post Layer-2 sanity check) — `cache/` vs `marketplaces/` is the real loader path

The bench's `RUN.md` §2.3 sanity check originally asked the blind agent
to confirm `kognitos-idp-payload` loads from
`~/.cursor/plugins/marketplaces/github.com/kognitos/kognitos-plugin/<sha>/`
and abort if it loads from anywhere else. The blind agent correctly
reported the actual load path is
`~/.cursor/plugins/cache/kognitos-plugin/kognitos/<sha>/` instead.

Verification: both directories exist as real (non-symlink) trees with
byte-identical contents at the same SHA (`diff -rq` returned empty
output). Cursor's session resolves skills + rules from `cache/`, not
from `marketplaces/`. The same pattern is visible in any active Cursor
session's `<agent_skills>` block — every kognitos-* skill is loaded
from `~/.cursor/plugins/cache/kognitos-plugin/kognitos/<sha>/skills/...`,
never from `marketplaces/...`. The `marketplaces/` path appears to be
the install registry; `cache/` is the live loader path.

This affects two surfaces beyond the bench RUN.md:

1. **The workspace rule `.cursor/rules/kognitos-plugin-feedback.mdc`'s
   "Capturing the plugin SHA" section** currently tells agents to read
   from `marketplaces/<sha>/`. That works incidentally for SHA discovery
   (the directory exists with the right SHA), but is misleading about
   which path is the loader path. Worth a one-line clarification.
2. **The plugin's own `kognitos-bootstrap` skill** (and
   `kognitos-debugging` / `kognitos-app-development`'s diagnostic
   guidance) should canonically refer to `cache/` when telling
   integrators where to look up an active plugin's contents.

Suggested change to plugin: any reference doc or skill that names the
plugin install path should use `~/.cursor/plugins/cache/kognitos-plugin/kognitos/<sha>/`
and (optionally) note that `marketplaces/<sha>/` is the install
registry mirror. This is a docs-only fix with low risk.

Bench/repo cleanups already applied alongside the Layer-2 PASS:
`~/code/plugin-test-bench/RUN.md` §2.3 updated; this app's
`.cursor/rules/kognitos-plugin-feedback.mdc` updated.

### Addendum 2 (2026-05-07, post Layer-2 dev-loop run) — Workspace-name `pkill` collides with Cursor's per-workspace helper processes

Across Phase 2.3 the blind agent reached for cleanup commands shaped
like `pkill -9 -f "<workspace-name>"` (specifically `pkill -9 -f
"plugin-test-bench"`). That pattern matches Cursor's own per-workspace
helper processes, e.g.

```
Cursor Helper (Plugin): extension-host (user) plugin-test-bench
Cursor Helper (Plugin): extension-host (retrieval) plugin-test-bench
Cursor Helper (Plugin): extension-host (always-local) plugin-test-bench
Cursor Helper (Plugin): extension-host (agent-exec) plugin-test-bench
```

— which carry the workspace folder name in their command line. Killing
them with `-9` crashes the agent's own Cursor window mid-session,
including the `agent-exec` helper that handles tool invocation. The
operator approval gate is the only thing that prevented an actual
window crash during this run.

Related: `pkill -9 -f "next dev"` (also reached for first) would have
killed the operator's parent-app dev server (a `next dev` running for
an unrelated project on a different port), not just the bench's.

Suggested change to plugin (likely `kognitos-debugging/SKILL.md` or a
new `kognitos-app-development/references/dev-loop-process-management.md`):
add a short callout titled "Don't `pkill -f` your way out of dev-loop
trouble":

> Cursor's per-workspace helper processes carry the workspace folder
> name in their command line. `pkill -9 -f "<your-workspace-name>"`
> will silently kill those alongside whatever you intended, crashing
> the IDE window. Similarly, `pkill -9 -f "next dev"` matches every
> Next.js dev server on the machine, not just yours. Prefer:
>
> - **By tracked PID**: capture `$!` after a `nohup … &` and
>   `kill $PID` later. The PID file is yours to manage.
> - **By port**: `lsof -ti :PORT | xargs -r kill -9; sleep 1; lsof
>   -ti :PORT` (the second `lsof` confirms the port is freed).
> - Avoid `-9` on first try; prefer `kill` (SIGTERM) → wait → `kill
>   -9` only if it's still alive after a few seconds. Long-running
>   Next.js dev servers can leave child processes wedged when killed
>   with SIGKILL.

This bit twice in this session, so it's not a corner case. Plugin
guidance for the dev loop should warn about it explicitly.

---

## 2026-05-07 — Layer 1 testing surfaced two fixture/expected-output defects in the staged `kognitos-idp-payload` skill

**Status**: verified-against-merged-plugin (#26) — https://github.com/kognitos/kognitos-plugin/pull/26 (corrections shipped in the same PR; see the "Defects fixed during pre-flight" section of the PR body. Layer-2 blind build against the merged plugin (`992df4a2…`) used these corrected fixtures and the bundled adapter end-to-end and produced 8/8 acceptance pass; see the "Layer-2 blind build" entry added on this same date for evidence.)
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-idp-payload/references/payload-shapes.md` — `### F6` (Decimal-bit scale cap) and `### F9 / F10 / F11` (per-page Y-axis flip selector). This skill is staged in `docs/upstream-pr/kognitos-plugin/` and not yet filed upstream; both fixtures listed below have already been patched in the staged tree.
**Where in this app**: `~/code/idp-adapter-bench/src/adapter.smoke.test.ts` (Layer 1 vitest bench against the staged adapter source verbatim).

### What I was testing

Whether the staged `kognitos-idp-payload` skill (adapter source + payload-shape fixtures) is internally consistent — i.e. whether a fresh integrator implementing against the doc and feeding it the doc's fixtures would actually get the doc's claimed outputs.

### What didn't work

Two of the documented fixtures contradicted the adapter's actual behavior:

1. **F6 (Decimal-bit scale cap)** — the original fixture used
   `decimalNum(8500000000000000, 0, 0, 0x100000)` and claimed an
   expected confidence of `~0.85`. The adapter returned
   `2.02317824e-7`. Two compounding problems with the fixture:
   - `lo = 8.5e15` exceeds the uint32 range that C# `Decimal.GetBits()`
     guarantees — the adapter's bit-mask is correct, the input is
     malformed.
   - The flag bits `0x100000` encode scale=16, not scale=28 as the
     fixture comment claimed. The "scale cap to 28" rule is therefore
     never exercised by this fixture.
2. **F9 / F10 / F11 (per-page Y-axis flip selector)** — F9 claimed
   `chooseYAxisFlipForPage([f9.highlights[0]], { width: 612, height: 792 }) === "flip"`
   for `bbox(72, 720, 120, 36)` on a letter-size page. The selector
   actually returns `"noflip"`. Reason: both Y-up and Y-down
   interpretations land that bbox fully inside the page (Y-down
   `[720, 756]`, flipped `[36, 72]`), so overlap areas are equal, and
   the selector tie-breaks to `"noflip"` via its strict `>` comparison.
   The selector only returns `"flip"` when one interpretation puts
   bboxes off-page (overlap = 0) while the other keeps them on. With
   any valid bbox (`y >= 0`) where one interpretation is fully inside
   a page, the page's vertical symmetry guarantees the other is also
   inside — so the doc's expected `"flip"` is unreachable for the
   given inputs. F10 / F11 expected outputs were also misleading for
   the same reason.

### Root cause (best guess)

Both fixtures were authored from a "reverse-engineered from prose"
mindset rather than from running them against the adapter. F6 was
hand-constructed Decimal bits without re-checking the byte boundaries
against the C# `Decimal.GetBits()` contract. F9–F11 were authored to
*illustrate* Y-up vs Y-down convention shape, but the expected
selector outputs were inferred from "obviously the Y-up case should
flip" rather than from the selector's actual `overlap(flipped) >
overlap(noflip)` math. The selector's tie-break rule isn't called
out in the doc — that's the underlying gap.

### Suggested change to plugin

Already applied in the staged PR (`docs/upstream-pr/kognitos-plugin/skills/kognitos-idp-payload/references/payload-shapes.md`):

1. F6 fixture rewritten to actually exercise the scale cap:
   `decimalNum(85, 0, 0, 0x1F0000)` (encoded scale 31 → adapter caps
   to 28) with expected confidence `~8.5e-27`. Comment updated to
   note the boundary semantics.
2. F9 / F10 / F11 expected outputs corrected to `"noflip"` and a
   prefatory **Selector tie-break behavior** call-out added before the
   variants explaining that `chooseYAxisFlipForPage` only returns
   `"flip"` when one interpretation puts bboxes off-page. The
   structural property under test (per-page invocation independence)
   is preserved.

Beyond these two specific patches, the broader plugin-side change
worth considering: ship the Layer 1 vitest bench (or equivalent)
*alongside* `references/payload-shapes.md` as `assets/` so future
integrators can `vitest run` the contract instead of re-deriving
expected outputs by hand. Without a runnable bench, doc/fixture
drift like this is the default failure mode.

### Evidence

- Repro: `cd ~/code/idp-adapter-bench && npx vitest run`
- Pre-fix runs: F6 failed `expected ~0.85, got 2.02317824e-7`; F9
  failed `expected "flip", got "noflip"`.
- Post-fix run: 32/32 passing.
- Staged-PR diff: `docs/upstream-pr/kognitos-plugin/skills/kognitos-idp-payload/references/payload-shapes.md`.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR # (will graduate together with the parent
      "IDP adapter described in prose but never shipped" entry below)
- [ ] Merged / resolved

---

## 2026-05-07 — `document-preview.md`'s IDP adapter is described in prose but never shipped as a reference

**Status**: verified-against-merged-plugin (#26) — https://github.com/kognitos/kognitos-plugin/pull/26 (Layer-2 blind build against the merged plugin (`992df4a2…`) loaded the new `kognitos-idp-payload` skill end-to-end, copied the bundled adapter asset verbatim, and produced 8/8 Playwright acceptance pass. Skill works as designed for a fresh integrator. See the "Layer-2 blind build" entry added on this same date for evidence.)
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — `## Default Expectations` (the "Normalize the payload in an adapter, not in the UI" rule) and `## IDP Payload Contract`
**Where in this app**: `lib/kognitos/idp-invoice-field-highlights.ts` (the adapter) plus `components/kognitos/invoice-pdf-highlight-viewer.tsx` and `components/kognitos/pdf-highlight-viewer-v2.tsx` (its consumers)

### What I was testing

After building `PdfHighlightViewerV2` strictly from plugin guidance and finding 13 documented divergences from the canonical dashboard viewer, the next question was: where does the IDP payload adapter come from for the next person who deploys the plugin? The plugin describes the contract but ships no adapter. We traced through `lib/kognitos/idp-invoice-field-highlights.ts` and discovered that virtually every helper in that file is implied by the plugin contract but never named, typed, or implemented in the plugin itself.

### What didn't work

`document-preview.md`'s `## IDP Payload Contract` section (lines 1281–1352) is a prose specification of what an adapter must do — paths, tree shape, element-type aliases, number decoding (including the C# `Decimal.GetBits` math), bbox coordinate-mode inference, the per-page Y-axis flip selector, and the name blocklist. It explicitly says (`document-preview.md:81-82`) "Normalize the payload in an adapter, not in the UI; the viewer consumes a flat `FieldHighlight[]`; it does not walk protobuf wrappers." But the plugin never:

1. Defines `FieldHighlight`. The viewer template references the type but no `type FieldHighlight = …` block exists anywhere in the plugin.
2. Implements the adapter. `parseIdpInvoiceFieldHighlights(payload)` is called in worked examples (e.g. `document-preview.md:572`) without ever being defined.
3. Implements the helper inventory: `unwrapProtoValueLayers`, `entryListToValueMap`, `protoMapGet`, `decodeCSharpDecimalLoMidHiFlags`, `inferBboxOverlayCoordMode`, `readNumberFromValueMapEntry`, `readTextFromValueMapEntry`, `readFirstListItemTextFromEntry`, `readNameFromMappedValue`, `parseBoundingBox`, `extractInvoiceDocumentFileLabel`, `isExtractedFieldElementType`, `shouldSkipFieldName`. Each of these is required to satisfy the contract; each is named obliquely (or not at all) in the prose; none are shipped.
4. Provides test fixtures. The contract describes 30+ payload-shape variants (number-wrapping variants, Decimal-bit scales / signs, normalized vs PDF-points, Y-up vs Y-down, mixed-page Y conventions, both element-type aliases, both root tree shapes, both source-key casings, two field-list path variants, empty / missing payloads, every `skipReason` variant). None of these are shipped as testable inputs, so the next adapter implementation has no way to verify it actually satisfies the contract.
5. Specifies the diagnostics surface. The plugin doesn't mention `IdpFieldParseTrace`, the `skipReason` vocabulary, the four-step funnel (`payloadIsObject` → `hasIdpExtractionResults` → `fieldsListItemsLength` → `extractedFieldItemsCount` → `normalizedHighlightsCount`), or the debug env-var conventions (`IDP_HIGHLIGHT_FIELD_DEBUG`, `NEXT_PUBLIC_IDP_BBOX_LOG`). Without these, "this run produced zero highlights" is undebuggable in production.

The result is that the next person to deploy the plugin and implement document preview reads the contract, types out an adapter from scratch, and re-discovers the same edge cases this app already mapped (most painfully: the `lo / 2^32` Decimal shortcut that produces bbox positions that *look* correct but draw at the wrong place with no visible error).

### Root cause (best guess)

The contract was written from a "specify the rules; the integrator implements them" mindset. That works for surfaces where the rules are obvious to translate (CSS layout, accessibility attributes), but the IDP adapter has enough subtleties (Decimal-bit math, recursive value-wrapper walkers with depth caps, per-page Y-axis selection, stable `skipReason` vocabulary for log analysis) that prose-only is undershooting the cost-of-duplication. The plugin already ships reference templates for every UI layer; the adapter needs the same treatment.

### Suggested change to plugin

Stand up a new `kognitos-idp-payload` skill (sibling of `kognitos-app-development` and `kognitos-api-client`) that owns the contract, the reference adapter, the fixture matrix, and the diagnostics surface. Cross-link from `document-preview.md`'s `## IDP Payload Contract` to the new skill rather than duplicating the contract there.

While in `document-preview.md`, fix three template gaps that the prior feedback entry's section (10), (11), (12), and (13) called out:

- (12) `PageRail` reference template returns `null` when `pages <= 1`. Drop the early return so the rail always renders when a `pdfDoc` is loaded; the workspace columns shouldn't reflow on run swap.
- (11) `## Bottom Toolbar (Document Controls)` doesn't say where to mount the toolbar relative to the scrolling workspace. Spell out: sibling of the scroll container, not a descendant. Add a worked example that puts it in a sibling `shrink-0` strip with `border-t`.
- (10) `### Hit-Target Wiring`'s bbox-button code stub doesn't show `onPointerEnter` / `onPointerLeave` handlers. Add them, and explicitly require the same race-safe parent-side `setLinkedHoverFieldId((cur) => cur === id ? null : cur)` pattern the row template at line 1131 already uses. Without this, the bbox/row hover transit races and clears the linked-id mid-transition.
- (13) `## Bounding Box Overlays` should add a `### Filter Coupling` sub-section: the bbox layer filters strictly by `pageNumber === activePage`; only the panel list reflects the user's page-filter dropdown. Coupling the bbox layer to the panel filter (`pageNumber === activePage && (pageFilter === "all" || pageFilter === pageNumber)`) hides bboxes the user expects to see.

### Evidence

- The reference adapter source: `lib/kognitos/idp-invoice-field-highlights.ts` (612 lines, every helper called out above).
- The current viewer that consumes it: `components/kognitos/invoice-pdf-highlight-viewer.tsx`.
- The from-scratch viewer that re-discovered the contract: `components/kognitos/pdf-highlight-viewer-v2.tsx`.
- The reverse-engineering doc that this PR's `references/payload-shapes.md` lifts from: `docs/idp-invoice-pdf-highlights.md`.
- Plugin source where the gap lives: `~/.cursor/plugins/marketplaces/github.com/kognitos/kognitos-plugin/152d5eb49c51247e0b60b826874b8a9ffd9242b4/skills/kognitos-app-development/references/document-preview.md` (lines 81–82, 162–188, 572, 1281–1352).

### Staged PR

A complete PR is staged in this repo at `docs/upstream-pr/kognitos-plugin/`:

```
skills/kognitos-idp-payload/SKILL.md
skills/kognitos-idp-payload/references/contract.md
skills/kognitos-idp-payload/references/adapter.md
skills/kognitos-idp-payload/references/payload-shapes.md  (34-variant fixture matrix)
skills/kognitos-idp-payload/references/diagnostics.md
skills/kognitos-idp-payload/assets/idp-payload-adapter.ts (the reference adapter)
skills/kognitos-app-development/references/document-preview.md.patch
PR-DESCRIPTION.md
README.md (operator instructions for filing)
```

Filing is operator-gated per `.cursor/rules/kognitos-plugin-feedback.mdc`. When filed, flip Status to `filed-as-pr (#NNN)`.

### Graduation

- [ ] Filed as issue #
- [x] Staged as PR (this repo, `docs/upstream-pr/kognitos-plugin/`)
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — `document-preview.md` defaults diverge from the canonical viewer's chrome / hover semantics

**Status**: open
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — multiple sections; specifically `## Window Chrome and Color Scheme`, `## Bottom Toolbar (Document Controls)`, `## Right Panel — Extracted Values + Confidence`, `## Bounding Box Overlays`, `## Page Rail (Multi-page Documents)`
**Where in this app**: `components/kognitos/pdf-highlight-viewer-v2.tsx` (the from-scratch viewer built strictly from plugin guidance) compared against `components/kognitos/invoice-pdf-highlight-viewer.tsx` (the canonical dashboard viewer)

### What I was testing

After building `PdfHighlightViewerV2` strictly from the plugin's reference templates, I compared it side-by-side against the dashboard's `InvoicePdfHighlightViewer` to identify where "follow the plugin verbatim" produces a noticeably different end-user surface than the team's canonical viewer.

### What didn't work

The plugin templates are internally consistent and shipped without compile errors (modulo the three earlier entries below), but the resulting UI diverged from the dashboard in seven concrete ways. Each one is a place where a developer following the plugin guidance verbatim would produce a viewer the team would reject in code review against the dashboard's behavior:

1. **Bottom toolbar palette / chrome.** Plugin describes "square ~31×31 buttons, `pointer-events-none` container" and shows dark zinc tokens (`bg-zinc-950/85`, `border-white/[0.08]`) consistent with the rest of the dark workspace. The dashboard ships a *white* pill (`bg-white` when highlights are on, `bg-white/93 + backdrop-blur-sm` when off) with shadcn `<Button variant="ghost">`s in a near-black text color, sky-tinted active state for the highlight toggle (`bg-sky-500/12 text-sky-900`), and a panel-toggle that switches between `outline` and `active` (filled) treatments with its own border color. The toolbar also includes a `h-[17px] w-px bg-zinc-400/55` vertical divider between document tools and the panel toggle to read as separate control groups, plus `side="top"` on every tooltip so they don't clip on the workspace's bottom edge. The plugin neither specifies the white-pill palette nor mentions `side="top"` for tooltips.

2. **Highlight toggle icon.** Plugin reference uses `Type` (the lucide "Aa" glyph). Dashboard uses `Layers2`, which reads more clearly as "show layers (highlights)" than as "show text" — important because the highlight toggle controls the bbox layer, not text rendering.

3. **Right-panel chrome.** Plugin recipe is a thin border + dark-zinc tokens. Dashboard ships a dedicated `bg-[#121212]` surface (literal hex, not a tailwind token), header padding `pt-3 pb-2.5 px-3` with the title above an inline cluster of `[counter pill][close button]`, and the page-filter expressed as a shadcn `<DropdownMenu>` (not the plugin's native `<select>`) whose trigger reads "All fields" / "Page N only" so the user sees *what* the filter is doing without opening it. Search button gets a sky-tinted active treatment (`border-sky-500/50 bg-zinc-900 text-sky-200`); sort button cycles through three explicit labels ("Page, then name" / "Name A–Z" / "Confidence (high first)") shown in the tooltip — the plugin template only shows two cycle stops and no human-readable label.

4. **Field row contents.** Plugin reference shows two text spans (humanized + mono) and a custom `<ValueChip>` component for the value. Dashboard shows the snake_case identifier in mono only (no humanized companion line — humanization belongs to chrome controls, not to the row label), a lucide `Type` icon (not the plugin's home-rolled "T" badge), and inlines the value-chip styling as a `div` so the row's hover treatment can decorate the same surface (`border-sky-500/60 bg-sky-500/[0.16]` + an inset sky shadow) without a child component re-spreading props. List spacing is `gap-6`, not the plugin template's `divide-y` between rows. The confidence meter is wrapped in a `<Tooltip>` so the user can confirm the numeric value on hover; the plugin's meter only uses the native `title` attribute.

5. **Confidence bars.** Plugin's `confidenceBucket` rule (low → rose / medium → amber / high → emerald) doubled-encodes a signal the bar count alone already communicates. Dashboard fills lit bars with a single emerald tone and leaves unlit bars `bg-zinc-700` — color only signals "lit vs. unlit", which the user reads at a glance without parsing buckets. Dashboard heights are `h-[5px] / h-[9px] / h-[13px]` with `w-[3px]` and `gap-[3px]`, not the plugin reference's smaller `4 / 7 / 10 px` heights and `2px` widths.

6. **Bounding box state vocabulary.** Plugin template expresses the three bbox states (idle / linked-hover / focused) via `outline` + `outline-color` Tailwind utilities. Dashboard uses `border-color` + `box-shadow` rings, an emerald-300 hover treatment in the idle/linked-hover states (the single visual signal that distinguishes "the cursor is on this exact bbox" from "this bbox is the linked partner of a row hover elsewhere"), and `data-field-highlight-focused` for cross-surface scroll targeting. The plugin's outline-driven rings paint a 1px line that doesn't compose with the border the way `box-shadow` rings do — the dashboard's 2px halo needs to sit *outside* the border, not on top of it.

7. **Page rail visuals.** Plugin specifies "rail width ~120px, thumbnail width ~96px, per-thumbnail caption + field-count badge, lazy IntersectionObserver." Dashboard ships a much more compact 76px-wide rail (`bg-[#1c1c1e]` literal hex, not a zinc token) with 60px thumbnails (rendered at a 52px source width and upscaled), no caption / badge, eager rendering of every page, and an outline-on-select treatment instead of a ring + tinted background.

8. **Mask layer extras.** Plugin template only sets `maskImage`, `WebkitMaskImage`, and `maskMode`. Dashboard also explicitly sets `maskSize`, `maskRepeat`, `maskPosition` (with WebKit-prefixed pairs), and defensive `backdropFilter: "none"` / `filter: "none"` overrides. Without these, the SVG mask occasionally re-tiled on zoom changes when an ancestor stacking-context exposed the mask container at a different rect than the dim layer.

9. **Workspace padding.** Plugin's reference puts `p-6` directly on the scroll surface. Dashboard puts no padding on the scroll surface and instead wraps the page in an inner flex container that applies `px-10 pb-10 pt-10`. With `p-6` on the outer scroll surface the page hugs the rail edge on wide layouts and the bottom of the document drops under the toolbar.

10. **Pointer-leave race.** Plugin templates (both the bbox button and the field row) wire `onPointerLeave={() => onLinkedHoverChange(null)}`. This races when the pointer transits from a bbox to its sibling field row (or vice versa): the leave handler can clear a linked-id that the new entered surface just set. Dashboard resolves at the parent with a functional updater (`setLinkedHoverFieldId((cur) => (cur === id ? null : cur))`) and exposes per-id `enter` / `leave` handlers to children. The plugin template's clear-unconditionally pattern produces visibly flickery cross-surface hover.

11. **Toolbar position vs. scroll container.** Plugin doesn't address whether the toolbar should be a descendant of the scrolling workspace or a sibling of it. The plugin's reference template renders it as `<div className="absolute bottom-3 …">` *inside* the scrolling region, which makes the toolbar move up and down with the document on scroll. Dashboard mounts it as a sibling `shrink-0` strip below the scrolling div so it stays pinned at the bottom of the viewport.

12. **`PageRail` `pages <= 1` early-return.** Plugin template returns `null` when there's only one page. Dashboard renders the rail unconditionally so the workspace columns don't reflow when a previously-multi-page run is replaced by a single-page one (and the rail still surfaces its single thumbnail as a click target).

13. **`pageFilter` coupled to bbox layer.** Plugin's worked example filters `highlightsOnActivePage` by both `h.pageNumber === activePage` *and* `(pageFilter === "all" || pageFilter === h.pageNumber)`, which hides bboxes the user expects to see when the panel filter is set to a non-active page. Dashboard keeps the bbox layer's filter strictly to the active page — the panel filter only narrows the right-side list.

### Root cause (best guess)

The plugin guidance was written from a "default styling that obeys the rules" mindset (dark workspace + dark chrome + bucket-coded confidence + bucket icon for highlight toggle), but the dashboard is the durable target the operator actually ships. The gap is largely a documentation gap: the plugin's reference templates aren't wrong, but they're not labeled as *defaults that the team is expected to override*. A reader following the plugin verbatim has no signal that the canonical viewer made these specific design choices and *why* (compactness, hover legibility, fewer signals to parse).

The pointer-leave race (10), toolbar-in-scroll-container (11), `pages <= 1` early return (12), and panel-filter ↔ bbox coupling (13) are concrete bugs in the plugin's reference templates, not stylistic divergences. Following any of these verbatim produces broken UX even before any styling is applied.

### Suggested change to plugin

Categorize updates into "bugs" (must fix in templates) and "style defaults" (re-frame as overridable):

**Template bugs (fix the templates):**

- `## Bottom Toolbar (Document Controls)` — explicitly say the toolbar is a sibling of the scrolling workspace, not a descendant; show a worked example that puts it in a sibling `shrink-0` strip with `border-t`. Drop the `absolute bottom-3` wrapper from the reference.
- `## Right Panel — Extracted Values + Confidence` → `### Field Row Layout` — change the row's `onPointerLeave` template from `onLinkedHoverChange(null)` to a functional updater pattern at the parent, and document the bbox/row pointer-leave race.
- `## Page Rail (Multi-page Documents)` — remove the `pages <= 1` early return; the rail should always render when a `pdfDoc` is loaded.
- `## Document Positioning` (or a dedicated `### Filter Coupling` sub-section) — the bbox-layer filter and the panel-list filter must be independent; show a worked example of each.

**Style defaults (re-frame as overridable):**

- Add a `### Style Defaults vs. Style Contracts` section to `## Window Chrome and Color Scheme` that lists what's contractual (dark workspace, contrast hierarchy, font scale) vs. what's a default (specific palette tokens, white toolbar pill vs. dark, emerald-only confidence fill vs. bucketed). Direct readers to override the defaults to match their canonical viewer.
- Add an opt-in dashboard-style recipe for each of (1)–(9) above so a reader can copy a *complete* recipe rather than re-deriving it. Putting these in `references/document-preview-dashboard-recipe.md` as a sibling reference would let the main `document-preview.md` stay focused on the contract and let teams pull in the recipe when they want it.
- Add a one-paragraph "if your team has a canonical viewer, port concepts not classes" note that explicitly calls out: humanization is for chrome controls, not row labels; bbox state should compose via `box-shadow` rings, not `outline`; `lucide` icon choice should map to the *semantic* of the toggle (Layers2 for layers, not Type for "show text").

### Evidence

- Side-by-side compare: open `/exception-handling/...` (dashboard, ships `InvoicePdfHighlightViewer`) and `/exception-handling-v2/doc-preview/...` (V2, ships `PdfHighlightViewerV2`) on the same run id; the listed divergences (1)–(13) are reproducible by clicking around both viewers.
- Source diff: `components/kognitos/invoice-pdf-highlight-viewer.tsx` vs `components/kognitos/pdf-highlight-viewer-v2.tsx`.
- Plugin source: `~/.cursor/plugins/marketplaces/github.com/kognitos/kognitos-plugin/152d5eb49c51247e0b60b826874b8a9ffd9242b4/skills/kognitos-app-development/references/document-preview.md`.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — `PdfPageWithHighlights` template's PDF.js `transform` literal violates current `pdfjs-dist` typing

**Status**: open
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — `### Canvas Mount Order` reference template (the `page.render({ … transform: dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as const) : undefined })` snippet)
**Where in this app**: `components/kognitos/pdf-highlight-viewer-v2.tsx` (`PdfPageWithHighlights` and `PageThumbnail` render bodies)

### What I was testing

Building a fresh viewer (`PdfHighlightViewerV2`) by translating `document-preview.md`'s reference templates verbatim, against `pdfjs-dist@^4.10.38` and `typescript@^5`.

### What didn't work

The plugin reference shows:

```ts
const task = page.render({
  canvasContext: ctx,
  viewport: vp,
  transform: dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as const) : undefined,
});
```

In `pdfjs-dist@^4.10.38`, `RenderParameters.transform` is typed as `number[]` (mutable, not `readonly`), and `page.render()` returns a `RenderTask` whose `.promise` is `Promise<void>` but whose `.cancel()` shape diverges enough from the plugin's hand-typed `{ cancel(): void; promise: Promise<void> }` that direct assignment between the two requires casts. Following the template verbatim produces a compile error like:

```
The type 'readonly [number, 0, 0, number, 0, 0]' is 'readonly' and cannot be
assigned to the mutable type 'number[]'.
```

### Root cause (best guess)

The plugin template encodes the transform as a `readonly` tuple via `as const`, presumably to make the immutability clear to a reader, but the upstream `pdfjs-dist` type omits `readonly`. The template was either written against an older `pdfjs-dist` that allowed `readonly` tuples or against hand-rolled types. Either way, anyone copy-pasting the template into a current `pdfjs-dist` + strict TS project hits a compile error before they ever see a render frame.

### Suggested change to plugin

In `references/document-preview.md` `### Canvas Mount Order`:

1. Drop the `as const` from the transform literal, or wrap it in a cast:

   ```ts
   transform: dpr !== 1 ? ([dpr, 0, 0, dpr, 0, 0] as unknown as number[]) : undefined,
   ```

2. Add a sub-bullet under "Required behavior — patterns differ but the contract is fixed" calling out that the `RenderTask` returned by `page.render()` should be tracked through a hand-rolled `{ cancel(): void; promise: Promise<void> }` shim type, since `pdfjs-dist`'s exported `RenderTask` is a class whose private fields make structural typing painful. The current "Render-task Cancellation" template already does this implicitly; making it explicit avoids re-derivation.

### Evidence

- `pdfjs-dist@^4.10.38` types: `node_modules/pdfjs-dist/types/src/display/api.d.ts` → `RenderParameters.transform?: number[]`.
- Compile error reproducible by reverting `pdf-highlight-viewer-v2.tsx` to use `[dpr, 0, 0, dpr, 0, 0] as const`.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — Dim-layer template's `WebkitMaskMode` style key isn't in React's `CSSProperties`

**Status**: open
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — `## Bounding Box Overlays` → `### Stacking, Isolation, and Mask Scope` (the `<div style={{ maskImage, WebkitMaskImage, maskMode }}>` reference template)
**Where in this app**: `components/kognitos/pdf-highlight-viewer-v2.tsx` (the dim layer inside `PdfPageWithHighlights`)

### What I was testing

Translating the plugin's `PdfPageOverlay` reference template into a real React 19 + TypeScript file.

### What didn't work

The plugin template (line ~800) is:

```tsx
<div
  className="…"
  style={{
    maskImage: `url(#${maskId})`,
    WebkitMaskImage: `url(#${maskId})`,
    maskMode: "luminance",
  }}
  aria-hidden
/>
```

I extended this with the natural pair `WebkitMaskMode: "luminance"` (which the original CSS spec required for older Safari) — and TypeScript rejected it:

```
Object literal may only specify known properties, but 'WebkitMaskMode'
does not exist in type 'Properties<string | number, string & {}>'.
Did you mean to write 'WebkitMask'?
```

Modern Safari accepts unprefixed `mask-mode: luminance`, so dropping the vendor pair is fine in practice — but the plugin reader is left to discover this via a TS compile error. The plugin doesn't say anything about which vendor prefixes are necessary for the dim layer.

### Root cause (best guess)

CSS mask shorthand support has shifted — modern Safari aliases `mask-mode` from the unprefixed property, so the `-webkit-mask-mode` variant is unnecessary. React's `CSSProperties` (from `csstype`) reflects this and only types `WebkitMaskImage`, not `WebkitMaskMode`.

### Suggested change to plugin

Add a one-line note under `### Stacking, Isolation, and Mask Scope`:

> The dim layer's mask only needs the unprefixed `mask-mode: luminance`
> on current browsers; `-webkit-mask-mode` is not required and is not
> typed by React's `CSSProperties` (csstype). The `-webkit-mask-image`
> pair *is* still needed for older Safari and is typed.

### Evidence

- `node_modules/csstype/index.d.ts` — `WebkitMaskImage` is typed; `WebkitMaskMode` is not.
- Browser support: `mask-mode` unprefixed in Safari 17+ and Chromium since the property was unprefixed.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — `PageThumbnail` template trips React 19's `react-hooks/set-state-in-effect` rule

**Status**: open
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — `## Page Rail (Multi-page Documents)` → `Reference template for the lazy thumbnail renderer` (the `useEffect` that calls `setVisible(true)` synchronously when `IntersectionObserver` is missing)
**Where in this app**: `components/kognitos/pdf-highlight-viewer-v2.tsx` → `PageThumbnail`

### What I was testing

Translating the plugin's lazy-thumbnail reference template into a Next.js 16 + React 19 + `eslint-config-next@16.1.6` project (which enables the new `react-hooks/set-state-in-effect` rule by default).

### What didn't work

The plugin template (line ~309) is:

```tsx
useEffect(() => {
  const node = ref.current?.parentElement;
  if (!node || typeof IntersectionObserver === "undefined") {
    setVisible(true);
    return;
  }
  …
}, []);
```

`eslint-config-next` flags this with:

```
Calling setState synchronously within an effect can trigger cascading renders
… 354:7 react-hooks/set-state-in-effect
```

The template doesn't mention any escape hatch and there is no `eslint-disable` annotation modeled, so a strict-CI project either has to silently disable the rule or refactor the template.

### Root cause (best guess)

The template predates React 19's strict-effect linting. Once `react-hooks/set-state-in-effect` lands, "set state synchronously inside an effect" becomes a correctness smell, not just a perf nit — even when it's a one-time SSR fallback.

### Suggested change to plugin

Replace the SSR-fallback branch in the template with a lazy initial state so the effect *only* sets state from the IO callback:

```tsx
const [visible, setVisible] = useState<boolean>(() => {
  if (typeof window === "undefined") return false;
  return typeof IntersectionObserver === "undefined";
});

useEffect(() => {
  if (visible) return;
  const node = ref.current?.parentElement;
  if (!node || typeof IntersectionObserver === "undefined") return;
  const io = new IntersectionObserver(/* … */);
  io.observe(node);
  return () => io.disconnect();
}, [visible]);
```

Also add a one-liner under `## Page Rail` saying "the lazy initial state pattern is required so projects on `eslint-config-next@>=16` (which enables `react-hooks/set-state-in-effect` by default) don't have to disable the rule per-callsite."

### Evidence

- Working refactor in `components/kognitos/pdf-highlight-viewer-v2.tsx` (`PageThumbnail`).
- ESLint rule docs: <https://react.dev/learn/you-might-not-need-an-effect>.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — Plugin's reference `FieldHighlight` model assumes adapter fields (`name`, `rawValue`, `elementType`) that the in-repo adapter doesn't expose

**Status**: open
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — `### Field Row Layout` (uses `h.elementType`, `h.name`, `h.rawValue`), `### Read-only Value Chip` + `### Value Formatting` (use `h.rawValue` and import `decodeIdpValue` / `decodeStructDecimal` from `@/lib/kognitos/idp`)
**Where in this app**: `lib/kognitos/idp-invoice-field-highlights.ts` (`IdPdfFieldHighlight`), consumed by `components/kognitos/pdf-highlight-viewer-v2.tsx`

### What I was testing

Wiring the plugin's `<FieldRow>` and `<ValueChip>` reference templates against the in-repo IDP parser the plugin's "Default Expectations" instruct me to use as the adapter ("Normalize the payload in an adapter, not in the UI; the viewer consumes a flat `FieldHighlight[]`").

### What didn't work

The plugin's `FieldHighlight` reference shape is implicit — never typed in one place — but its templates depend on at least these fields:

| Plugin template uses | Field | Present on in-repo `IdPdfFieldHighlight`? |
|---|---|---|
| `humanizeFieldName(h.name)`, `data-field-row-id={h.id}` | `name` | **Mismatch** — the in-repo adapter calls this `label` |
| `h.elementType` (passed to `<FieldTypeGlyph kind={h.elementType} />`) | `elementType` | **Missing** — adapter filters by element type and discards it |
| `h.rawValue` (recursed by `formatIdpValue`) | `rawValue` | **Missing** — adapter pre-extracts `value: string` (first list-item text) |
| `h.bbox`, `h.bboxCoordMode`, `h.confidence`, `h.pageNumber`, `h.id` | — | Present, identical |

In addition, the plugin's `### Value Formatting` template imports `decodeIdpValue` and `decodeStructDecimal` from `@/lib/kognitos/idp`, but no such module exists in the project — and the plugin never defines that adapter surface (the `## IDP Payload Contract` section describes the *protobuf* decode rules, but doesn't ship reference code). The closest in-repo helpers (`decodeCSharpDecimalLoMidHiFlags`, `unwrapProtoValueLayers`) are private to the parser file.

Net effect: a reader who tries to follow the plugin templates verbatim hits three independent type errors plus an unresolved import — and to fix them either has to extend the existing adapter (invasive, breaks other viewers in the repo) or rename plugin-template field references throughout their own viewer.

### Root cause (best guess)

The plugin documents the *contract* of the parser (`## IDP Payload Contract`) and the *output usage* in templates (`### Field Row Layout`, `### Value Formatting`) but never ships a single canonical `FieldHighlight` type, nor a canonical `@/lib/kognitos/idp` adapter module. Each downstream app has to fill that gap on its own — and apps with pre-existing adapters end up with field-name divergence (`label` vs `name`, `value` vs `rawValue`) the plugin templates aren't tolerant of.

### Suggested change to plugin

Add a `### Field Highlight Reference Type` subsection at the top of `## IDP Payload Contract`:

```ts
export type FieldHighlight = {
  /** Stable id used by `data-field-box-id` and `data-field-row-id`. */
  id: string;
  /** Technical name (e.g. `vendor_invoice_number`). Used in logs and as a mono caption. */
  name: string;
  /** Optional pre-humanized label; if absent, the panel calls `humanizeFieldName(name)`. */
  displayName?: string;
  pageNumber: number;
  confidence: number | null;
  bbox: { x: number; y: number; width: number; height: number };
  bboxCoordMode: "normalized" | "pdf_points";
  /** Pre-extracted display string for the value chip (optional). */
  text?: string;
  /** Untouched IDP `Value` for `formatIdpValue` to recurse through (optional). */
  rawValue?: unknown;
  /** `extracted_field` / `document_field` / etc — for `<FieldTypeGlyph />`. */
  elementType?: string;
};
```

…and document explicitly that an app's adapter SHOULD set at least `id`, `name`, `pageNumber`, `confidence`, `bbox`, `bboxCoordMode`; the rest are for advanced templates. Ship a reference `decodeIdpValue` and `decodeStructDecimal` (or remove the template's import and inline the recursion) so the `### Value Formatting` example doesn't reference a phantom module.

### Evidence

- `lib/kognitos/idp-invoice-field-highlights.ts` (existing adapter — uses `label`, `value`).
- `components/kognitos/pdf-highlight-viewer-v2.tsx` — every place where I had to substitute `h.label` for `h.name` and `h.value` for `h.rawValue` is a comment or a small wrapper.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — `## Bounding Box Overlays` references `highlightBboxRectCss` and `HighlightButton` without ever shipping the templates

**Status**: open
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — `## Bounding Box Overlays` (the `<rect />` mask cutouts call `highlightBboxRectCss(h, layout)`; the overlay layer renders `<HighlightButton key={h.id} h={h} … />`); `### Hit-Target Wiring` shows the data-attribute snippet but not the full button
**Where in this app**: `components/kognitos/pdf-highlight-viewer-v2.tsx` → `highlightBboxRectCss`, `HighlightButton`

### What I was testing

Implementing the bounding-box overlay layer (mask + dim + buttons) from the plugin's reference templates only.

### What didn't work

`PdfPageOverlay` (line ~766) calls a helper `highlightBboxRectCss(h, layout)` that **is never defined anywhere in `document-preview.md`**. The reader has to invent it from prose: "Both modes resolve into the same percentage layout against the PDF base viewport, so the overlay code does not branch on units" (`## Bounding Box Overlays`, `Visibility and Usability`) plus the `## IDP Payload Contract` rules about normalized vs PDF-point bboxes plus the per-page Y-axis flip rule.

Same gap on the visual side: the plugin specifies the three z-stacked states for the overlay button — idle (`z-21`, neutral white border, transparent bg), linked-hover (`z-22`, cool accent), focused (`z-23`, warm accent + outer ring) — and lays out hit-target wiring (`data-field-box-id`), the activation handler (`onClickCapture` for the highlights-off coordination), the bidirectional hover, the minimum bbox size (`MIN_BBOX_PX`), and the contrast-friendly border + outer ring rules. But it never ships a `<HighlightButton>` template that puts those rules together. The reader has to derive a class set such as:

```tsx
"border border-neutral-800/90 outline outline-1 outline-white/60 z-[21]",
isLinkedHover && "z-[22] border-sky-400/95 outline-sky-300/40",
isFocused && "z-[23] border-amber-400 outline-amber-300/60 shadow-[0_0_0_3px_rgba(251,191,36,0.45)]",
```

…on their own, even though `### Confidence Signal Bars` *does* ship a complete reference component for a much simpler control.

### Root cause (best guess)

The plugin invests heavily in describing failure modes ("a non-transparent fill hides the document and defeats the spotlight effect") and contract rules (z-index ordering, minimum size, outer-ring contrast) but stops short of a working component for the bbox button. Conversely, the much simpler `ConfidenceSignalBars` ships as a complete component. The asymmetry leaves the most subtle interactive surface — the bbox button — with the least implementation guidance.

### Suggested change to plugin

In `## Bounding Box Overlays`, after `### Hit-Target Wiring` and before `### Stacking, Isolation, and Mask Scope`, add:

1. A reference `highlightBboxRectCss(h, layout, yFlip)` helper that handles both `normalized` and `pdf_points` modes, applies the per-page `yFlip` decision, and enforces the minimum-size bump:

   ```ts
   function highlightBboxRectCss(h: FieldHighlight, L: PageLayout, yFlip: "flip" | "noflip") { /* … */ }
   ```

2. A reference `HighlightButton` with the three visual states wired together, mirroring the shape of `ConfidenceSignalBars`:

   ```tsx
   function HighlightButton({ h, layout, yFlip, isLinkedHover, isFocused, onLinkedHoverChange, onActivate }) { /* … */ }
   ```

   …with the explicit-class set above (or a tokenized equivalent), including `pointer-events-auto`, transparent background, the per-state z-index, and the contrast-friendly outer ring.

### Evidence

- `components/kognitos/pdf-highlight-viewer-v2.tsx` → `highlightBboxRectCss` and `HighlightButton` (both written from scratch from prose).
- Cross-check: `ConfidenceSignalBars` in the plugin (line ~1027) is shipped complete — exactly what the bbox button section is missing.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — `## Bottom Toolbar` and `Right Panel` describe behavior thoroughly but ship no React templates

**Status**: open
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — `## Bottom Toolbar (Document Controls)` (table of controls, rules); `## Right Panel — Extracted Values + Confidence` → `Header`, `### Toolbar Row` (snippet for the toolbar, but no panel-header template, no `IconButton`, no `<FieldTypeGlyph />`, no `SortIcon`, no `PageFilterDropdown`)
**Where in this app**: `components/kognitos/pdf-highlight-viewer-v2.tsx` → `BottomToolbar`, `IconButton`, `RightPanel`, `RightPanelToolbar`

### What I was testing

Building the bottom toolbar (zoom / fit / highlights toggle / download / panel toggle) and the right-panel header (title + count pill + close) and toolbar row (page filter + search + sort) from the plugin reference.

### What didn't work

For the bottom toolbar, the plugin gives a table of controls, the `pointer-events-none` container rule, the `aria-pressed` / tooltip rules, and the disabled-state-at-zoom-limits rule — but no template. The `### Toolbar Row` template inside the right panel section *does* show JSX but references several unspecified components (`<IconButton>`, `<PageFilterDropdown>`, `<SortIcon mode={sortMode} />`) without shipping their implementations, and assumes a `searchOpen` toggle state machine without showing the wiring.

Net: implementing both the bottom toolbar and the panel toolbar required inventing `IconButton`, `FieldTypeGlyph`, and `SortIcon` from prose. This is acceptable for chrome-shaped controls, but `IconButton` is the *primary* hover affordance for the entire viewer and the plugin already ships full templates for two adjacent simpler primitives (`ConfidenceSignalBars`, `ValueChip`) — the asymmetry makes the doc feel half-finished.

### Root cause (best guess)

Same shape as the bbox-button gap above: the plugin invests in rules and behavior but ships templates only for the components that are most "data shaped" (confidence bars, value chip), not the most "interaction shaped" (toolbar buttons, panel header). A reader copy-pasting templates ends up with the data parts and has to derive the chrome.

### Suggested change to plugin

In `## Bottom Toolbar`, add a reference component template that wires `IconButton`, `Tooltip`, `aria-pressed`, and the `pointer-events-none` container correctly (the rules already specify exactly what it should look like). Same for `RightPanelHeader` (title + count pill + close). Both templates can be small (~30–40 lines each) but should be present so a fresh implementation doesn't have to invent the names.

### Evidence

- `components/kognitos/pdf-highlight-viewer-v2.tsx` — `BottomToolbar`, `IconButton`, `FieldTypeGlyph` (inlined as a single span), `RightPanelToolbar`, panel header.

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved

---

## 2026-05-07 — `document-preview.md` is missing a dashboard-entry-point dialog template

**Status**: open
**Plugin SHA at time of finding**: `152d5eb49c51247e0b60b826874b8a9ffd9242b4`
**Surface (skill / file)**: `kognitos-app-development/references/document-preview.md` — between "Window Chrome and Color Scheme" and "Embedding the Viewer in a Chat Surface" (i.e. the dashboard / table-row case is structurally absent)
**Where in this app**: `app/(dashboard)/exception-handling-v2/doc-preview/page.tsx` (entire `<Dialog>` wrapping the `<InvoicePdfHighlightViewer />`)

### What I was testing

Wiring each invoice-id cell on the new `doc-preview` page (a table of incomplete Kognitos runs) to open the rich PDF + IDP-overlay viewer in an in-app modal — using only the kognitos-plugin's `document-preview.md` as the spec, with bumblebee and the in-repo `document-preview-test` page off-limits as references.

### What didn't work

The plugin reference is layout-rich for the *contents* of the dialog (Window Chrome, Page Rail, Render Lifecycle, Bounding Box Overlays, Right Panel) and chat-rich for the *entry point* ("Embedding the Viewer in a Chat Surface" gives a full `ChatImagePreviewDialog` reference template, the discriminated-union `ChatDocumentViewerOpen`, MIME sniffing, the `DOC_POPUP_FEATURES` last-resort popup, etc.).

But the **most common entry point** — a dashboard table row that already knows the run id and PDF URL and just wants a plain modal — has no self-contained reference template. The reader has to assemble it from:

- "Window Chrome and Color Scheme" (palette description, not a template)
- "Reset Across Runs" (`key={runId}` snippet, but on a hypothetical surrounding component, not a Dialog)
- "Dialog Title Parity" (one-line `<DialogTitle>` snippet at line ~1631)
- "Inline Preview is Optional" (says "the dashboard table is the canonical entry point" but does not show what that canonical entry point looks like)
- The `ChatImagePreviewDialog` template (line ~1554) — which is the *fallback* case, not the primary one

Concrete consequences while implementing:

1. I had to infer the dialog sizing (`h-[min(82.8vh,828px)] w-[min(88.2vw,82.8rem)]`), the `bg-zinc-900` shell, the `border-white/[0.08]` border, the `[&_[data-slot=dialog-close]]:text-zinc-400` close-button-token override, and the `centerFlex showCloseButton` `DialogContent` props from the *image* dialog template — none of these are given as the canonical dashboard recipe.
2. The chat-surface `handleOpenAttachment` shape is the most prominent click-handler example in the doc, but it routes through the discriminated union and does MIME sniffing the dashboard does not need. A first-time reader could easily over-implement (importing `inferMimeFromName`, threading `ChatDocumentViewerOpen` through page state) when a flat `{ pdfUrl, runId, label } | null` state is sufficient.
3. The "Composition Diagram" and "Dialog Title Parity" sections both call out the dashboard / table cell as one of the canonical entry points, which sets the expectation that a recipe exists somewhere — and then it doesn't.

### Root cause (best guess)

The reference doc grew chat-first: chat is genuinely the harder case (MIME sniffing, popup fallback, image vs PDF disambiguation), so it earned a dedicated section with full templates. The simpler dashboard case ended up scattered across single rules ("Reset Across Runs" `key`, "Dialog Title Parity" title, "Window Chrome" palette) without a single section that stitches them into a copy-pasteable reference template.

### Suggested change to plugin

In `skills/kognitos-app-development/references/document-preview.md`, add a new section between "Window Chrome and Color Scheme" and "Page Rail" titled something like **"Dashboard / Table-Row Entry Point"** containing:

1. A flat state shape:

   ```ts
   type DocPreviewTarget = { pdfUrl: string; runId: string; label: string };
   const [docPreview, setDocPreview] = useState<DocPreviewTarget | null>(null);
   ```

2. A click handler that the dashboard row uses (no MIME sniff, no popup fallback — the dashboard already knows it has a PDF and a run id):

   ```tsx
   <button
     onClick={() => setDocPreview({ pdfUrl: row.invoicePdfUrl, runId: row.id, label: row.invoiceNumber })}
   >
     {row.invoiceNumber}
   </button>
   ```

3. A `<Dialog>` reference template that mounts `<InvoicePdfHighlightViewer key={runId} />` with the dark zinc shell. Make explicit that:
   - `centerFlex` and `showCloseButton` are app-level shadcn `DialogContent` extensions (not stock Radix); apps without them should follow the same composition rules manually.
   - The dialog reset is `setDocPreview(null)` in `onOpenChange`, which both closes the dialog and triggers the viewer's `runId`-keyed cleanup.
   - The `DialogTitle` is `docPreview?.label ?? "Document Processing"` — same sentence as "Dialog Title Parity" but co-located with the recipe so the reader doesn't have to scroll.

4. A cross-link from the existing "Embedding the Viewer in a Chat Surface" section pointing at this new section as the primary case, with chat embedding documented as a *generalization* (one of several entry points) rather than the only worked example.

### Evidence

- Implementation: `app/(dashboard)/exception-handling-v2/doc-preview/page.tsx`, the entire `<Dialog>` block at the bottom of the file. The dialog markup was assembled by reading three different sections of `document-preview.md` and adapting the `ChatImagePreviewDialog` template; nothing in the plugin references this exact composition.
- Plugin paths consulted while implementing:
  - `skills/kognitos-app-development/SKILL.md`
  - `skills/kognitos-app-development/references/document-preview.md` (sections: At-a-Glance, Composition Diagram, Default Expectations, Window Chrome and Color Scheme, Reset Across Runs, Embedding the Viewer in a Chat Surface, Dialog Title Parity, Inline Preview is Optional)
  - `skills/kognitos-app-development/assets/app-review-checklist.md`

### Graduation

- [ ] Filed as issue #
- [ ] Filed as PR #
- [ ] Merged / resolved

