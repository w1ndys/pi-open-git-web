/**
 * 数据层：只执行 git，取 origin 的原始 fetch 地址。
 * 不解释退出码，不读 pushurl，也不打开浏览器。
 */

const { execFile } = require("node:child_process");

/** 固定绝对路径，避免 PATH 或别名改写 git。 */
const GIT_BIN = "/usr/bin/git";

/** 卡住时尽快失败，不让命令一直挂着。 */
const GIT_TIMEOUT_MS = 5000;

/**
 * 把 execFile 的回调整理成退出码、输出和启动错误。
 * @param {NodeJS.ErrnoException | null} error
 * @param {string | Buffer | null} stdout
 * @param {string | Buffer | null} stderr
 */
function toGitRaw(error, stdout, stderr) {
  const out = stdout == null ? "" : String(stdout);
  const errText = stderr == null ? "" : String(stderr);
  // 正常退出时 error 为空
  if (!error) {
    return { exitCode: 0, stdout: out, stderr: errText, spawnError: null, timedOut: false };
  }
  // Node 超时会杀掉子进程，这时 code 为空、signal 为 SIGTERM
  if (error.killed === true && error.signal === "SIGTERM" && (error.code === null || typeof error.code === "undefined")) {
    return { exitCode: null, stdout: out, stderr: errText, spawnError: "ETIMEDOUT", timedOut: true };
  }
  // 有的调用方直接给出超时码
  if (error.code === "ETIMEDOUT") {
    return { exitCode: null, stdout: out, stderr: errText, spawnError: "ETIMEDOUT", timedOut: true };
  }
  // 找不到二进制或其他启动错误，code 是字符串
  if (typeof error.code === "string") {
    return { exitCode: null, stdout: out, stderr: errText, spawnError: error.code, timedOut: false };
  }
  // git 自己的非零退出
  if (typeof error.code === "number") {
    return { exitCode: error.code, stdout: out, stderr: errText, spawnError: null, timedOut: false };
  }
  return { exitCode: null, stdout: out, stderr: errText, spawnError: "UNKNOWN", timedOut: false };
}

/**
 * 读取 remote.origin.url 的全部原始值。
 * 用 --get-all 取第一条，不用 --get，也不走会应用 insteadOf 的 get-url。
 * @param {string} workspacePath
 * @param {Function} [execFileImpl] 测试注入的执行器
 */
function readOriginRaw(workspacePath, execFileImpl) {
  const run = execFileImpl || execFile;
  return new Promise(function (resolve) {
    run(
      GIT_BIN,
      ["-C", workspacePath, "config", "--get-all", "remote.origin.url"],
      { timeout: GIT_TIMEOUT_MS, encoding: "utf8" },
      function (error, stdout, stderr) {
        resolve(toGitRaw(error, stdout, stderr));
      }
    );
  });
}

module.exports = { readOriginRaw, toGitRaw, GIT_BIN, GIT_TIMEOUT_MS };
