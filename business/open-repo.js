/**
 * 业务层：判断绝对路径、分类 git 结果、把 origin 规范成网页地址。
 * 纯函数，不执行命令，也不调用浏览器。
 */

const { okResult, failResult } = require("../entity/open-result");

/** 这些远程协议转成 https，并丢掉用户名和端口。 */
const SSH_LIKE_PROTOCOLS = { "ssh:": true, "git+ssh:": true, "git:": true };

/** 已经是网页协议时保留原协议和端口。 */
const WEB_PROTOCOLS = { "http:": true, "https:": true };

/** 协议名只允许这些字符，避免把用户名或口令写进提示。 */
const SAFE_PROTOCOL = /^[a-z][a-z0-9+.-]*$/;

/**
 * 判断能不能交给 git -C 的绝对路径。
 * @param {unknown} dir
 * @returns {boolean}
 */
function isAbsoluteDir(dir) {
  // 空值或非字符串不能当工作目录
  if (typeof dir !== "string" || dir.trim() === "") {
    return false;
  }
  // POSIX 绝对路径
  if (dir.startsWith("/")) {
    return true;
  }
  // Windows 盘符路径
  if (/^[A-Za-z]:[\\/]/.test(dir)) {
    return true;
  }
  // 其余都是相对路径
  return false;
}

/**
 * 没有绝对路径时的失败结果。调用方看到它就不要再执行 git。
 * @param {unknown} dir
 * @returns {{ ok: false, code: string, message: string } | null}
 */
function requireWorkspace(dir) {
  // 相对路径或空路径都不能读 origin
  if (!isAbsoluteDir(dir)) {
    return failResult("NO_WORKSPACE", "当前没有工作目录，先打开一个项目。");
  }
  return null;
}

/**
 * 取第一条非空行，多值 origin 不用最后一条 push 地址。
 * @param {unknown} text
 * @returns {string}
 */
function firstNonEmptyLine(text) {
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    // 跳过空行，避免把后面的地址当成第一条
    if (line !== "") {
      return line;
    }
    index += 1;
  }
  return "";
}

/**
 * 把 git 原始结果分成可继续规范化，或给人看的失败。
 * @param {unknown} raw
 */
function classifyGitResult(raw) {
  // 没有原始结果就不当成「没有 origin」
  if (!raw || typeof raw !== "object") {
    return failResult("GIT_FAILED", "读取 origin 失败。");
  }
  // 超时优先于退出码，避免把杀掉的进程当成普通失败
  if (raw.timedOut === true) {
    return failResult("GIT_TIMEOUT", "读取 origin 超时。");
  }
  // 固定路径的 git 不存在
  if (raw.spawnError === "ENOENT") {
    return failResult("GIT_MISSING", "找不到 /usr/bin/git，无法读取远程地址。");
  }
  const stderr = typeof raw.stderr === "string" ? raw.stderr : "";
  // 不能读 .git 目录，只认 git 自己的这句话
  if (stderr.indexOf("not a git repository") !== -1) {
    return failResult("NOT_A_REPO", "当前目录不是 git 仓库。");
  }
  const url = firstNonEmptyLine(raw.stdout);
  // 键不存在是退出码 1；成功但空行同样没有 origin
  if (!url && (raw.exitCode === 0 || raw.exitCode === 1)) {
    return failResult("NO_ORIGIN", "当前仓库没有 origin。");
  }
  // 其他非零或启动失败。不把可能含口令的 stderr 放进提示
  if (raw.exitCode !== 0 || raw.spawnError) {
    return failResult("GIT_FAILED", "读取 origin 失败。");
  }
  return { ok: true, rawUrl: url };
}

/**
 * 不能打开时的提示。协议名不安全就不加括号。
 * @param {string} protocol
 * @returns {string}
 */
