# 在浏览器打开仓库

## 目标

提供一条无参数命令：读取当前工作区的 git origin，规范成可在浏览器打开的 http(s) URL，用系统默认浏览器打开。不在 git 仓库或没有 origin 时必须明确提示，禁止静默失败。

## 已确认范围

- 斜杠命令 id 是 `gitweb`。输入 `/gitweb` 且后面不带文字时宿主直接执行。带文字不会执行。
- 命令面板不另做入口。斜杠和命令面板共用 `contributes.commands[].id`。
- 插件 id：`io.github.w1ndys.pi-open-git-web`。
- 显示名：在浏览器打开仓库。版本 `0.1.0`。
- 作者 `w1ndys`，许可证 MIT，`engines.piDesktop` 为 `>=0.9.0`。
- 分类：`productivity`、`developer-tools`。
- 只认 `origin`。没有 origin 就失败，不弹选择，不改用其他 remote。
- 不复制剪贴板，不声明 `clipboard.write`。
- 权限只声明 `shell.openExternal` 和 `notify`。提示用 `pi.ui.showToast`。
- 本版不发布到插件市场。

## 读取规则

- 工作区只用 `pi.workspace.get()` 的 `path`（主根）。
- 没有工作区或路径为空时提示「当前没有工作目录，先打开一个项目。」不调用 git，不打开浏览器。
- git 命令必须是 `/usr/bin/git -C <工作区绝对路径> config --get-all remote.origin.url`。
- 取第一条非空行。不用 `git remote get-url`，不用 `git config --get`，忽略 `remote.origin.pushurl`。
- 通过 `node:child_process` 的 `execFile` 传参数数组，不经过 shell。超时 5 秒。不读 `.git/`。

## 失败提示

- 找不到 `/usr/bin/git`：`GIT_MISSING`，提示「找不到 /usr/bin/git，无法读取远程地址。」
- 超时：`GIT_TIMEOUT`，提示「读取 origin 超时。」
- stderr 含 `not a git repository`：`NOT_A_REPO`，提示「当前目录不是 git 仓库。」
- 退出码 1 且没有地址，或成功但地址为空：`NO_ORIGIN`，提示「当前仓库没有 origin。」
- 其他非零：`GIT_FAILED`，提示「读取 origin 失败。」不把 stderr 贴进提示。
- 地址不能变成网页：能安全认出协议时提示「这个 origin 不能打开成网页（协议）。」，否则提示「这个 origin 不能打开成网页。」协议标记不得带用户名或口令。
- 浏览器抛错或返回失败对象：提示「浏览器没有打开。」
- 成功提示必须是「已在浏览器打开 」加上同一个 URL。

## 地址规则

- 不写死 github.com。GitHub、GitLab、Gitea、CNB 走同一套主机规则。
- `user@host:path`：冒号后整段都是路径，不解析端口。变成 `https://host/` 加清理后的路径。绝对路径保留。
- `ssh://`、`git+ssh://`、`git://`：转成 https，去掉用户名，丢掉协议端口。
- 已是 `http://` 或 `https://`：保留协议、主机和端口，去掉用户信息、查询串、片段。
- 去掉结尾的一个小写 `.git` 和尾斜杠。路径中间的 `.git` 保留。
- 主机为空、路径为空、`file://`、本地路径或其他协议：失败，不调用 `openExternal`。
- IPv6 主机本轮直接失败。
- Azure DevOps 这类网页路径和 git 路径不一致的站点不做特殊处理。
- 成功时 `pi.shell.openExternal` 只接收规范后的 http(s) 地址。失败路径不得调用它。

## 不做

- 不重新选择命令名、仓库名、remote 语义或剪贴板行为。
- 不读 `.git/config`。
- 不把 ssh URL 直接交给 `openExternal`。
- 不在提示或打开的 URL 里留下用户名、口令、token。
