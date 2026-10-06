import { describe, expect, it, vi } from 'vitest'
import {
  accumulate,
  type Gateway,
  type Options,
  type Pull,
  type Run,
} from '../src/main.ts'

const options: Options = {
  repository: 'owner/repo',
  branch: 'feature/dependencies',
  author: 'dependabot[bot]',
  requiredJobs: ['Dependency checks'],
}
function fixture(): {
  event: Run
  gateway: Gateway
  pull: Pull
  calls: string[]
} {
  const calls: string[] = []
  const pull: Pull = {
    number: 12,
    state: 'open',
    draft: false,
    author: 'dependabot[bot]',
    mergeable: true,
    headSha: 'head',
    baseSha: 'base',
    baseBranch: 'feature/dependencies',
    headRepository: 'owner/repo',
  }
  const event: Run = {
    id: 25,
    attempt: 1,
    event: 'pull_request',
    conclusion: 'success',
    headSha: 'head',
    headRepository: 'owner/repo',
    candidates: [{ number: 12, headSha: 'head', baseSha: 'base' }],
  }
  const gateway: Gateway = {
    frozen: vi.fn((): Promise<boolean> => Promise.resolve(false)),
    pull: vi.fn((): Promise<Pull> => Promise.resolve(pull)),
    baseSha: vi.fn((): Promise<string> => Promise.resolve('base')),
    runs: vi.fn((): Promise<Run[]> => Promise.resolve([event])),
    jobs: vi.fn(
      (): Promise<{ name: string; status: string; conclusion: string }[]> =>
        Promise.resolve([
          {
            name: 'Dependency checks',
            status: 'completed',
            conclusion: 'success',
          },
        ]),
    ),
    merge: vi.fn((): Promise<boolean> => {
      calls.push('merge')
      return Promise.resolve(true)
    }),
    dispatch: vi.fn((): Promise<void> => {
      calls.push('dispatch')
      return Promise.resolve()
    }),
  }
  return { event, gateway, pull, calls }
}

