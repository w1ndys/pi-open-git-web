# 角落按钮：技术设计

本文件只记录已拍板方案，不另起设计。做法照 `pi-open-in-vscode` 的 `specs/workspace-only/`（同一套宿主事实），只换方法名、文案与探测方式。

## 宿主事实（PI-Desktop 0.16.1 打包代码 + 真机）

1. 自绘层（`pi.ui.openLayer()`）挂在**窗口**上，不随页面切换消失，显示与否必须自己判。
2. 对话框在设置页下**仍然挂载**（只是被设置页盖住）→ 插槽（`composerControl`）的卸载回调**不会触发**，所以不能用插槽判断页面。
3. 定时任务页、插件页会卸载 `ChatSurface`，但热重载留下的旧层已经没人能关。
4. 可用的判据：`document.querySelectorAll(".composer-shell")` 里存在一个「真的露在屏幕上」的输入框 —— `getBoundingClientRect()` 有尺寸，且用左半中点（`x = left + width*0.3, y = top + height/2`，避开右下角自己那颗按钮）做 `elementFromPoint` 命中它自己或它的子孙；并且不在设置页（`.app-shell.settings-mode`）。
5. `elementFromPoint` 会跳过 `pointer-events: none` 的元素——我们的层必须保持盒子 `pointer-events: none`、只有按钮 `auto`，否则命中测试会测到自己。
6. `pi.workspace.get()` 是**窗口级**的项目根，与会话无关；临时会话拿不到任何可用目录。
7. `plugin.call` 不校验用户手势（`composer.*` 那几个才校验），所以挂载/切页面时的探测是合法的。`plugin.call` 只能调 `manifest.rendererCallMethods` 里列的方法名，载荷必须是对象 `{ method, args }`。

## 改动

| 文件 | 职责 |
|---|---|
| `renderer/index.mjs` | 盯 DOM 决定显示、探测是否有可打开的 origin、按结果开或收层；`onLoad` 先清残留层 |
| `renderer/corner.mjs` | 角落按钮：四个状态、en/zh-CN 文案表、定时复位 |
| `renderer/styles.mjs` | 角落按钮样式（自绘层） |
| `main.js` | 新增 `onRendererCall(method, args)`：`hasGitRemote` 探测、`openGitWeb` 复用 `runGitwebWith`，其余拒绝 |
| `manifest.json` | 增加 `renderer` / `rendererActions` / `rendererCallMethods`，`permissions` 加 `renderer.extension`，加 `activationEvents`，同步 description / changelog / safetyNotes / i18n |
| `test/renderer.test.mjs` | 渲染器单测：假 DOM + 假 MutationObserver |
| `test/renderer-call.test.js` | 主进程按钮入口单测：探测、缓存、打开 |

## 关键决定

- **探测与打开分成两个方法**：显示按钮前不能先真打开一次，所以给一个只读的 `hasGitRemote`；`openGitWeb` 复用现有的 `runGitwebWith`（读 origin、规范化、`openExternal`、toast）。探测失败按「没有可打开的 origin」处理——少一个入口，好过画一颗点不开的按钮。
- **探测按工作目录缓存**：读 origin 要 spawn 一次 `/usr/bin/git`，比读项目根贵得多。`main.js` 记住上一次 `{ dir, hasRemote }`，目录没变就直接复用；目录变了或缓存为空（含 `openGitWeb` 之后主动清空）才真跑一次。点击时重新读一次 origin，保证改了 origin 立刻生效。
- **打开之后清缓存**：点一次若打不开，按钮会先留原因再收掉；下一次探测必须按**新的** origin 重新判断，否则旧结论会让按钮马上又画回来。
- **页面判断改盯 DOM，不再靠插槽**：插槽的挂载不代表「正在看对话」（设置页下对话框仍挂载），而自绘层又不随页面消失，所以判据换成「宿主渲染出输入框」＋「输入框真的露在外面」。命中测试（`elementFromPoint`）同时覆盖被整页界面盖住、被挤出视口、被压成零宽三种情况；`.app-shell.settings-mode` 是给设置页留的第二道保险。
- **切会话不订阅事件，靠两处兜住**：输入框换了就立刻重新探测（换会话通常重挂输入框），没换时最多每 1.5 秒重新问一次；点击时发现打不开就把按钮收掉（先留原因，稍后收起）。
- **加载时清残留层**：热重载会重新加载模块，上一轮实例开出来的层没人能关，留着就会出现在所有页面上；`onLoad` 先把 `.pogw-corner` 元素摘掉，再按当前页面决定要不要画。
- **类名带插件前缀**：角落按钮用 `.pogw-corner` / `.pogw-corner-btn`，与 `pi-open-in-vscode` 的 `.pov-corner` 分开，避免两个插件的残留层清理互相抓。

- **右下角按钮带，而不是各画各的**：宿主没有角落槽位（0.16.1 的 `rendererSlots` 只有 `userAction` / `assistantAction` / `entryExtra` / `toolCard` / `blockRenderer` / `composerControl` / `composerTrigger`；`pi.ui.openLayer()` 给每个插件一个独立的 0×0 fixed 层，`injectStyle` 又把样式 `@scope` 到本插件自己的 `data-pi-plugin` 上，宿主 CSS 里的 `.p-overlay__corner` 在 JS 里没人用）。两个插件各自 `inset:0` + `justify-content:flex-end`，必然落在同一个像素上——和 `pi-open-in-vscode` 的按钮真机重叠就是这么来的。解法是插件之间的约定：按钮带 `data-pi-corner-button` 标记，按 DOM 顺序从下往上排，靠后的按下面几颗的高度 `translateY` 让位。每颗按钮只给自己让位、不碰别家元素，两个插件各算一次结果一致；`translateY` 只改绘制，不影响别家量到的 `getBoundingClientRect().height`。**要根治还是得宿主给一个 corner 槽位**（已提 [vastsa/PI-Desktop#1469](https://github.com/vastsa/PI-Desktop/issues/1469)），约定只是在那之前的办法。

## 已知限制

- 同一目录里改了 origin，按钮的显示与否不会自己对齐（探测按工作目录缓存，1.5 秒后的那次重问命中的是缓存）；要切到别的项目目录、或重载插件才会重新读。已经显示的按钮**点击时一定重新读**，所以不会打开旧地址。
- 会话切走之后、按钮还在时点一次会先失败一次（按钮才收掉），因为渲染器收不到「会话切了」的通知；但换输入框、切页面都会重新探测，最多 1.5 秒按钮就回到正确状态。
- 判断页面用的是宿主自己的类名（`.composer-shell`、`.app-shell.settings-mode`）。宿主改样式表就得跟着改，这是这一版唯一的脆弱点；没有更稳的信号可用。

## 检查

`npm run check`：`node --check` 全部 js/mjs，再跑 `node --test`（业务层、主进程入口、主进程按钮入口、渲染器模块）。渲染器测试用测试内的假 DOM 与假 `MutationObserver`，不启动宿主；页面判断的各条分支（没有输入框、设置页盖住、输入框没尺寸、命中点是输入框里面的元素、从别的页面切回来、探测为否、探测被拒、点一次失败后收按钮）都在这一份里断言。
