// 用法: node asar-grep.mjs <asar> <文件路径正则> <内容正则> [最多命中数]
import fs from 'node:fs'
const [, , archive, patSub, pattern, maxArg] = process.argv
const max = Number(maxArg || 40)
const fd = fs.openSync(archive, 'r')
const b = Buffer.alloc(16)
fs.readSync(fd, b, 0, 16, 0)
const headerSize = b.readUInt32LE(12)
const hb = Buffer.alloc(headerSize)
fs.readSync(fd, hb, 0, headerSize, 16)
const header = JSON.parse(hb.toString('utf8'))
const base = 16 + headerSize
const files = []
;(function walk(node, prefix) {
  for (const [n, v] of Object.entries(node.files || {})) {
    const p = prefix + '/' + n
    if (v.files) walk(v, p, files)
    else files.push({ p, size: v.size, offset: v.offset })
  }
})(header, '')
const sub = new RegExp(patSub)
const re = new RegExp(pattern, 'g')
let hits = 0
for (const f of files) {
  if (!sub.test(f.p) || f.size > 8_000_000 || f.size === 0) continue
  if (!Number.isFinite(Number(f.offset))) continue
  const buf = Buffer.alloc(f.size)
  fs.readSync(fd, buf, 0, f.size, base + Number(f.offset))
  const lines = buf.toString('utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    if (re.test(lines[i])) {
      console.log(`${f.p}:${i + 1}: ${lines[i].trim().slice(0, 260)}`)
      if (++hits >= max) process.exit(0)
    }
  }
}
