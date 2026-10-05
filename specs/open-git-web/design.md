# 在浏览器打开仓库：技术设计

本文件只记录已拍板方案，不另起设计。

## 分层

| 文件 | 职责 |
|---|---|
| `entity/open-result.js` | 成功带 `url`，失败带 `code` 和 `message` |
| `data/workspace.js` | 只读主根路径 |
| `data/git-remote.js` | 只执行 git，返回退出码、stdout、stderr、启动错误 |
| `business/open-repo.js` | 纯函数：判断绝对路径、分类 git 结果、规范化 URL。不执行命令 |
| `main.js` | 注册和注销 `gitweb`，编排上述层，toast |
| `test/open-repo.test.js` | `node:test`。注入假的 git 执行器 |

单函数不超过 50 行（不含空行和注释）。用 `function` 声明，不用箭头函数。每个文件、函数、常量、分支有中文短注释。

## 编排

1. `readWorkspacePath` 取 `pi.workspace.get().path`。
2. 路径不是绝对路径时返回 `NO_WORKSPACE`，到此停止。
3. `readOriginRaw` 调用：

```text
/usr/bin/git -C <工作区绝对路径> config --get-all remote.origin.url
```

超时 5000 毫秒，`encoding` 为 `utf8`，不设置 `shell`。

4. `classifyGitResult` 按下面顺序判断：超时、`ENOENT`、stderr 含 `not a git repository`、退出码 0 或 1 且没有地址、其他非零。
5. `normalizeOriginUrl` 单向规范化，不还原成原来的 ssh 地址。
6. 只有结果 `ok` 且地址以 `http://` 或 `https://` 开头时，才调用 `pi.shell.openExternal`。
7. 抛错、返回 `ok: false`、`success: false`、非空 `code` 或 `error` 字符串，都提示「浏览器没有打开。」
8. 成功提示和打开使用同一个 URL 字符串。

## git 原始结果

```text
{ exitCode, stdout, stderr, spawnError, timedOut }
```

- 正常退出：`exitCode` 为 0，`spawnError` 为 null。
- 超时：`timedOut` 为 true，`spawnError` 为 `ETIMEDOUT`。Node 的表现是 `killed`、`signal === "SIGTERM"`、`code` 为空。
- 找不到二进制：`spawnError` 为 `ENOENT`。
- git 非零退出：`exitCode` 为数字。

stdout 取第一条非空行。多值时不用最后一条。

## URL 规范化

- 无 `://` 且匹配 `user@host:path`：主机取 `@` 和第一个冒号之间，路径是冒号后整段。拼成 `https://host/` 加去掉首斜杠后的清理路径。`git@host:/srv/git/foo.git` 得到 `https://host/srv/git/foo`。
- scp 路径里的 `?` 和 `#` 之后丢掉，避免 token 进入浏览器。这不是端口解析。
- `ssh:`、`git+ssh:`、`git:`：用 URL 解析器取主机和路径，转 https，不用 `username`、`password`、`port`、`search`、`hash`。
- `http:`、`https:`：保留协议、主机和解析器给出的端口，重建地址，不用用户信息、查询串和片段。
- 清理：反复去掉尾斜杠，再去掉结尾的一个小写 `.git`。
- 主机为空、含 `:`、含 `[` 或含 `@`：失败。因此 IPv6 本轮失败。
- 其他协议：失败。协议标记来自 `://` 前的安全字符，转小写后放进括号。
- 不写死任何代码托管域名，也不为 Azure DevOps 改路径。

## 权限和清单

`manifest.json` 从第一版写满：`schemaVersion`、`id`、`name`、`version`、`description`、`author`、`license`、`homepage`、`categories`、`changelog`、顶层 `safetyNotes`、`engines.piDesktop`、`permissions`、`main`、`contributes.commands`。

`i18n.en` 和 `i18n.zh-CN` 都有非空的 `name`、`description`、`safetyNotes`。命令 `title` 是字符串，并带 `keywords` 和 `category: "Developer"`。

`safetyNotes` 说明：只读 origin 原始地址，规范成 http(s) 后用默认浏览器打开；不读 `.git` 目录，不写文件，不访问网络，不读写剪贴板；用户名和口令会在打开前去掉。

## 检查

`npm run check` 对每个 js 文件执行 `node --check`，再执行 `node --test`。

测试覆盖：scp、ssh 带端口、GitLab 子组、https 自定义端口、带 token 的 https、`git://`、`file://`、无 origin、非仓库、找不到 git、超时。不真开浏览器，不依赖本机仓库。