function unsupportedMessage(protocol) {
  const token = typeof protocol === "string" ? protocol.toLowerCase() : "";
  // 只放安全的协议标记，不放用户名或口令
  if (SAFE_PROTOCOL.test(token)) {
    return "这个 origin 不能打开成网页（" + token + "）。";
  }
  return "这个 origin 不能打开成网页。";
}

/**
 * 不能打开成网页。
 * @param {string} protocol
 */
function failNotWeb(protocol) {
  return failResult("NOT_WEB", unsupportedMessage(protocol));
}

/**
 * 去掉尾斜杠，再去掉结尾的一个小写 .git。
 * @param {string} path
 * @returns {string}
 */
function stripRepoSuffix(path) {
  let value = path;
  // 尾斜杠不是仓库名
  while (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  // 只去一个小写 .git，路径中间的 .git 留下
  if (value.endsWith(".git")) {
    value = value.slice(0, -4);
  }
  // .git 去掉后如果还挂着斜杠，再清一次
  while (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  // 只剩根斜杠说明没有仓库路径
  if (value === "/" || value === "") {
    return "";
  }
  return value;
}

/**
 * 主机为空或是 IPv6 时本轮直接失败。
 * @param {string} host
 * @returns {boolean}
 */
function isRejectedHost(host) {
  // 空主机不能拼网页地址
  if (!host) {
    return true;
  }
  // IPv6 本轮不打开
  if (host.indexOf(":") !== -1 || host.indexOf("[") !== -1) {
    return true;
  }
  // 用户名若漏进主机，也不能打开
  if (host.indexOf("@") !== -1) {
    return true;
  }
  return false;
}

/**
 * 拼出 https 地址。protocolHint 只用于失败提示。
 * @param {string} host
 * @param {string} rawPath
 * @param {string} protocolHint
 */
function joinHttps(host, rawPath, protocolHint) {
  // 拒绝空主机和 IPv6，不调用浏览器
  if (isRejectedHost(host)) {
    return failNotWeb(protocolHint);
  }
  const withSlash = rawPath.startsWith("/") ? rawPath : "/" + rawPath;
  const relative = stripRepoSuffix(withSlash).replace(/^\/+/, "");
  // 没有仓库路径就不是可打开的网页
  if (!relative) {
    return failNotWeb(protocolHint);
  }
  return okResult("https://" + host + "/" + relative);
}

/**
 * 保留原网页协议和显式端口，去掉用户信息。
 * @param {string} protocol http 或 https
 * @param {string} host
 * @param {string} port
 * @param {string} rawPath
 */
function joinWeb(protocol, host, port, rawPath) {
  // 网页协议同样拒绝 IPv6 和空主机
  if (isRejectedHost(host)) {
    return failNotWeb(protocol);
  }
  // 端口必须是数字，避免把别的片段拼进去
  if (port && !/^[0-9]+$/.test(port)) {
    return failNotWeb(protocol);
  }
  const withSlash = rawPath.startsWith("/") ? rawPath : "/" + rawPath;
  const relative = stripRepoSuffix(withSlash).replace(/^\/+/, "");
  // 空路径不能打开
  if (!relative) {
    return failNotWeb(protocol);
  }
  const portPart = port ? ":" + port : "";
  return okResult(protocol + "://" + host + portPart + "/" + relative);
}

/**
 * 解析不带 :// 的 user@host:path。冒号后整段都是路径，不解析端口。
 * @param {string} raw
 * @returns {{ host: string, path: string } | null}
 */
function parseScp(raw) {
  const match = /^([^@\s]+)@([^:\s]+):(.+)$/.exec(raw);
  // 不像 scp 地址
  if (!match) {
    return null;
  }
  return { host: match[2], path: match[3] };
}

/**
 * 取出 :// 前的协议名。认不出就返回空串。
 * @param {string} raw
 * @returns {string}
 */
function schemeOf(raw) {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(raw);
  // 没有协议头
  if (!match) {
    return "";
  }
  return match[1];
}

/**
 * scp 路径里的问号和片段不是仓库路径，丢掉以免 token 进浏览器。
 * @param {string} path
 * @returns {string}
 */
function stripScpExtra(path) {
  return path.split(/[?#]/, 1)[0];
}

/**
 * 把一条 origin 规范成 http(s)。失败时不返回可打开的地址。
 * @param {unknown} rawUrl
 */
function normalizeOriginUrl(rawUrl) {
  // 非字符串没有可打开的地址
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return failResult("NO_ORIGIN", "当前仓库没有 origin。");
  }
  const raw = rawUrl.trim();
  // 没有协议头时只认 scp 形式
  if (raw.indexOf("://") === -1) {
    const scp = parseScp(raw);
    // 本地路径或其他写法不能打开
    if (!scp) {
      return failNotWeb("");
    }
    return joinHttps(scp.host, stripScpExtra(scp.path), "");
  }
  const scheme = schemeOf(raw);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    // 协议认得出但地址不合法
    return failNotWeb(scheme);
  }
  const hint = scheme || parsed.protocol.replace(":", "");
  // ssh、git+ssh、git 转 https，丢掉用户名和端口
  if (SSH_LIKE_PROTOCOLS[parsed.protocol]) {
    return joinHttps(parsed.hostname, parsed.pathname, hint);
  }
  // 已是网页地址：留协议和端口，去掉用户信息、查询和片段
  if (WEB_PROTOCOLS[parsed.protocol]) {
    return joinWeb(parsed.protocol.slice(0, -1), parsed.hostname, parsed.port, parsed.pathname);
  }
  return failNotWeb(hint);
}

/**
 * 先看工作目录，再分类 git 结果，最后规范化。
 * @param {unknown} dir
 * @param {unknown} gitRaw
 */
function resolveOpenUrl(dir, gitRaw) {
  const missing = requireWorkspace(dir);
  // 没有绝对路径时不解释 git 输出
  if (missing) {
    return missing;
  }
  const classified = classifyGitResult(gitRaw);
  // git 失败就停，不能拿空地址去打开
  if (!classified.ok) {
    return classified;
  }
  return normalizeOriginUrl(classified.rawUrl);
}

/**
 * 只有规范后的 http(s) 才能交给 openExternal。
 * @param {unknown} url
 * @returns {boolean}
 */
function isOpenableWebUrl(url) {
  // 拒绝 ssh 和其他协议漏出去
  if (typeof url !== "string") {
    return false;
  }
  // 只放行网页协议
  if (url.startsWith("https://") || url.startsWith("http://")) {
    return true;
  }
  return false;
}

/**
 * 成功提示必须带上即将打开的同一个地址。
 * @param {string} url
 * @returns {string}
 */
function successMessage(url) {
  return "已在浏览器打开 " + url;
}

/**
 * 浏览器没打开时的失败结果。
 */
function browserFailure() {
  return failResult("BROWSER_FAILED", "浏览器没有打开。");
}

/**
 * 判断 openExternal 的返回值算不算失败。成功返回 null。
 * @param {unknown} result
 */
function interpretBrowserResult(result) {
  // 布尔 false 是明确失败
  if (result === false) {
    return browserFailure();
  }
  // 宿主用对象表示拒绝打开
  if (result && typeof result === "object") {
    // ok 或 success 明确为 false
    if (result.ok === false || result.success === false) {
      return browserFailure();
    }
    // 错误码字符串，例如 DISALLOWED_EXTERNAL_URL
    if (typeof result.code === "string" && result.code !== "") {
      return browserFailure();
    }
    // 错误说明字符串同样算失败
    if (typeof result.error === "string" && result.error !== "") {
      return browserFailure();
    }
  }
  // 有的接口直接返回错误码字符串
  if (typeof result === "string" && result !== "") {
    return browserFailure();
  }
  return null;
}

module.exports = {
  isAbsoluteDir,
  requireWorkspace,
  classifyGitResult,
  normalizeOriginUrl,
  resolveOpenUrl,
  isOpenableWebUrl,
  successMessage,
  interpretBrowserResult,
};
