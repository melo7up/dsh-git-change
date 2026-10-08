/**
 * Git status collection for the composer badge.
 *
 * Everything goes through the system `git` binary spawned per request, with
 * `-z` framing and a fixed C locale so parsing never depends on user config.
 * Read-only commands only; `GIT_OPTIONAL_LOCKS=0` keeps them from taking the
 * index lock while the user is working.
 *
 * Scope is the badge's scope: staged + unstaged changes against HEAD, plus
 * untracked files (counted as added lines). Deliberately bounded — a huge
 * untracked tree must not turn a hover into a multi-second scan.
 */
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const GIT_TIMEOUT_MS = 4000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const MAX_UNTRACKED_FILES = 200
const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024
const CACHE_TTL_MS = 1500

/** @typedef {{ isRepo: false } | {
 *   isRepo: true, branch?: string, filesChanged: number,
 *   added: number, deleted: number, truncated?: boolean,
 * }} GitStatus */

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'color.ui=false', '--no-pager', ...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_PAGER: 'cat',
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C',
        },
      },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    )
  })
}

/** Parse `--numstat -z` output (rename entries carry two extra NUL segments). */
function parseNumstatZ(out) {
  const parts = out.split('\0')
  let files = 0
  let added = 0
  let deleted = 0
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (!seg) continue
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(seg)
    if (!match) continue
    files += 1
    if (match[1] !== '-') added += Number(match[1])
    if (match[2] !== '-') deleted += Number(match[2])
    if (match[3] === '') i += 2
  }
  return { files, added, deleted }
}

async function readBranch(cwd) {
  const abbrev = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const name = abbrev.stdout.trim()
  if (abbrev.ok && name && name !== 'HEAD') return name
  const symbolic = await runGit(cwd, ['symbolic-ref', '--short', 'HEAD'])
  const short = symbolic.stdout.trim()
  if (symbolic.ok && short) return short
  const hash = await runGit(cwd, ['rev-parse', '--short', 'HEAD'])
  const sha = hash.stdout.trim()
  return hash.ok && sha ? sha : undefined
}

async function readTrackedChanges(cwd) {
  const againstHead = await runGit(cwd, ['diff', 'HEAD', '--numstat', '-z'])
  if (againstHead.ok) return parseNumstatZ(againstHead.stdout)
  // Unborn HEAD (fresh `git init`): fold index-vs-empty and worktree-vs-index.
  const [cached, worktree] = await Promise.all([
    runGit(cwd, ['diff', '--cached', '--numstat', '-z']),
    runGit(cwd, ['diff', '--numstat', '-z']),
  ])
  const a = parseNumstatZ(cached.stdout)
  const b = parseNumstatZ(worktree.stdout)
  return { files: a.files + b.files, added: a.added + b.added, deleted: a.deleted + b.deleted }
}

/** Count lines without materialising a decoding pass; `null` = not countable. */
async function countLines(absPath) {
  let info
  try {
    info = await stat(absPath)
  } catch {
    return null
  }
  if (!info.isFile()) return null
  if (info.size > MAX_UNTRACKED_FILE_BYTES) return 'oversized'
  let buf
  try {
    buf = await readFile(absPath)
  } catch {
    return null
  }
  if (buf.includes(0)) return 'binary'
  let lines = 0
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines += 1
  if (buf.length > 0 && buf[buf.length - 1] !== 10) lines += 1
  return lines
}

/** @returns {Promise<GitStatus>} */
export async function collectGitStatus(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return { isRepo: false }

  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.stdout.trim() !== 'true') return { isRepo: false }

  const [branch, tracked, untrackedList] = await Promise.all([
    readBranch(cwd),
    readTrackedChanges(cwd),
    runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])

  const untrackedPaths = untrackedList.stdout.split('\0').filter(Boolean)
  let untrackedFiles = 0
  let untrackedLines = 0
  let truncated = false
  for (const path of untrackedPaths) {
    if (untrackedFiles >= MAX_UNTRACKED_FILES) {
      truncated = true
      break
    }
    untrackedFiles += 1
    const lines = await countLines(join(cwd, path))
    if (typeof lines === 'number') untrackedLines += lines
    else if (lines === 'oversized') truncated = true
  }

  return {
    isRepo: true,
    branch,
    filesChanged: tracked.files + untrackedFiles,
    added: tracked.added + untrackedLines,
    deleted: tracked.deleted,
    ...(truncated ? { truncated: true } : {}),
  }
}

const cache = new Map()

/** Same as {@link collectGitStatus} with a short TTL so hovers do not stampede. */
export async function collectGitStatusCached(cwd) {
  const now = Date.now()
  const hit = cache.get(cwd)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value
  const value = await collectGitStatus(cwd)
  cache.set(cwd, { at: now, value })
  return value
}
