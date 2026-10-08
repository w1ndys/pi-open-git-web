# 在浏览器打开仓库

PI-Desktop 插件（`io.github.w1ndys.pi-open-git-web`）：读取当前工作区 origin 的原始地址，在默认浏览器打开对应网页。

仓库：https://github.com/w1ndys/pi-open-git-web

## 使用

1. 安装或加载本插件。
2. 打开一个 git 项目，且该仓库有 `origin`。
3. **点对话界面右下角的常驻按钮**，或输入 `/gitweb` 回车（后面不能带文字，否则宿主不会执行）。

命令面板搜「在浏览器打开仓库」也可以。斜杠和命令面板共用命令 id `gitweb`，和角落按钮走同一条打开路径、同一句提示。

按钮**只在对话界面里出现**：切到设置页、定时任务页、插件页会自动收起，回到对话界面又回来。没有工作目录、没有 origin，或 origin 不能规范成 http(s) 时也不显示。

## 按钮什么时候显示

自绘层挂在窗口上，**不随页面切换消失**，所以显示与否由插件自己盯页面判断。模块在加载时开一个 `MutationObserver`，把 DOM 变动合并成一次检查，三个条件同时满足才画按钮：

1. 宿主渲染出了输入框（`.composer-shell`）——说明现在真的是对话界面；
2. 输入框确实露在屏幕上（左半中点做一次命中测试：没被设置页之类的整页界面盖住、没被挤出视口、有尺寸）；
3. 当前仓库有能规范成 http(s) 的 origin（插件主进程读取判断，拿不到或打不开就不画）。

任一条件不成立就立刻把按钮收掉。按钮没显示期间最多每 1.5 秒重新探测一次（探测按工作目录缓存：切到别的项目、或点过一次失败后缓存作废时才会重新读 origin）；点击打不开时，会先把原因留在按钮的悬停提示上，约 2.8 秒后再把按钮收掉。

## 和别的插件排开（右下角按钮带）

宿主没有「角落」槽位，每个插件都是自己往右下角画，所以位置靠一条跨插件约定协商：**凡是在右下角画常驻按钮的插件，都给按钮加属性 `data-pi-corner-button`**，这样同窗口里所有这类按钮会按 DOM 顺序从下往上排成一列，靠后的按下面几颗按钮的高度往上让位，谁都不压着谁。约定细节（间距 8px、按高度累加、隐藏的按钮跳过、只写自己的样式）见 `specs/corner-button/`。

`pi-open-in-vscode` 的角落按钮也要跟上这条约定，两颗才不会叠在一起。

## 行为

- 只读 `remote.origin.url` 的原始 fetch 地址，命令是 `/usr/bin/git -C <工作区> config --get-all remote.origin.url`，取第一条非空行。
- 不用 `git remote get-url`（会应用 insteadOf），也不用 `git config --get`（多值时返回最后一条）。
- 忽略 `remote.origin.pushurl`。没有 origin 就失败，不改用其他 remote。
- `user@host:path`、`ssh://`、`git+ssh://`、`git://` 会规范成 https。已是 http(s) 的保留协议、主机和端口，并去掉用户信息、查询串和片段。
- 按钮显示前先派发一次 `plugin.call` 探测（`method: "hasGitRemote"`）：只读一次 origin，不打开浏览器、不弹提示。探测按工作目录缓存，目录没变就不重复跑 git；点击按钮时重新读一次 origin，保证改了 origin 立刻生效。
- 按钮通过 `plugin.call` 调 `openGitWeb`，不传参数；除这两条调用外不派发别的动作（`manifest.rendererActions` 只有 `plugin.call`）。
- 不注册任何插槽、不依赖 react：模块只注入样式、自绘一个角落按钮、盯 DOM。也不用 `composer.*` 动作，不往输入框里填任何东西。
- 不读 `.git` 目录，不写文件，不访问网络，不读写剪贴板。

没有工作目录、不是 git 仓库、没有 origin、地址不能变成网页，或浏览器没有打开时，都会用 toast 说明原因，不会静默失败。

## 角落按钮怎么摆的

按钮的实现依据在官方规格里，不是自己拼的：角落浮层走「自绘层」——插件在自己的元素里 `position: fixed` 自画。定位照官方 `renderer-slots/slot-shell.css` 的 `.p-overlay__corner`：铺满视口的 flex 盒子把按钮推到右下角，盒子本身 `pointer-events: none`、只有按钮 `auto`，所以它**不挡**下面的内容。层容器由宿主提供，是零尺寸的 fixed 元素。

## 检查

```bash
npm run check
```

## 权限

声明 `renderer.extension`（自绘角落按钮）、`shell.openExternal`（打开浏览器）和 `notify`（结果提示）。提示用 `pi.ui.showToast`。不声明 `clipboard.write`。

## 市场

0.1.0（纯命令版）已上架：https://plugins.aiuo.net/plugins/io.github.w1ndys.pi-open-git-web

0.2.0 加了 `renderer` 等字段，插件中心的发布接口暂不认这些字段（[vastsa/PI-Desktop#1454](https://github.com/vastsa/PI-Desktop/issues/1454)），所以按钮版只能走 **Load development plugin**，或用 `pi-plugin-publish` 打 store-only 的 `.piplug` 配 GitHub Release 分发。

细节与验收见 `specs/corner-button/`；命令版的行为见 `specs/open-git-web/`。
