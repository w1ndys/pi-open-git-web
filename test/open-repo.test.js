/**
 * 单测：注入假的 git 执行器，不打开浏览器，也不依赖本机仓库。
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { readWorkspacePath } = require("../data/workspace");
const { readOriginRaw, GIT_BIN } = require("../data/git-remote");
const {
  normalizeOriginUrl,
  resolveOpenUrl,
  interpretBrowserResult,
  successMessage,
} = require("../business/open-repo");
const { okResult, failResult } = require("../entity/open-result");
const { planBrowserOpen, runGitwebWith } = require("../main");

/**
 * 把假的 execFile 回调用固定结果包起来。
 * @param {Error | null} error
 * @param {string} stdout
 * @param {string} stderr
 */
function fakeExec(error, stdout, stderr) {
  return function (_command, _args, _options, callback) {
    callback(error, stdout, stderr);
  };
}

/**
 * 用绝对路径跑一遍读 origin 再规范化。
 * @param {Function} execFileImpl
 */
async function openWith(execFileImpl) {
  const raw = await readOriginRaw("/tmp/demo", execFileImpl);
  return resolveOpenUrl("/tmp/demo", raw);
}

describe("normalizeOriginUrl", function () {
  it("scp 地址转成 https 并去掉 .git", function () {
    const result = normalizeOriginUrl("git@github.com:w1ndys/pi-open-git-web.git");
    assert.deepEqual(result, okResult("https://github.com/w1ndys/pi-open-git-web"));
  });

  it("scp 绝对路径保留目录", function () {
    const result = normalizeOriginUrl("git@git.example:/srv/git/foo.git");
    assert.deepEqual(result, okResult("https://git.example/srv/git/foo"));
  });

  it("ssh 带端口时丢掉端口和用户名", function () {
    const result = normalizeOriginUrl("ssh://git@github.com:2222/org/repo.git");
    assert.equal(result.ok, true);
    assert.equal(result.url, "https://github.com/org/repo");
    assert.equal(result.url.indexOf("git@"), -1);
    assert.equal(result.url.indexOf("2222"), -1);
  });

  it("GitLab 子组路径保留", function () {
    const result = normalizeOriginUrl("git@gitlab.com:group/sub/repo.git");
    assert.deepEqual(result, okResult("https://gitlab.com/group/sub/repo"));
  });

  it("https 自定义端口保留", function () {
    const result = normalizeOriginUrl("https://gitlab.example.com:8443/group/repo.git");
    assert.deepEqual(result, okResult("https://gitlab.example.com:8443/group/repo"));
  });

  it("https 带 token 时去掉用户信息和查询串", function () {
    const raw = "https://oauth2:glpat-secret@gitlab.com/group/sub/repo.git?token=glpat-secret#frag";
    const result = normalizeOriginUrl(raw);
    assert.equal(result.ok, true);
    assert.equal(result.url, "https://gitlab.com/group/sub/repo");
    assert.equal(result.url.indexOf("glpat-secret"), -1);
    assert.equal(result.url.indexOf("oauth2"), -1);
  });

  it("git 协议转成 https", function () {
    const result = normalizeOriginUrl("git://github.com/org/repo.git");
    assert.deepEqual(result, okResult("https://github.com/org/repo"));
  });

  it("file 协议失败且提示里只有协议名", function () {
    const result = normalizeOriginUrl("file:///tmp/secret-repo.git");
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_WEB");
    assert.equal(result.message, "这个 origin 不能打开成网页（file）。");
    assert.equal(result.message.indexOf("secret"), -1);
  });

  it("本地路径失败且不带协议标记", function () {
    const result = normalizeOriginUrl("/Users/w1ndys/repo.git");
    assert.equal(result.ok, false);
    assert.equal(result.message, "这个 origin 不能打开成网页。");
  });

  it("路径中间的 .git 保留", function () {
    const result = normalizeOriginUrl("git@host.example:foo.git/bar");
    assert.deepEqual(result, okResult("https://host.example/foo.git/bar"));
  });
});

