#!/bin/sh
# 从 desktop profile 卸载 dsh-git-change（重启 DSH 后生效）
set -e
P="$HOME/.dsh/profiles/desktop"
node -e "
const fs = require('node:fs')
const p = process.env.HOME + '/.dsh/profiles/desktop/package.json'
const j = JSON.parse(fs.readFileSync(p, 'utf8'))
delete j.dependencies['dsh-git-change']
j.dsh.profile.bundles = j.dsh.profile.bundles.filter((b) => b !== 'dsh-git-change')
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n')
console.log('已从 profile 移除；bundles =', JSON.stringify(j.dsh.profile.bundles))
"
cd "$P" && node "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs" install 2>&1 | tail -2
echo "完成：重启 DSH 后插件不再加载"
