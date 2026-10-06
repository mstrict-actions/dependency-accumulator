# Agent guide

This repository implements the dependency accumulator for a trusted GitHub
workflow. It consumes a `workflow_run` event and may merge Dependabot pull
requests into a review branch. Review permissions and event trust whenever
behavior changes.

## Change procedure

Inspect Git status, the package scripts, action metadata and tests. Keep the
domain policy, API adapter, tests, documentation, and bundled `dist` aligned.
Run `npm ci`, `npm run check:ci`, and `npm run build` on the supported Node
major. After committing a new bundle, run `npm run check-dist`. Use English
Conventional Commits.

When pushing, read the CI, Version and both CodeQL results for the pushed
commit. Tags do not certify checks. Keep the package lock in sync without
overrides.

## Trust contract

The completion workflow runs on the default branch with write permissions. Its
code must remain trusted. Do not checkout or run contributed pull request code.
Verify repository identity, bot author, head and base SHAs, current accumulator
ref, latest run attempt, required jobs and mergeability before merging. An open
aggregate PR freezes collection. A successful `GITHUB_TOKEN` merge must dispatch
branch checks explicitly.

Use strict project checks. Keep narrow, explained exceptions local; assertions
and non-null assertions remain forbidden. Standalone tests exercise both fresh
and committed bundles outside `node_modules`.

## Specialized instructions

- For workflow creation, edits, or review, read
  [github-actions-hardening](.agents/skills/github-actions-hardening/SKILL.md).
- For Action/runtime upgrades, read
  [github-actions-runtime-upgrade-conventions](.agents/skills/github-actions-runtime-upgrade-conventions/SKILL.md).
- For CodeQL configuration or alerts, read
  [codeql](.agents/skills/codeql/SKILL.md).
- For this guide or skills, read
  [writing-for-agents](.agents/skills/writing-for-agents/SKILL.md).

[Skill provenance](.agents/README.md) records the fixed snapshots. Pin external
Actions to full commit SHAs with version comments.
