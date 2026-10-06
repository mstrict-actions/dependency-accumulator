export interface Pull {
  number: number
  state: string
  draft: boolean
  author: string
  mergeable: boolean | null
  headSha: string
  baseSha: string
  baseBranch: string
  headRepository: string
}
export interface Run {
  id: number
  attempt: number
  event: string
  conclusion: string | null
  headSha: string
  headRepository: string
  candidates: { number: number; headSha: string; baseSha: string }[]
}
export interface Job {
  name: string
  status: string
  conclusion: string | null
}
export interface Gateway {
  frozen(): Promise<boolean>
  pull(number: number): Promise<Pull>
  baseSha(): Promise<string>
  runs(headSha: string): Promise<Run[]>
  jobs(runId: number): Promise<Job[]>
  merge(number: number, sha: string): Promise<boolean>
  dispatch(): Promise<void>
}
export interface Options {
  repository: string
  branch: string
  author: string
  requiredJobs: string[]
}

export async function accumulate(
  event: Run,
  gateway: Gateway,
  options: Options,
): Promise<string[]> {
  const messages: string[] = []
  if (
    event.event !== 'pull_request' ||
    event.conclusion !== 'success' ||
    event.headRepository !== options.repository
  ) {
    return ['Ignored unrelated or unsuccessful workflow run']
  }
  if (await gateway.frozen()) {
    return ['Accumulator frozen by open aggregate pull request']
  }
  for (const candidate of event.candidates) {
    const pull = await gateway.pull(candidate.number)
    if (
      pull.state !== 'open' ||
      pull.draft ||
      pull.author !== options.author ||
      pull.baseBranch !== options.branch ||
      pull.headRepository !== options.repository ||
      candidate.headSha !== pull.headSha ||
      candidate.baseSha !== pull.baseSha ||
      event.headSha !== pull.headSha ||
      (await gateway.baseSha()) !== pull.baseSha
    ) {
      messages.push(
        `Skipped PR #${candidate.number.toString()}: identity changed`,
      )
      continue
    }
    const runs = await gateway.runs(pull.headSha)
    const newest = runs
      .filter((item): boolean =>
        item.candidates.some((link): boolean => link.number === pull.number),
      )
      .sort((a, b): number =>
        b.id !== a.id ? b.id - a.id : b.attempt - a.attempt,
      )[0]
    if (
      newest?.id !== event.id ||
      newest.attempt !== event.attempt ||
      newest.conclusion !== 'success'
    ) {
      messages.push(
        `Skipped PR #${candidate.number.toString()}: superseded run`,
      )
      continue
    }
    const jobs = await gateway.jobs(event.id)
    if (
      options.requiredJobs.some(
        (name): boolean =>
          !jobs.some(
            (job): boolean =>
              job.name === name &&
              job.status === 'completed' &&
              job.conclusion === 'success',
          ),
      )
    ) {
      messages.push(`Skipped PR #${candidate.number.toString()}: check missing`)
      continue
    }
    const current = await gateway.pull(pull.number)
    if (
      current.headSha !== pull.headSha ||
      current.baseSha !== pull.baseSha ||
      current.mergeable !== true ||
      (await gateway.frozen()) ||
      (await gateway.baseSha()) !== pull.baseSha
    ) {
      messages.push(
        `Skipped PR #${candidate.number.toString()}: merge gate changed`,
      )
      continue
    }
    if (!(await gateway.merge(pull.number, pull.headSha))) {
      throw new Error(
        'GitHub did not merge the validated dependency pull request',
      )
    }
    await gateway.dispatch()
    messages.push(
      `Merged PR #${candidate.number.toString()}; checks dispatched`,
    )
  }
  return messages.length > 0
    ? messages
    : ['No eligible dependency pull request']
}
