# 变更记录

## 0.2.0

- **新增对话界面右下角的常驻按钮**：点一次就在默认浏览器打开当前仓库。命令 `/gitweb` 保留，两条入口共用同一条打开路径与同一句提示。
- 按钮改成**盯 DOM 决定显示**：宿主渲染出输入框（`.composer-shell`）且该输入框确实露在屏幕上（左半中点做一次命中测试）才画；离开对话界面（设置页、定时任务页、插件页，或输入框消失）立刻收起。模块因此不注册任何插槽、也不依赖 react，只用 `MutationObserver` 盯 DOM 变化并合并成一次检查，另外在加载时清掉上一次残留的层。
- 不用插槽判断页面的原因（读宿主代码 + 真机确认）：自绘层挂在窗口上、不随页面切换消失；而切到设置页时对话框的 DOM 仍挂在树上（只是被设置页盖住），插槽的卸载回调根本不触发。
- 画按钮前先探测一次：渲染器派发 `plugin.call` 的 `hasGitRemote`（插件主进程只读一次 origin），只有能规范成 http(s) 才画；没有工作目录、没有 origin、origin 不能变成网页，或探测失败都不画。探测按工作目录缓存，目录没变就不重复跑 git，避免每次 DOM 变动都拉起 `/usr/bin/git`。
- 点击按钮时**重新读一次** origin（不读缓存），保证改了 origin 立刻生效；点完清掉探测缓存，收了按钮不会被旧结论画回来。
- 点击打不开时先把原因留在按钮的悬停提示上（`失败` 态），约 2.8 秒后再把按钮收掉；按钮没显示期间最多每 1.5 秒重新探测一次。
- 角落按钮的文案表带 en / zh-CN 两份，按应用语言选，界面上不留写死的可见文案。
- 新增跨插件的「右下角按钮带」约定：角落按钮带 `data-pi-corner-button` 标记，同窗口里所有这类按钮按 DOM 顺序从右下角往上排，靠后的按下面几颗的高度用 `transform: translateY()` 让位。宿主没有角落槽位（`rendererSlots` 里没有 corner，`pi.ui.openLayer()` 又是每个插件一层），两个插件各画各的就一定重叠——和 `pi-open-in-vscode` 的按钮真机撞上就是这么来的。
- `manifest`：新增 `renderer` / `rendererActions` / `rendererCallMethods`，`permissions` 加 `renderer.extension`，补上 `activationEvents: ["onStartup", "onCommand:gitweb"]`（按钮要在启动时就挂），`engines.piDesktop` 提到 `>=0.15.9`。
- 新增渲染器模块单测与主进程按钮入口单测；`npm run check` 同时检查 `.mjs`。

## 0.1.0

- 首个版本：命令 `/gitweb` 读取当前仓库 origin，在默认浏览器打开对应网页。
- 只读 `remote.origin.url` 的原始 fetch 地址，规范成 http(s) 后去掉用户名和口令。
- 没有工作目录、不是 git 仓库或没有 origin 时明确提示，不静默失败。
