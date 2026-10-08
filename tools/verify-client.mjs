/**
 * Offline verification for the dsh-git-change client bundle.
 *
 * Reproduces what the DSH browser module system does with `client.js`
 * (classic script → `__ModuleLoader__.load({id, factory})` → materialize),
 * then drives the registered component through React in jsdom — including the
 * hover state — so a broken bundle never reaches the live GUI.
 *
 * Usage: node tools/verify-client.mjs [node_modules dir with react/jsdom]
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DEPS = process.argv[2] || '/tmp/gc-render/node_modules'
const req = createRequire(path.join(DEPS, 'noop.js'))

const step = (name) => console.log('  ✓ ' + name)

// ---------------------------------------------------------------- 1. bundle
let registration = null
const fakeWindow = { __ModuleLoader__: { load: (value) => { registration = value } } }
const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
new Function('window', source)(fakeWindow)
assert.ok(registration, 'bundle never called window.__ModuleLoader__.load')
assert.equal(registration.id, 'dsh-git-change', 'bundle id must equal the package name')
assert.equal(typeof registration.factory, 'function')
step('bundle registers factory with id "dsh-git-change"')

// ------------------------------------------------------------- 2. materialize
const React = req('react')
const ReactDOMClient = req('react-dom/client')
const { act } = req('react-dom/test-utils')
const { JSDOM } = req('jsdom')

const seed = { react: React }
const misses = []
const mod = registration.factory((spec) => {
  if (Object.prototype.hasOwnProperty.call(seed, spec)) return seed[spec]
  misses.push(spec)
  throw new Error(`require("${spec}") missed the module table`)
})
assert.deepEqual(misses, [], 'bundle required modules outside the platform seed table')
assert.equal(typeof mod.apply, 'function', 'exports.apply missing — did the factory forget `return module.exports`?')
assert.ok(Array.isArray(mod.inject), 'exports.inject must be an array')
for (const service of ['slots', 'connection']) {
  assert.ok(mod.inject.includes(service), `exports.inject must declare the "${service}" service`)
}
step('factory materializes: apply + inject = ' + JSON.stringify(mod.inject))

// ------------------------------------------------------------------ 3. apply
let captured = null
let injectedKey = null
const ctx = {
  connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
  slots: {
    inject(key, callback) {
      injectedKey = key
      return callback()
    },
    register(options, Component) {
      captured = { options, Component }
      return () => {}
    },
  },
}
mod.apply(ctx)
assert.equal(injectedKey, 'conversation.input.right')
assert.ok(captured, 'slots.register was never called')
assert.equal(captured.options.name, 'conversation.input.right')
assert.equal(captured.options.id, 'dsh-git-change/badge')
const injected = captured.options.inject('session-1')
assert.equal(injected.sessionId, 'session-1')
assert.ok(injected.connection, 'slot inject must forward ctx.connection')
step('apply() registers into conversation.input.right and forwards props')

// ------------------------------------------------------------- 4. react render
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const host = dom.window.document.getElementById('root')
const root = ReactDOMClient.createRoot(host)
const Component = captured.Component

const status = { isRepo: true, branch: 'main', filesChanged: 8, added: 126, deleted: 43 }
let rpcCalls = 0
const makeConnection = (value) => ({
  rpc: {
    call: async (channel, endpoint, payload) => {
      rpcCalls += 1
      assert.equal(channel, '/dsh-git-change', 'channel must be slash-prefixed')
      assert.equal(endpoint, 'status')
      assert.equal(payload.sessionId, 's1')
      return value
    },
  },
})

await act(async () => {
  root.render(React.createElement(Component, { sessionId: 's1', connection: makeConnection({ ok: true, value: status }) }))
})
assert.ok(rpcCalls >= 1, 'component did not call the host RPC on mount')
assert.equal(host.querySelectorAll('svg').length, 1, 'git icon did not render')
step('renders the git icon after the host answers (rpc channel /dsh-git-change)')

await act(async () => {
  host.firstChild.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }))
})
const text = host.textContent || ''
for (const fragment of ['main', '8 files changed', '+126', '-43']) {
  assert.ok(text.includes(fragment), `tooltip is missing "${fragment}" (got: ${text})`)
}
assert.equal(host.querySelectorAll('svg').length, 2, 'tooltip should repeat the branch glyph')
step('hover shows branch / changed files / +added -deleted')

// ------------------------------------------------------- 5. hidden outside git
for (const value of [{ ok: true, value: { isRepo: false } }, { ok: false, error: { code: 'x', message: 'y', details: {} } }]) {
  await act(async () => {
    root.render(React.createElement(Component, { sessionId: 's1', connection: makeConnection(value) }))
  })
  assert.equal(host.innerHTML, '', 'badge must render nothing outside a git work tree')
}
step('renders nothing outside a git work tree (and on RPC failure)')

await act(async () => root.unmount())
console.log('\nclient bundle verified: 5/5 checks passed')
