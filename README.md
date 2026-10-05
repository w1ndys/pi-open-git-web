# 在浏览器打开仓库

PI-Desktop 插件（`io.github.w1ndys.pi-open-git-web`）：读取当前工作区 origin 的原始地址，在默认浏览器打开对应网页。

仓库：https://github.com/w1ndys/pi-open-git-web

## 使用

1. 安装或加载本插件。
2. 打开一个 git 项目，且该仓库有 `origin`。
3. 在输入框输入 `/gitweb` 回车。后面不能带文字，否则宿主不会执行。

命令面板搜「在浏览器打开仓库」也可以。斜杠和命令面板共用命令 id `gitweb`。

## 行为

- 只读 `remote.origin.url` 的原始 fetch 地址，命令是 `/usr/bin/git -C <工作区> config --get-all remote.origin.url`，取第一条非空行。
- 不用 `git remote get-url`（会应用 insteadOf），也不用 `git config --get`（多值时返回最后一条）。
- 忽略 `remote.origin.pushurl`。没有 origin 就失败，不改用其他 remote。
- `user@host:path`、`ssh://`、`git+ssh://`、`git://` 会规范成 https。已是 http(s) 的保留协议、主机和端口，并去掉用户信息、查询串和片段。
- 不读 `.git` 目录，不写文件，不访问网络，不读写剪贴板。

没有工作目录、不是 git 仓库、没有 origin、地址不能变成网页，或浏览器没有打开时，都会用 toast 说明原因，不会静默失败。

## 检查

```bash
npm run check
```

## 权限

只声明 `shell.openExternal` 和 `notify`。提示用 `pi.ui.showToast`。不声明 `clipboard.write`。

## 市场

已上架：https://plugins.aiuo.net/plugins/io.github.w1ndys.pi-open-git-web

在 PI-Desktop 的 **Plugins → Marketplace** 里搜「在浏览器打开仓库」即可安装。
