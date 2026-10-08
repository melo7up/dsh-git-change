/**
 * dsh-git-change — host half.
 *
 * Registers one RPC channel the browser half calls: `status` resolves the
 * calling Session's working directory from its header and answers with the
 * git summary of that directory. Read-only throughout.
 *
 * Registration detail worth keeping: `ctx.connection.rpc.handle()` ends in
 * `owner.effect(() => owner.webServer.register(route))`, where `owner` is the
 * *reading* context. Cordis therefore needs `webServer` present on that very
 * context — declaring it in `inject` alone is not enough, the route dies with
 * `cannot get property "webServer" without inject`. The fix is the same one
 * dsh-mnemon uses: extend the scoped context with the services it must reach.
 */
import { collectGitStatusCached } from './git.js'

export const name = 'dsh-git-change'

/** RPC channels must be slash-prefixed and may not use the reserved `/api`. */
const CHANNEL = '/dsh-git-change'

function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/** The Session header carries the working directory the turn ran in. */
function resolveSessionCwd(sessions, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  try {
    const session = sessions.get(sessionId)
    const cwd = session === undefined || session.header === undefined ? undefined : session.header.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}

export function apply(ctx) {
  ctx.inject(['connection', 'webServer', 'sessions'], (scoped) => {
    const owner = scoped.extend({
      webServer: scoped.get('webServer'),
      sessions: scoped.get('sessions'),
    })

    return owner.effect(
      () =>
        owner.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
          if (endpoint !== 'status') return failure('unknown-endpoint', `Unknown endpoint: ${endpoint}`)

          const sessionId = payload && typeof payload === 'object' ? payload.sessionId : undefined
          const cwd = resolveSessionCwd(owner.sessions, sessionId)
          if (cwd === undefined) {
            return failure('cwd-unavailable', 'The Session working directory is unknown.')
          }

          try {
            return { ok: true, value: await collectGitStatusCached(cwd) }
          } catch (error) {
            return failure('git-failed', error instanceof Error ? error.message : String(error))
          }
        }),
      'dsh-git-change: git status RPC',
    )
  })
}
