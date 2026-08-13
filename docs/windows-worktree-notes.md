# Windows + git worktree 下的 bun install 坑

这份文档记录一个具体环境问题的症状、根因和修法，不是设计决策——遇到同样报错时直接跳到"修法"。

## 症状

在 `.claude/worktrees/<分支名>/` 这类比较深的路径下（尤其分支名长，比如
`legacy-invitation-module-analysis-6f7d1b`），`bun install` / `bun add` 用默认的
isolated linker 时，个别包会报：

```
ENOENT: No such file or directory: failed to link package: @tanstack/react-query@5.101.4 (copyfile)
ENOENT: No such file or directory: failed to link package: @tanstack/router-plugin@1.168.25 (copyfile)
```

这几个包**不是**下载失败——`bun pm cache rm` 清缓存、`rm -rf node_modules` 重装，报错原样复现。看 `--verbose` 输出能看到 bun 已经从全局 cache 里正确解出了这个包（`package.json`、`build/` 都在），失败的是最后一步"从 cache 硬链接到 `node_modules/.bun/<pkg>+<hash>/node_modules/<pkg>`"这个 copyfile 调用本身。

## 根因

isolated linker 用的是内容寻址 store（`node_modules/.bun/@scope+name@version+hash/node_modules/name`），路径本身就比传统 hoisted 布局长一截；叠加 worktree 路径（`.claude/worktrees/<长分支名>/apps/web/node_modules/...`），个别包体积较大、目录结构较深的（`react-query`、`router-plugin` 这类），copyfile 在这台机器上会失败。不是网络问题，也不是这几个包本身有问题——同样的包在浅路径下装是正常的。

## 修法

**这个 worktree 里所有 `bun install` / `bun add` 都带上 `--linker=hoisted`：**

```bash
bun install --linker=hoisted
bun add <pkg> --linker=hoisted   # 装新依赖同理
```

**不要中途在 isolated 和 hoisted 之间切换。** 混用过一次（比如先用默认 isolated 装到一半失败，又换 hoisted 重装，中间还跑过 `bunx shadcn add` 这种自带一次安装的命令）之后，`apps/web/node_modules/` 下会残留一份指向 `.bun` store 的多余 `react` 符号链接，跟根目录 `node_modules/react` 分别被 Vite 解析成**两个不同的模块实例**——即使两个符号链接指向完全相同的版本号，也会导致：

```
Invalid hook call. Hooks can only be called inside of the body of a function component.
...
Uncaught TypeError: Cannot read properties of null (reading 'useEffect')
```

这是 React 内部 dispatcher 状态跟着"哪个模块实例"走、而不是跟着"哪个版本"走导致的经典重复 React 症状，页面直接白屏或者一堆报错，`rm -rf apps/web/node_modules/.vite` 清 Vite 的依赖预打包缓存也不解决（因为问题出在 node_modules 布局本身，不是缓存）。

**一旦出现这种"到处都是 Invalid hook call"的报错，直接重装，不要单独删某个包：**

```bash
rm -rf node_modules apps/web/node_modules apps/server/node_modules
bun install --linker=hoisted
```

装完可以验证一下没有残留的重复副本：

```bash
find apps/web/node_modules apps/server/node_modules -maxdepth 1 -iname "react"
# 应该没有输出——react 只应该存在于根目录 node_modules/react
```

## 适用范围

这是**这台机器 + 深路径 worktree**的组合问题，不是仓库配置的问题——不需要往仓库里加 `bunfig.toml` 强制全局用 hoisted linker（那会改变所有贡献者的依赖解析行为，且在浅路径/非 Windows 环境下没有必要）。浅路径的正常仓库检出（比如直接在 `E:\workspace\pszx-hdyy\` 下，不经过 `.claude\worktrees\...`）大概率不会碰到这个问题。
