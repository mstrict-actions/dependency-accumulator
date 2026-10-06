# Dependency accumulator

A GitHub Action that merges eligible Dependabot pull requests into a review
branch only after checking the exact current head, base, latest workflow
attempt, required jobs, and mergeability. An open aggregate pull request freezes
collection. A successful merge dispatches the checks workflow because a merge
made with `GITHUB_TOKEN` does not trigger a normal push workflow.

Call this Action from a `workflow_run` completion workflow on the default
branch. Provide a token with `contents: write`, `pull-requests: write`, and
`actions: write`. The workflow must not checkout or execute the completed pull
request. Pin `uses:` to a tested commit SHA. Inputs are documented in
`action.yml`.

Source policy is in `src/main.ts`; the GitHub API adapter is in `src/index.ts`.
Development commands are in `package.json`. Read `AGENTS.md` before changing
permissions or trust boundaries.
