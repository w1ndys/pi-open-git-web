/**
 * 入口层：注册 gitweb，编排读路径、读 origin、规范化和打开浏览器。
 * 失败只 toast，不调用 openExternal。
 */

const { readWorkspacePath } = require("./data/workspace");
const { readOriginRaw } = require("./data/git-remote");
const {
  requireWorkspace,
  resolveOpenUrl,
  isOpenableWebUrl,
  successMessage,
  interpretBrowserResult,
} = require("./business/open-repo");
const { failResult } = require("./entity/open-result");

/** 斜杠命令 id。后面不带文字时宿主直接执行。 */
const COMMAND_ID = "gitweb";

/** 命令面板标题。斜杠和面板共用同一个 id。 */
const COMMAND_TITLE = "在浏览器打开仓库";

/**
 * 读主根和 origin，得到可打开的网页地址或失败结果。
 * @param {{ get: function(): Promise<{ path?: string } | null> }} workspaceApi
 * @param {Function} [execFileImpl]
 */
async function planBrowserOpen(workspaceApi, execFileImpl) {
  const dir = await readWorkspacePath(workspaceApi);
  const missing = requireWorkspace(dir);
  // 没有工作目录时不调用 git，也不打开浏览器
  if (missing) {
    return missing;
  }
  const raw = await readOriginRaw(dir, execFileImpl);
  return resolveOpenUrl(dir, raw);
}

/**
 * 按计划打开。失败路径不会调用 openExternal。
 * @param {{ workspace: { get: Function }, shell: { openExternal: Function }, ui: { showToast: Function }, execFile?: Function }} deps
 */
async function runGitwebWith(deps) {
  const planned = await planBrowserOpen(deps.workspace, deps.execFile);
  // git 或地址不合法时只提示
  if (!planned.ok) {
    await deps.ui.showToast(planned.message);
    return planned;
  }
  // 再挡一次，ssh 地址不能交给宿主
  if (!isOpenableWebUrl(planned.url)) {
    const refused = failResult("NOT_WEB", "这个 origin 不能打开成网页。");
    await deps.ui.showToast(refused.message);
    return refused;
  }
  let opened;
  try {
    opened = await deps.shell.openExternal(planned.url);
  } catch (_error) {
    // 宿主抛错也算浏览器没打开
    const failed = failResult("BROWSER_FAILED", "浏览器没有打开。");
    await deps.ui.showToast(failed.message);
    return failed;
  }
  const browser = interpretBrowserResult(opened);
  // 返回失败对象同样不报成功
  if (browser) {
    await deps.ui.showToast(browser.message);
    return browser;
  }
  await deps.ui.showToast(successMessage(planned.url));
  return planned;
}

/**
 * 插件加载：挂上无参数命令。
 */
async function onLoad() {
  await pi.commands.register({
    id: COMMAND_ID,
    title: COMMAND_TITLE,
    run: async function () {
      await runGitwebWith({
        workspace: pi.workspace,
        shell: pi.shell,
        ui: pi.ui,
      });
    },
  });
}

/**
 * 插件卸载：摘掉命令。
 */
async function onUnload() {
  await pi.commands.unregister(COMMAND_ID);
}

module.exports = { onLoad, onUnload, planBrowserOpen, runGitwebWith };
