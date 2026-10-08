import fs from 'node:fs'
const archive = process.argv[2]
const fd = fs.openSync(archive, 'r')
const b = Buffer.alloc(16)
fs.readSync(fd, b, 0, 16, 0)
const headerSize = b.readUInt32LE(12)
const hb = Buffer.alloc(headerSize)
fs.readSync(fd, hb, 0, headerSize, 16)
const header = JSON.parse(hb.toString('utf8'))
const base = 16 + headerSize
const mode = process.argv[3]
const out = []
;(function walk(node, prefix) {
  for (const [name, v] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name
    if (v.files) walk(v, p, out)
    else out.push({ p, size: v.size, offset: v.offset })
  }
})(header, '')
if (mode === 'list') {
  const re = process.argv[4] ? new RegExp(process.argv[4]) : null
  for (const f of out) if (!re || re.test(f.p)) console.log(String(f.size).padStart(9), f.p)
} else if (mode === 'cat') {
  const t = out.find(f => f.p === process.argv[4])
  if (!t) { console.error('not found: ' + process.argv[4]); process.exit(1) }
  const buf = Buffer.alloc(t.size)
  fs.readSync(fd, buf, 0, t.size, base + Number(t.offset))
  process.stdout.write(buf)
}
