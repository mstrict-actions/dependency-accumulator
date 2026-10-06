import * as core from '@actions/core'
import * as github from '@actions/github'
import { accumulate, type Gateway, type Pull, type Run } from './main.ts'

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true })
    const branch = core.getInput('branch', { required: true })
    const checksWorkflow = core.getInput('checks-workflow', { required: true })
    const requiredJobs = core
      .getInput('required-jobs', { required: true })
      .split(',')
      .map((name): string => name.trim())
      .filter((name): boolean => name.length > 0)
    if (requiredJobs.length === 0) throw new Error('required-jobs is empty')
    const { owner, repo } = github.context.repo
    const baseInput = core.getInput('base-branch')
    const baseBranch = baseInput.length > 0 ? baseInput : 'main'
    const authorInput = core.getInput('author')
    const author = authorInput.length > 0 ? authorInput : 'dependabot[bot]'
    const client = github.getOctokit(token)
    const raw: unknown = github.context.payload['workflow_run']
    if (raw === undefined) throw new Error('workflow_run event required')
    const normalizePull = (
      pull: Awaited<ReturnType<typeof client.rest.pulls.get>>['data'],
    ): Pull => ({
      number: pull.number,
      state: pull.state,
      draft: pull.draft === true,
      author: pull.user.login,
      mergeable: pull.mergeable,
      headSha: pull.head.sha,
      baseSha: pull.base.sha,
      baseBranch: pull.base.ref,
      headRepository: pull.head.repo.full_name,
    })
    const normalizeRun = (item: unknown): Run => {
      if (typeof item !== 'object' || item === null)
        throw new Error('Invalid workflow run')
      if (
        !('id' in item) ||
        typeof item.id !== 'number' ||
        !('run_attempt' in item) ||
        typeof item.run_attempt !== 'number' ||
        !('event' in item) ||
        typeof item.event !== 'string' ||
        !('conclusion' in item) ||
        !(typeof item.conclusion === 'string' || item.conclusion === null) ||
        !('head_sha' in item) ||
        typeof item.head_sha !== 'string' ||
        !('head_repository' in item) ||
        typeof item.head_repository !== 'object' ||
        item.head_repository === null ||
        !('full_name' in item.head_repository) ||
        typeof item.head_repository.full_name !== 'string' ||
        !('pull_requests' in item) ||
        !Array.isArray(item.pull_requests)
      )
        throw new Error('Invalid workflow run')
      const candidates: Run['candidates'] = []
      const links: unknown[] = Array.from(
        item.pull_requests,
        (value: unknown): unknown => value,
      )
      for (const link of links) {
        if (
          typeof link !== 'object' ||
          link === null ||
          !('number' in link) ||
          typeof link.number !== 'number' ||
          !('head' in link) ||
          typeof link.head !== 'object' ||
          link.head === null ||
          !('sha' in link.head) ||
          typeof link.head.sha !== 'string' ||
          !('base' in link) ||
          typeof link.base !== 'object' ||
          link.base === null ||
          !('sha' in link.base) ||
          typeof link.base.sha !== 'string'
        )
          throw new Error('Invalid run PR association')
        candidates.push({
          number: link.number,
          headSha: link.head.sha,
          baseSha: link.base.sha,
        })
      }
      return {
        id: item.id,
        attempt: item.run_attempt,
        event: item.event,
        conclusion: item.conclusion,
        headSha: item.head_sha,
        headRepository: item.head_repository.full_name,
        candidates,
      }
    }
    const gateway: Gateway = {
      async frozen(): Promise<boolean> {
        const pulls = await client.paginate(client.rest.pulls.list, {
          owner,
          repo,
          state: 'open',
          base: baseBranch,
          per_page: 100,
        })
        return pulls.some(
          (pull): boolean =>
            pull.head.repo.full_name === `${owner}/${repo}` &&
            pull.head.ref === branch,
        )
      },
      async pull(number): Promise<Pull> {
        return normalizePull(
          (await client.rest.pulls.get({ owner, repo, pull_number: number }))
            .data,
        )
      },
      async baseSha(): Promise<string> {
        return (
          await client.rest.git.getRef({ owner, repo, ref: `heads/${branch}` })
        ).data.object.sha
      },
      async runs(headSha): Promise<Run[]> {
        const runs = await client.paginate(
          client.rest.actions.listWorkflowRuns,
          {
            owner,
            repo,
            workflow_id: checksWorkflow,
            head_sha: headSha,
            event: 'pull_request',
            per_page: 100,
          },
        )
        return runs.map((item): Run => normalizeRun(item))
      },
      async jobs(
        runId,
      ): Promise<
        { name: string; status: string; conclusion: string | null }[]
      > {
        const jobs = await client.paginate(
          client.rest.actions.listJobsForWorkflowRun,
          { owner, repo, run_id: runId, filter: 'latest', per_page: 100 },
        )
        return jobs.map(
          (
            job,
          ): { name: string; status: string; conclusion: string | null } => ({
            name: job.name,
            status: job.status,
            conclusion: job.conclusion,
          }),
        )
      },
      async merge(number, sha): Promise<boolean> {
        return (
          await client.rest.pulls.merge({
            owner,
            repo,
            pull_number: number,
            sha,
            merge_method: 'merge',
          })
        ).data.merged
      },
      async dispatch(): Promise<void> {
        await client.rest.actions.createWorkflowDispatch({
          owner,
          repo,
          workflow_id: checksWorkflow,
          ref: branch,
        })
      },
    }
    const messages = await accumulate(normalizeRun(raw), gateway, {
      repository: `${owner}/${repo}`,
      branch,
      author,
      requiredJobs,
    })
    for (const message of messages) core.info(message)
    if (process.env['GITHUB_STEP_SUMMARY'] !== undefined) {
      core.summary.addHeading('Dependency accumulator')
      for (const message of messages) core.summary.addRaw(`${message}\n`)
      await core.summary.write()
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

await run()
