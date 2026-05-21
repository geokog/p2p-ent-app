# Add `kognitos-idp-payload` skill; fix `document-preview.md` template gaps

## Summary

Closes the IDP-adapter gap that surfaces every time someone deploys
the plugin and implements document preview. Today
`document-preview.md` says "normalize the payload in an adapter, not
in the UI" and then describes the contract in prose — but it doesn't
ship the adapter, the type, the helper inventory, the fixtures, or
the diagnostics surface. Each new app re-derives them and re-discovers
the same Decimal-bit / Y-axis / element-type-alias edge cases.

This PR:

1. **Adds a new `kognitos-idp-payload` skill** alongside
   `kognitos-app-development` and `kognitos-api-client`. The skill is
   self-contained and progressive-disclosure: agents only load it when
   a UI surface needs to consume IDP output.
2. **Adds a copy-pasteable reference adapter**
   (`assets/idp-payload-adapter.ts`) implementing every rule in the
   contract.
3. **Adds a fixture matrix** (`references/payload-shapes.md`) covering
   34 known payload-shape variants, each with a minimal JSON snippet
   and the expected `FieldHighlight[]` output.
4. **Adds a diagnostics reference** (`references/diagnostics.md`)
   defining the four-step funnel, the `IdpFieldParseTrace` type, the
   stable `skipReason` vocabulary, and the cross-cutting log prefixes.
5. **Patches `kognitos-app-development/references/document-preview.md`**
   to cross-link the new skill from `## IDP Payload Contract` (rather
   than duplicating the contract there), and fixes three template gaps
   the agent feedback log captured while building the in-repo viewer:
   - **`PageRail` `pages <= 1` early return** removed — the rail
     should always render so the column structure stays stable across
     run swaps.
   - **Bottom toolbar mount location** spelled out — toolbar is a
     sibling of the scrolling workspace, not a descendant.
   - **Bbox button pointer-leave handlers** spelled out — must use the
     same race-safe parent-side `setLinkedHoverFieldId((cur) => cur
     === id ? null : cur)` pattern the row template already uses.
   - **Filter coupling** documented as a new sub-section under
     `## Bounding Box Overlays` — the bbox layer filters strictly by
     active page; only the panel list reflects user-controlled
     filters.

## What's NOT in this PR

- The reference adapter is shipped as plain TypeScript source for
  copy-and-fork into apps. There is intentionally no npm package; that
  graduation is a separate PR (and a separate decision) once the
  adapter has been deployed through three or four apps and the
  surface has stabilized.
- The diagnostics surface ships as a reference, not as a runtime
  helper bundled into every app — apps wrap the trace API in their
  own debug-env-var-aware wrapper as shown in
  `references/diagnostics.md`.

## File map

```
skills/kognitos-idp-payload/
  SKILL.md                                    NEW
  references/contract.md                      NEW
  references/adapter.md                       NEW
  references/payload-shapes.md                NEW
  references/diagnostics.md                   NEW
  assets/idp-payload-adapter.ts               NEW

skills/kognitos-app-development/
  references/document-preview.md              MODIFIED (see attached patch)
```

## Test plan

### Pre-flight (already done before filing)

A vitest bench was scaffolded against the bundled
`assets/idp-payload-adapter.ts` source and the fixtures in
`references/payload-shapes.md`. **32 fixtures pass green** covering:
number wrapping (F1–F3), Decimal-bit decoding incl. scale cap and
sign (F4–F7), bbox coordinate-mode inference (F8), per-page Y-axis
flip selector (F9–F11, see "Defects fixed during pre-flight" below),
element-type aliases (F12 / F13 / F33), source-key casing (F14 / F15),
field-list path variants (F17), root tree shapes (F19), empty /
missing payloads (F20–F22), confidence pass-through (F30–F32), and
spot coverage of skip-reason vocabulary (F23 / F27).

### Defects fixed during pre-flight

Two fixtures were authored from prose without round-tripping them
through the adapter. Both are patched in this PR:

- **F6 (Decimal scale cap)** — original
  `decimalNum(8500000000000000, 0, 0, 0x100000)` violated the C#
  `Decimal.GetBits()` uint32 contract on `lo` and encoded scale 16,
  not 28 — so the "scale cap to 28" rule was never exercised.
  Replaced with `decimalNum(85, 0, 0, 0x1F0000)` (encoded scale 31 →
  adapter clamps to 28), expected `~8.5e-27`. A note was added about
  composing across `mid` / `hi` for magnitudes that exceed 2^32.
- **F9 / F10 / F11 (Y-axis flip selector)** — F9 originally claimed
  `chooseYAxisFlipForPage` returns `"flip"` for `bbox(72, 720, 120,
  36)` on a letter-size page. The selector actually returns
  `"noflip"`: both Y-up and Y-down interpretations land that bbox
  fully inside the page, overlap areas are equal, and the selector
  tie-breaks to `"noflip"` via its strict `>` comparison. Expected
  outputs corrected and a **Selector tie-break behavior** call-out
  added before the F9–F11 block. The structural property under test
  for F11 (per-page invocation independence) is preserved.

### To verify post-merge

- [ ] Skill loads via Cursor's plugin marketplace (verify
      `~/.cursor/plugins/marketplaces/.../<sha>/skills/kognitos-idp-payload/`
      mounts correctly after this PR merges and the SHA bumps).
- [ ] Walk through the new skill from the agent perspective: ask "how
      do I parse a Kognitos IDP payload?" in a fresh chat and confirm
      the agent loads `kognitos-idp-payload/SKILL.md` first, then the
      relevant references on demand.
- [ ] Re-run the pre-flight bench by copying
      `assets/idp-payload-adapter.ts` into a sample app along with
      the fixtures from `references/payload-shapes.md`. All 32
      currently-bench-covered variants should still produce the
      documented expected output; the remaining variants in the
      34-variant matrix are documented but not yet bench-covered.
- [ ] Cross-link from `document-preview.md`'s `## IDP Payload
      Contract` section resolves correctly in the rendered plugin
      docs.

## Provenance

This PR is the upstream graduation of feedback captured in a downstream
application's `docs/kognitos-plugin-feedback.md` — specifically the
entries titled:

1. "`document-preview.md` defaults diverge from the canonical viewer's
   chrome / hover semantics" (template-bug section).
2. "`document-preview.md`'s IDP adapter is described in prose but never
   shipped as a reference" (the parent finding for the new skill).
3. "Layer 1 testing surfaced two fixture/expected-output defects in the
   staged `kognitos-idp-payload` skill" (the F6 + F9–F11 patches above).

The reference adapter shipped here is a clean lift of
`p2p-ent-app:lib/kognitos/idp-invoice-field-highlights.ts`. The
fixture matrix was derived from production runs surfaced in that
repo's diagnostics route.

## Reviewer notes

The patch to `document-preview.md` is large because the existing
`## IDP Payload Contract` section is replaced by a cross-link. The
contract content moves into the new skill's `references/contract.md`
verbatim (with light expansion to make it standalone) — no rules are
removed.
