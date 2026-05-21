# Staged upstream PR — `kognitos/kognitos-plugin`

This directory contains a staged-but-unfiled PR against
`kognitos/kognitos-plugin`. The contents mirror the upstream layout
exactly so the files can be applied verbatim to a fresh clone of the
plugin repo.

## What's here

```
PR-DESCRIPTION.md                              ← copy into `gh pr create --body`
README.md                                       ← this file
skills/kognitos-idp-payload/                    ← NEW skill (full tree)
  SKILL.md
  references/contract.md
  references/adapter.md
  references/payload-shapes.md
  references/diagnostics.md
  assets/idp-payload-adapter.ts
skills/kognitos-app-development/
  references/document-preview.md                ← full modified file (overwrite upstream copy)
```

The `document-preview.md` here is the **post-edit** full file — copy
it on top of the upstream copy to apply the changes. We tried
shipping a unified-diff `.patch` originally but hand-authored hunk
headers drifted from the body counts in 6/7 hunks; full-file delivery
sidesteps that class of bug and gives upstream maintainers a clean
file diff in github review.

## How to file (operator-gated)

The repo rule
[`docs/kognitos-plugin-feedback.md`](../../kognitos-plugin-feedback.md)
states: *"Do NOT file an issue / PR upstream from inside an agent
session unless the operator explicitly asks. Capture is automatic;
filing is operator-gated."*

When you (the operator) are ready:

```bash
# Clone the upstream repo into a writable location (NOT under
# ~/.cursor/plugins/, which gets wiped on plugin update).
gh repo clone kognitos/kognitos-plugin ~/code/kognitos-plugin
cd ~/code/kognitos-plugin
git checkout -b add-kognitos-idp-payload-skill

# Copy the new skill tree.
cp -r /Users/georgewilliams/cursor_projects/p2p-ent-app/docs/upstream-pr/kognitos-plugin/skills/kognitos-idp-payload \
      skills/

# Overwrite the existing document-preview.md with the modified full file.
cp /Users/georgewilliams/cursor_projects/p2p-ent-app/docs/upstream-pr/kognitos-plugin/skills/kognitos-app-development/references/document-preview.md \
   skills/kognitos-app-development/references/document-preview.md

# Sanity-check the diff before committing — should show the seven
# intended changes (page rail prose, drop pages<=1 early return,
# toolbar mount-as-sibling warning, toolbar centering note, new
# Filter Coupling section, bbox button race-safe handlers, inline
# IDP Payload Contract → cross-link to kognitos-idp-payload skill).
git diff skills/kognitos-app-development/references/document-preview.md

git add skills/kognitos-idp-payload skills/kognitos-app-development/references/document-preview.md
git commit -m "Add kognitos-idp-payload skill; cross-link from document-preview.md"
git push -u origin add-kognitos-idp-payload-skill

gh pr create \
  --title "Add kognitos-idp-payload skill; fix document-preview.md template gaps" \
  --body "$(cat /Users/georgewilliams/cursor_projects/p2p-ent-app/docs/upstream-pr/kognitos-plugin/PR-DESCRIPTION.md)"
```

## Provenance

- Reference adapter source is a clean lift of
  `lib/kognitos/idp-invoice-field-highlights.ts` in the parent repo.
- Fixture matrix is derived from this app's `docs/idp-invoice-pdf-highlights.md`
  plus production runs surfaced through the diagnostics route.
- Plugin SHA captured at time of staging:
  `152d5eb49c51247e0b60b826874b8a9ffd9242b4`. If the upstream SHA has
  moved by the time this PR is filed, rebase the patch against the
  new HEAD and verify the `document-preview.md` line numbers in the
  hunk headers still align.
- This staged tree is the output of the
  [`docs/kognitos-plugin-feedback.md`](../../kognitos-plugin-feedback.md)
  entry titled "`document-preview.md` defaults diverge from the
  canonical viewer's chrome / hover semantics" graduating to upstream
  filing.