describe('dependency accumulator', (): void => {
  it('merges only validated head and dispatches checks', async (): Promise<void> => {
    const f = fixture()
    expect(await accumulate(f.event, f.gateway, options)).toContain(
      'Merged PR #12; checks dispatched',
    )
    expect(f.calls).toEqual(['merge', 'dispatch'])
  })
  it.each(['event', 'conclusion', 'repository'])(
    'ignores unrelated %s',
    async (key): Promise<void> => {
      const f = fixture()
      if (key === 'event') f.event.event = 'push'
      if (key === 'conclusion') f.event.conclusion = 'failure'
      if (key === 'repository') f.event.headRepository = 'other/repo'
      expect(await accumulate(f.event, f.gateway, options)).toEqual([
        'Ignored unrelated or unsuccessful workflow run',
      ])
      expect(f.calls).toEqual([])
    },
  )
  it('freezes during aggregate review', async (): Promise<void> => {
    const f = fixture()
    f.gateway.frozen = vi.fn((): Promise<boolean> => Promise.resolve(true))
    expect(await accumulate(f.event, f.gateway, options)).toEqual([
      'Accumulator frozen by open aggregate pull request',
    ])
  })
  it.each([
    'state',
    'draft',
    'author',
    'baseBranch',
    'headRepository',
    'candidateHead',
    'candidateBase',
    'runHead',
    'baseSha',
  ])('rejects changed identity %s', async (key): Promise<void> => {
    const f = fixture()
    if (key === 'state') f.pull.state = 'closed'
    if (key === 'draft') f.pull.draft = true
    if (key === 'author') f.pull.author = 'other'
    if (key === 'baseBranch') f.pull.baseBranch = 'main'
    if (key === 'headRepository') f.pull.headRepository = 'other/repo'
    if (key === 'candidateHead')
      f.event.candidates[0] = { number: 12, headSha: 'other', baseSha: 'base' }
    if (key === 'candidateBase')
      f.event.candidates[0] = { number: 12, headSha: 'head', baseSha: 'other' }
    if (key === 'runHead') f.event.headSha = 'other'
    if (key === 'baseSha')
      f.gateway.baseSha = vi.fn((): Promise<string> => Promise.resolve('other'))
    expect(await accumulate(f.event, f.gateway, options)).toContain(
      'Skipped PR #12: identity changed',
    )
    expect(f.calls).toEqual([])
  })
  it.each(['noRun', 'newRun', 'newAttempt', 'failedRun'])(
    'requires latest successful attempt %s',
    async (key): Promise<void> => {
      const f = fixture()
      if (key === 'noRun')
        f.gateway.runs = vi.fn((): Promise<Run[]> => Promise.resolve([]))
      if (key === 'newRun')
        f.gateway.runs = vi.fn((): Promise<Run[]> =>
          Promise.resolve([{ ...f.event, id: 26 }, f.event]),
        )
      if (key === 'newAttempt')
        f.gateway.runs = vi.fn((): Promise<Run[]> =>
          Promise.resolve([{ ...f.event, attempt: 2 }, f.event]),
        )
      if (key === 'failedRun')
        f.gateway.runs = vi.fn((): Promise<Run[]> =>
          Promise.resolve([{ ...f.event, conclusion: 'failure' }]),
        )
      expect(await accumulate(f.event, f.gateway, options)).toContain(
        'Skipped PR #12: superseded run',
      )
    },
  )
  it.each(['missing', 'failed', 'incomplete'])(
    'requires completed check %s',
    async (key): Promise<void> => {
      const f = fixture()
      if (key === 'missing')
        f.gateway.jobs = vi.fn((): Promise<[]> => Promise.resolve([]))
      if (key === 'failed')
        f.gateway.jobs = vi.fn(
          (): Promise<{ name: string; status: string; conclusion: string }[]> =>
            Promise.resolve([
              {
                name: 'Dependency checks',
                status: 'completed',
                conclusion: 'failure',
              },
            ]),
        )
      if (key === 'incomplete')
        f.gateway.jobs = vi.fn(
          (): Promise<{ name: string; status: string; conclusion: string }[]> =>
            Promise.resolve([
              {
                name: 'Dependency checks',
                status: 'queued',
                conclusion: 'success',
              },
            ]),
        )
      expect(await accumulate(f.event, f.gateway, options)).toContain(
        'Skipped PR #12: check missing',
      )
    },
  )
  it.each(['head', 'base', 'mergeable', 'frozen', 'branch'])(
    'rechecks merge gate %s',
    async (key): Promise<void> => {
      const f = fixture()
      if (key === 'head')
        f.gateway.pull = vi
          .fn()
          .mockResolvedValueOnce(f.pull)
          .mockResolvedValueOnce({ ...f.pull, headSha: 'other' })
      if (key === 'base')
        f.gateway.pull = vi
          .fn()
          .mockResolvedValueOnce(f.pull)
          .mockResolvedValueOnce({ ...f.pull, baseSha: 'other' })
      if (key === 'mergeable') f.pull.mergeable = false
      if (key === 'frozen')
        f.gateway.frozen = vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true)
      if (key === 'branch')
        f.gateway.baseSha = vi
          .fn()
          .mockResolvedValueOnce('base')
          .mockResolvedValueOnce('other')
      expect(await accumulate(f.event, f.gateway, options)).toContain(
        'Skipped PR #12: merge gate changed',
      )
    },
  )
  it('fails when GitHub declines merge', async (): Promise<void> => {
    const f = fixture()
    f.gateway.merge = vi.fn((): Promise<boolean> => Promise.resolve(false))
    await expect(accumulate(f.event, f.gateway, options)).rejects.toThrow(
      'GitHub did not merge',
    )
  })
  it('reports no candidates', async (): Promise<void> => {
    const f = fixture()
    f.event.candidates = []
    expect(await accumulate(f.event, f.gateway, options)).toEqual([
      'No eligible dependency pull request',
    ])
  })
})
