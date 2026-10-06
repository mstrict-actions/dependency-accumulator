import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let directory: string
beforeAll((): void => {
  directory = mkdtempSync(join(tmpdir(), 'dependency-accumulator-'))
  execFileSync(process.execPath, [
    resolve('build.config.mjs'),
    join(directory, 'fresh.mjs'),
  ])
  copyFileSync(resolve('dist/index.js'), join(directory, 'committed.mjs'))
  writeFileSync(
    join(directory, 'event.json'),
    JSON.stringify({
      workflow_run: {
        id: 1,
        run_attempt: 1,
        event: 'pull_request',
        conclusion: 'success',
        head_sha: 'head',
        head_repository: { full_name: 'other/repo' },
        pull_requests: [],
      },
    }),
  )
})
afterAll((): void => {
  if (typeof directory === 'string')
    rmSync(directory, { recursive: true, force: true })
})
describe.each(['fresh.mjs', 'committed.mjs'])(
  'standalone bundle %s',
  (entry): void => {
    it('handles an unrelated event without installed modules or API calls', (): void => {
      const result = spawnSync(process.execPath, [join(directory, entry)], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_PATH: join(directory, 'event.json'),
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_EVENT_NAME: 'workflow_run',
          'INPUT_GITHUB-TOKEN': 'synthetic-token',
          INPUT_BRANCH: 'feature/dependencies',
          'INPUT_CHECKS-WORKFLOW': 'dependency-checks.yml',
          'INPUT_REQUIRED-JOBS': 'Dependency checks',
          NODE_PATH: '',
        },
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(
        'Ignored unrelated or unsuccessful workflow run',
      )
    })
  },
)
