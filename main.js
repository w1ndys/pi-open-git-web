/**
 * 入口层：注册 gitweb，编排读路径、读 origin、规范化和打开浏览器。
 * 失败只 toast，不调用 openExternal。
 * 另外给界面上的角落按钮两个方法：探测（hasGitRemote）与打开（openGitWeb）。
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

/** 角落按钮用的方法名，必须与 manifest.rendererCallMethods 一致。 */
const OPEN_ACTION = "openGitWeb";

/** 按钮显示前的探测方法名；同样要出现在 manifest.rendererCallMethods 里。 */
const PROBE_ACTION = "hasGitRemote";

/**
 * 探测缓存：按工作目录记住上一次的结论。
 * 读 origin 要 spawn 一次 /usr/bin/git，比读项目根贵得多，所以目录没变就不重复跑。
 * dir 为 null 表示「没有缓存」；openGitWeb 之后会清空它，保证点击后按新的 origin 重新判断。
 */
const probeCache = { dir: null, hasRemote: false };

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
 * 读一次工作目录，宿主报错也当没有。
 * 只读主根，不猜临时会话的目录。
 * @returns {Promise<string | null>}
 */
async function readDirOrNull() {
  try {
    return await readWorkspacePath(pi.workspace);
  } catch (_error) {
    // 宿主读不到工作区：当没有，绝不去猜一个目录出来
    return null;
  }
}

/**
 * 真读一次 origin，判断能不能规范成可打开的 http(s) 地址。
 * 任何失败都当「没有可打开的 origin」，按钮那边就不画。
 * @param {string} dir
 * @param {Function} [execFileImpl]
 * @returns {Promise<boolean>}
 */
async function resolveHasRemote(dir, execFileImpl) {
  let raw = null;
  try {
    raw = await readOriginRaw(dir, execFileImpl);
  } catch (_error) {
    // git 拉不起来就当没有 origin
    raw = null;
  }
  const planned = resolveOpenUrl(dir, raw);
  // 只有规范成 http(s) 才算可打开
  return planned.ok === true && isOpenableWebUrl(planned.url);
}

/**
 * 探测这次对话有没有可打开的 origin。
 * 只读，不打开浏览器、也不弹提示；按工作目录缓存，目录没变就直接复用结论。
 * @param {Function} [execFileImpl] 测试注入的执行器
 * @returns {Promise<{ ok: true, hasRemote: boolean }>}
 */
async function probeGitRemote(execFileImpl) {
  const dir = await readDirOrNull();
  // 没有绝对路径就当没有：一次 git 都不跑
  if (requireWorkspace(dir)) {
    clearProbeCache();
    return { ok: true, hasRemote: false };
  }
  // 目录没变就直接用缓存，免得每次 DOM 变动都拉起 git
  if (probeCache.dir === dir) {
    return { ok: true, hasRemote: probeCache.hasRemote };
  }
  const hasRemote = await resolveHasRemote(dir, execFileImpl);
  probeCache.dir = dir;
  probeCache.hasRemote = hasRemote;
  return { ok: true, hasRemote: hasRemote };
}

/**
 * 清掉探测缓存，让下一次探测重新读一遍 origin。
 */
function clearProbeCache() {
  probeCache.dir = null;
  probeCache.hasRemote = false;
}

/**
 * 按钮入口：探测与打开各一个方法，不认识的直接拒绝，不猜意图。
 * @param {unknown} method manifest.rendererCallMethods 里的方法名
 * @param {unknown} args 按钮不传参数
 * @param {Function} [execFileImpl] 测试注入的执行器
 */
async function onRendererCall(method, args, execFileImpl) {
  // 画按钮前先问有没有可打开的 origin，这一条不打开任何东西、也不弹提示
  if (method === PROBE_ACTION) {
    return probeGitRemote(execFileImpl);
  }
  // 不认识的方法直接拒绝
  if (method !== OPEN_ACTION) {
    return failResult("UNKNOWN_METHOD", "不支持的操作。");
  }
  const result = await runGitwebWith({
    workspace: pi.workspace,
    shell: pi.shell,
    ui: pi.ui,
    execFile: execFileImpl,
  });
  // 点完清掉缓存：下次探测按新的 origin 重新判断，收了按钮不会被旧结论画回来
  clearProbeCache();
  return result;
}

/**
 * 插件加载：挂上无参数命令。界面按钮由 renderer/index.mjs 自己画。
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

module.exports = {
  onLoad,
  onUnload,
  onRendererCall,
  planBrowserOpen,
  runGitwebWith,
  probeGitRemote,
  clearProbeCache,
  COMMAND_ID,
  COMMAND_TITLE,
  OPEN_ACTION,
  PROBE_ACTION,
};
