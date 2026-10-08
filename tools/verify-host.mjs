/**
 * Offline verification for the dsh-git-change host half.
 *
 * Loads the plugin module, drives `apply()` with a stub context that mirrors
 * the real registration path — including the fact that
 * `connection.rpc.handle()` registers its route through `owner.webServer`,
 * where `owner` is the reading context — then calls the handler directly.
 *
 * Usage: node tools/verify-host.mjs [git work tree to query]
 */
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const WORKTREE = process.argv[2] || '/tmp/gc-test'

const step = (name) => console.log('  ✓ ' + name)

const mod = await import(pathToFileURL(path.join(ROOT, 'index.js')).href)
assert.equal(mod.name, 'dsh-git-change')
step('module loads and exports name = ' + mod.name)

// ------------------------------------------------------------------ stub ctx
let channel = null
let handler = null
const effects = []
const registered = []

const services = {
  webServer: {
    register(route) {
      registered.push(route)
      return async () => {}
    },
  },
  sessions: {
    get: (id) => (id === 'known' ? { header: { cwd: WORKTREE } } : undefined),
  },
  // Service name only; the reading context below supplies the real object.
  connection: {},
}

/** A reading context; `handle()` must find webServer on THIS object. */
const readingContext = (extra) => {
  const ctx = {
    ...extra,
    get: (name) => services[name],
    effect(callback, label) {
      effects.push(label)
      return callback()
    },
  }
  ctx.connection = {
    rpc: {
      handle(name, fn) {
        if (ctx.webServer === undefined) {
          throw new Error('cannot get property "webServer" without inject')
        }
        ctx.webServer.register({ path: name })
        channel = name
        handler = fn
        return async () => {}
      },
      intercept() {
        throw new Error('intercept is reserved for /api')
      },
    },
  }
  return ctx
}

const root = {
  inject(names, callback) {
    for (const name of names) {
      assert.ok(name in services, `apply() injected an unknown service: ${name}`)
    }
    return callback({ get: (name) => services[name], extend: (extra) => readingContext(extra) })
  },
}

mod.apply(root)
assert.equal(channel, '/dsh-git-change', 'channel must be slash-prefixed')
assert.equal(typeof handler, 'function')
assert.equal(registered.length, 1, 'the RPC route must be registered through ctx.webServer')
step('apply() registers RPC on "/dsh-git-change" via ctx.webServer (no inject error)')

// -------------------------------------------------------------- handler calls
const ok = await handler('status', { sessionId: 'known' })
assert.equal(ok.ok, true, JSON.stringify(ok))
assert.equal(ok.value.isRepo, true)
assert.equal(typeof ok.value.filesChanged, 'number')
assert.equal(typeof ok.value.added, 'number')
assert.equal(typeof ok.value.deleted, 'number')
assert.ok(typeof ok.value.branch === 'string' && ok.value.branch.length > 0)
step(`status → ${JSON.stringify(ok.value)}`)

const unknownEndpoint = await handler('nope', { sessionId: 'known' })
assert.equal(unknownEndpoint.ok, false)
assert.equal(unknownEndpoint.error.code, 'unknown-endpoint')
assert.equal(typeof unknownEndpoint.error.message, 'string')
assert.equal(typeof unknownEndpoint.error.details, 'object')
step('unknown endpoint answers { ok:false, error:{code,message,details} }')

for (const payload of [{ sessionId: 'missing' }, {}]) {
  const refused = await handler('status', payload)
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'cwd-unavailable')
}
step('unknown/absent session answers cwd-unavailable (no throw)')

console.log('\nhost half verified: 5/5 checks passed')
