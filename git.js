/**
 * Git status collection for the composer badge.
 *
 * Everything goes through the system `git` binary spawned per request, with
 * `-z` framing and a fixed C locale so parsing never depends on user config.
 * Read-only commands only; `GIT_OPTIONAL_LOCKS=0` keeps them from taking the
 * index lock while the user is working.
 *
 * Scope is "what I changed on this branch": commits this branch itself made
 * and has not pushed (first-parent, merges skipped — work a merge brought in
 * is somebody else's, and reporting it turns "I merged" into "I changed 400
 * lines"), plus the working tree, plus untracked files. Per file the count is
 * a net diff between "before my first commit touching it" and "my last one",
 * so repeated edits of one file do not accumulate.
 */
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const GIT_TIMEOUT_MS = 4000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const MAX_UNTRACKED_FILES = 200
const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024
const MAX_OWN_COMMITS = 200
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

/**
 * Parse `--numstat -z` output (rename entries carry two extra NUL segments).
 * Returns the line totals plus the set of paths that actually differ.
 */
function parseNumstatZ(out) {
  const parts = out.split('\0')
  let added = 0
  let deleted = 0
  const paths = new Set()
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (!seg) continue
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(seg)
    if (!match) continue
    if (match[1] !== '-') added += Number(match[1])
    if (match[2] !== '-') deleted += Number(match[2])
    if (match[3] !== '') {
      paths.add(match[3])
    } else {
      // rename: the next two NUL segments are the old and new path
      const newPath = parts[i + 2]
      if (newPath) paths.add(newPath.replace(/^\n/, ''))
      i += 2
    }
  }
  return { added, deleted, paths }
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

/** Working tree against HEAD — staged and unstaged together. */
async function readWorktreeChanges(cwd) {
  const againstHead = await runGit(cwd, ['diff', 'HEAD', '--numstat', '-z'])
  if (againstHead.ok) return parseNumstatZ(againstHead.stdout)
  // Unborn HEAD (fresh `git init`): fold index-vs-empty and worktree-vs-index.
  const [cached, unstaged] = await Promise.all([
    runGit(cwd, ['diff', '--cached', '--numstat', '-z']),
    runGit(cwd, ['diff', '--numstat', '-z']),
  ])
  const a = parseNumstatZ(cached.stdout)
  const b = parseNumstatZ(unstaged.stdout)
  return {
    added: a.added + b.added,
    deleted: a.deleted + b.deleted,
    paths: new Set([...a.paths, ...b.paths]),
  }
}

/**
 * Commits this branch made but has not pushed, oldest first:
 * [{ hash, firstParent, files }].
 *
 * First-parent only and merges skipped — a merge commit's diff mixes other
 * people's work with the merge resolution, so it cannot be attributed. The
 * first parent lets the caller tell consecutive commits from ones separated
 * by a merge. The \x01 prefix marks hash tokens in the NUL-framed stream.
 */
async function readOwnCommits(cwd) {
  const log = await runGit(cwd, [
    'log',
    '--first-parent',
    '--no-merges',
    '--format=\x01%H %P',
    '--name-only',
    '-z',
    '-n',
    String(MAX_OWN_COMMITS),
    '@{upstream}..HEAD',
  ])
  if (!log.ok) return []
  const commits = []
  let current = null
  for (const token of log.stdout.split('\0')) {
    if (token === '') continue
    if (token.charCodeAt(0) === 1) {
      const identity = token.slice(1).split(' ')
      current = { hash: identity[0], firstParent: identity[1] || null, files: [] }
      commits.push(current)
    } else if (current !== null) {
      current.files.push(token.replace(/^\n/, ''))
    }
  }
  commits.reverse() // git log is newest-first; we walk oldest-first
  return commits
}

/**
 * Net effect of your own unpushed commits, per file counted once.
 *
 * For every file your commits touched, its touching commits are split into
 * runs of consecutive first-parent commits: a run's diff spans the parent of
 * its first commit to its last, so edits within one run net out. A merge
 * between two runs breaks the range on purpose — diffing across it would
 * sweep in whatever the merge brought to that file. Files only a merge
 * brought in never enter the list and are not queried at all.
 */
async function readOwnCommitChanges(cwd) {
  const totals = { added: 0, deleted: 0, paths: new Set() }
  const commits = await readOwnCommits(cwd)
  if (commits.length === 0) return totals

  const touched = new Map() // file -> [commit, ...] oldest-first
  for (const commit of commits) {
    for (const file of commit.files) {
      if (!touched.has(file)) touched.set(file, [])
      touched.get(file).push(commit)
    }
  }

  const groups = new Map() // "from to" -> { from, to, files }
  for (const [file, list] of touched) {
    let start = list[0]
    let end = list[0]
    const flush = () => {
      const key = `${start.hash} ${end.hash}`
      if (!groups.has(key)) groups.set(key, { from: start.hash, to: end.hash, files: [] })
      groups.get(key).files.push(file)
    }
    for (let i = 1; i < list.length; i++) {
      if (list[i].firstParent === end.hash) {
        end = list[i]
      } else {
        flush()
        start = end = list[i]
      }
    }
    flush()
  }

  const diffs = await Promise.all(
    [...groups.values()].map((group) =>
      runGit(cwd, [
        'diff',
        `${group.from}^`,
        group.to,
        '--numstat',
        '-z',
        '--',
        ...group.files,
      ]),
    ),
  )
  for (const diff of diffs) {
    if (!diff.ok) continue
    const part = parseNumstatZ(diff.stdout)
    totals.added += part.added
    totals.deleted += part.deleted
    for (const path of part.paths) totals.paths.add(path)
  }
  return totals
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

  const [branch, worktree, own, untrackedList] = await Promise.all([
    readBranch(cwd),
    readWorktreeChanges(cwd),
    readOwnCommitChanges(cwd),
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

  const files = new Set([...own.paths, ...worktree.paths, ...untrackedPaths])

  return {
    isRepo: true,
    branch,
    filesChanged: files.size,
    added: own.added + worktree.added + untrackedLines,
    deleted: own.deleted + worktree.deleted,
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