describe("git 结果", function () {
  it("没有 origin", async function () {
    const result = await openWith(fakeExec({ code: 1 }, "", ""));
    assert.equal(result.ok, false);
    assert.equal(result.code, "NO_ORIGIN");
    assert.equal(result.message, "当前仓库没有 origin。");
  });

  it("不是 git 仓库", async function () {
    const result = await openWith(fakeExec(
      { code: 128 },
      "",
      "fatal: not a git repository (or any of the parent directories): .git"
    ));
    assert.equal(result.code, "NOT_A_REPO");
    assert.equal(result.message, "当前目录不是 git 仓库。");
  });

  it("找不到 git", async function () {
    const result = await openWith(fakeExec({ code: "ENOENT" }, "", ""));
    assert.equal(result.code, "GIT_MISSING");
    assert.equal(result.message, "找不到 /usr/bin/git，无法读取远程地址。");
  });

  it("读取超时", async function () {
    const result = await openWith(fakeExec(
      { killed: true, signal: "SIGTERM", code: null },
      "",
      ""
    ));
    assert.equal(result.code, "GIT_TIMEOUT");
    assert.equal(result.message, "读取 origin 超时。");
  });

  it("其他失败不把 stderr 里的口令贴进提示", async function () {
    const result = await openWith(fakeExec(
      { code: 128 },
      "",
      "fatal: Authentication failed for https://user:secret@example.com/repo.git"
    ));
    assert.equal(result.code, "GIT_FAILED");
    assert.equal(result.message, "读取 origin 失败。");
    assert.equal(result.message.indexOf("secret"), -1);
  });

  it("只取第一条非空 origin，并固定 git 参数", async function () {
    let seen = null;
    const execFileImpl = function (command, args, options, callback) {
      seen = { command: command, args: args, options: options };
      callback(null, "\nhttps://example.com/first.git\nhttps://example.com/second.git\n", "");
    };
    const result = await openWith(execFileImpl);
    assert.equal(seen.command, GIT_BIN);
    assert.deepEqual(seen.args, ["-C", "/tmp/demo", "config", "--get-all", "remote.origin.url"]);
    assert.equal(seen.options.timeout, 5000);
    assert.equal(seen.options.shell, undefined);
    assert.deepEqual(result, okResult("https://example.com/first"));
  });
});

describe("工作区和浏览器", function () {
  it("没有工作区时不调用 git", async function () {
    let called = false;
    const result = await planBrowserOpen({
      get: async function () {
        return null;
      },
    }, function () {
      called = true;
    });
    assert.equal(called, false);
    assert.equal(result.code, "NO_WORKSPACE");
    assert.equal(result.message, "当前没有工作目录，先打开一个项目。");
  });

  it("空路径同样不调用 git", async function () {
    let called = false;
    const result = await planBrowserOpen({
      get: async function () {
        return { path: "  " };
      },
    }, function () {
      called = true;
    });
    assert.equal(called, false);
    assert.equal(result.message, "当前没有工作目录，先打开一个项目。");
  });

  it("读出宿主给的 path", async function () {
    const path = await readWorkspacePath({
      get: async function () {
        return { path: "/tmp/demo" };
      },
    });
    assert.equal(path, "/tmp/demo");
  });

  it("失败时不调用 openExternal", async function () {
    let opened = 0;
    const result = await runGitwebWith({
      workspace: {
        get: async function () {
          return { path: "/tmp/demo" };
        },
      },
      execFile: fakeExec({ code: 1 }, "", ""),
      shell: {
        openExternal: async function () {
          opened += 1;
        },
      },
      ui: {
        showToast: async function () {
          return null;
        },
      },
    });
    assert.equal(opened, 0);
    assert.equal(result.code, "NO_ORIGIN");
  });

  it("成功时只打开规范后的地址，提示用同一个 URL", async function () {
    const opened = [];
    const toasts = [];
    const result = await runGitwebWith({
      workspace: {
        get: async function () {
          return { path: "/tmp/demo" };
        },
      },
      execFile: fakeExec(null, "git@gitlab.com:group/sub/repo.git\n", ""),
      shell: {
        openExternal: async function (url) {
          opened.push(url);
          return { ok: true };
        },
      },
      ui: {
        showToast: async function (message) {
          toasts.push(message);
        },
      },
    });
    assert.deepEqual(opened, ["https://gitlab.com/group/sub/repo"]);
    assert.equal(toasts[0], successMessage(opened[0]));
    assert.equal(result.url, opened[0]);
  });

  it("openExternal 返回失败对象时提示浏览器没有打开", function () {
    const result = interpretBrowserResult({ code: "DISALLOWED_EXTERNAL_URL" });
    assert.equal(result.message, "浏览器没有打开。");
  });

  it("file 失败结果没有 url 字段可打开", function () {
    const result = resolveOpenUrl("/tmp/demo", {
      exitCode: 0,
      stdout: "file:///tmp/repo.git",
      stderr: "",
      spawnError: null,
      timedOut: false,
    });
    assert.equal(result.ok, false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "url"), false);
  });
});

describe("open-result", function () {
  it("成功和失败形状固定", function () {
    assert.deepEqual(okResult("https://example.com/repo"), {
      ok: true,
      url: "https://example.com/repo",
    });
    assert.deepEqual(failResult("NO_ORIGIN", "当前仓库没有 origin。"), {
      ok: false,
      code: "NO_ORIGIN",
      message: "当前仓库没有 origin。",
    });
  });
});
