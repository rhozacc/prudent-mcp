Sync all project documentation to match the current state of the codebase. Do this thoroughly and commit the result.

## What to do

### 1. Survey the current state

Run these in parallel:
- `git log --oneline -20` — recent changes
- `cat package.json` — current version, scripts
- Find and read every markdown file: README.md, CLAUDE.md, CHANGES.md, docs/**/*.md
- Count tools/routes/endpoints/exports — whatever the main API surface of this project is
- Read key source files to understand what actually exists (schemas, tool registrations, config)

### 2. Identify every stale claim

Go through each doc file and flag:
- Version numbers that don't match package.json (or equivalent)
- Feature/tool/API counts that are wrong
- Missing entries for things added since the last doc update
- Examples or URIs using old naming conventions
- Status sections that don't reflect current capability
- "Don't add yet" / "coming soon" items that are now done
- Anything described as in-progress that is now shipped

### 3. Update everything

Fix every stale claim you found. Specifically:
- Bump version strings in docs to match package.json
- Update counts and lists to match what's actually registered/exported
- Add a status/changelog entry describing what changed since the last version
- Update examples, URIs, and code snippets to use current conventions
- Remove or update "planned" markers for shipped features
- Keep the tone and style consistent with the existing doc voice — don't rewrite for its own sake

### 4. Commit

Stage only the documentation files you changed. Write a concise commit message that describes what was updated and why (e.g. "docs: sync to v0.5 — add traversal tools, update check URI scheme").

## Rules

- Read before you edit. Never guess at current state — verify from source.
- Don't rewrite prose that's still accurate. Surgical edits only.
- Don't add padding, marketing language, or sections that don't exist elsewhere in the doc.
- If you find a genuine inconsistency in the code itself (not just the docs), flag it to the user rather than silently papering over it.
- If CHANGES.md or a changelog exists, add an entry. If it doesn't exist and the project has a history of releases, ask whether to create one.
