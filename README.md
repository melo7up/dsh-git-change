# dsh-git-change

DSH 插件：在输入框（composer）工具行右端、模型选择器左侧显示一枚 git 状态角标。

- **不在 git 仓库里工作区**：整个图标不渲染（不是灰掉，是不出现）。
- **默认**：一枚 14px 的灰色分支图标，无圆底。
- **悬停**：向上弹出浮层 —— 分支名 / 变更文件数 / `+新增` `-删除`（绿/红）。
- **口径**：已跟踪的 staged + unstaged 改动（`git diff HEAD --numstat`）**加上未跟踪文件**（未跟踪文件按整文件行数计入新增）。
- **刷新**：挂载时拉一次；会话状态变化时拉一次（近似"每轮结束"）；每次悬停再拉一次。host 侧另有 1.5s TTL 缓存防止悬停连击。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | host 半：注册 RPC 通道 `/dsh-git-change`，`status` 端点解析会话 cwd 并返回 git 摘要 |
| `git.js` | git 采集（spawn 系统 git，`-z` 分帧，固定 C locale，只读命令，带上限与截断标记） |
| `client.js` | client 半：**手写 bundle**（无构建步骤），把角标注册进 `conversation.input.right` |
| `tools/verify-host.mjs` | host 半离线验证（6 项） |
| `tools/verify-client.mjs` | client bundle 离线验证（5 项：加载协议 / apply / 图标 / 悬停浮层 / 非仓库不渲染） |
| `tools/asar.mjs`、`tools/asar-grep.mjs` | 读 DSH `app.asar` 的小工具（调研用） |

无构建步骤：DSH 的浏览器模块系统只要求 `client.js` 调用一次
`window.__ModuleLoader__.load({ id, factory })`，且 factory **返回** `module.exports`。
`id` 必须等于包名。

## 安装（本机已装，走 bundle 通道）

```bash
# 1) 包放进 profile 能解析的位置（本地开发用 link 依赖）
#    profile/package.json:
#      "dependencies": { "dsh-git-change": "link:/absolute/path/to/dsh-git-change" }
#      "dsh": { "profile": { "bundles": [ ..., "dsh-git-change" ] } }
# 2) 安装（建立软链 + 写入 lockfile）
cd ~/.dsh/profiles/desktop && pnpm install
```

包的 `package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`，该 patch 里用
`- insert:` 把自己挂进配置树。

**注意：不要用 profile `cordis.patch.yml` 的顶层条目挂本地插件。**
用户层的顶层 `- id: x / name: y` 只能"覆盖已存在条目"，新增会被
`patch: entry "x" not found` **静默忽略**（`insert:` 才新增）。

**改完代码要重启 DSH**：一是 profile 的 bundle/patch 层只在启动时装配；
二是 Node 的 ESM 缓存会让运行中的 host 一直用**第一次加载**的模块
（改了 `index.js` 后重载仍报旧行号的错就是这个原因）。

## 回滚

```bash
# 1) 撤销 profile 侧的挂载
cd ~/.dsh/profiles/desktop
node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p));delete j.dependencies['dsh-git-change'];j.dsh.profile.bundles=j.dsh.profile.bundles.filter(b=>b!=='dsh-git-change');fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
pnpm install
# 2) 重启 DSH
```

## 开发与验证

```bash
node tools/verify-client.mjs    # 需要 react/react-dom/jsdom（默认从 /tmp/gc-render/node_modules 取）
node tools/verify-host.mjs      # 可选参数：任意 git 工作区路径，默认 /tmp/gc-test
```

`verify-client.mjs` 复刻 DSH 的加载协议（classic script → `__ModuleLoader__.load` →
materialize），再用 jsdom + 真实 React 跑一遍挂载与悬停，因此 bundle 的语法/协议错误
不会走到线上 GUI（客户端插件加载失败会**阻止整个 Web GUI 挂载**）。

## 已知边界

- **位置会随模型名长度左右漂移**：角标在 `conversation.input.right`，它渲染在模型选择器
  左侧、间距恒为 12px（窄窗口 8px），而整组靠右对齐（`margin-left:auto`），所以模型名越
  长、角标越靠左。模型选择器 `max-width: 220px`。
- **未跟踪文件统计有上限**：最多 200 个文件、单文件 1MB；超限时浮层显示"统计已截断"。
- **二进制未跟踪文件**只计文件数，不计行数。
- **非 live 会话**（历史/归档）拿不到 header，角标不显示。
- 只读操作：`GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`，4 秒超时。
