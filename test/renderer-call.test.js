/**
 * 主进程按钮入口单测：探测（hasGitRemote）与打开（openGitWeb），都不真开浏览器。
 * 用假的 pi 与假的 execFile，只验证路由、缓存和提示。
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const main = require("../main");

/**
 * 装上假的 pi。返回一个能改工作区的句柄与收集到的 toast。
 * @param {{ path: string } | null} workspace 宿主给的工作区
 */
function installFakePi(workspace) {
  const toasts = [];
  const opened = [];
  const state = { workspace: workspace };
  globalThis.pi = {
    workspace: {
      get: async function () {
        return state.workspace;
      },
    },
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
    registered: [],
    unregistered: [],
    commands: {
      register: async function (descriptor) {
        globalThis.pi.registered.push(descriptor);
      },
      unregister: async function (id) {
        globalThis.pi.unregistered.push(id);
      },
    },
  };
  return {
    toasts: toasts,
    opened: opened,
    setWorkspace: function (next) {
      state.workspace = next;
    },
  };
}

/**
 * 造一个假的 execFile：固定返回一条 origin，同时记调用次数。
 * @param {string} stdout
 * @param {{ calls: number }} counter
 */
function fakeExec(stdout, counter) {
  return function (_command, _args, _options, callback) {
    counter.calls += 1;
    callback(null, stdout, "");
  };
}

/** 造一个假的 execFile：固定回一个错误，模拟没有 origin 或不是仓库。 */
function fakeExecError(error, stdout, stderr) {
  return function (_command, _args, _options, callback) {
    callback(error, stdout || "", stderr || "");
  };
}

// 每条用例前清掉跨用例的探测缓存，避免互相串味
beforeEach(function () {
  main.clearProbeCache();
});

describe("onRendererCall 路由", function () {
  it("未知方法直接拒绝", async function () {
    installFakePi({ path: "/tmp/demo" });
    const result = await main.onRendererCall("nope", {});
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNKNOWN_METHOD");
  });

  it("探测有 origin 时回 hasRemote: true，且不打开浏览器、不弹提示", async function () {
    const fake = installFakePi({ path: "/tmp/demo" });
    const counter = { calls: 0 };
    const result = await main.onRendererCall(
      main.PROBE_ACTION,
      {},
      fakeExec("git@github.com:w1ndys/demo.git\n", counter)
    );
    assert.equal(result.ok, true);
    assert.equal(result.hasRemote, true);
    // 探测只读 origin：一次外部打开都不能有
    assert.deepEqual(fake.opened, []);
    assert.deepEqual(fake.toasts, []);
    assert.equal(counter.calls, 1);
  });

  it("没有工作目录时探测回 false，且一次 git 都不跑", async function () {
    installFakePi(null);
    const counter = { calls: 0 };
    const result = await main.onRendererCall(
      main.PROBE_ACTION,
      {},
      fakeExec("git@github.com:w1ndys/demo.git\n", counter)
    );
    assert.equal(result.ok, true);
    assert.equal(result.hasRemote, false);
    assert.equal(counter.calls, 0);
  });

  it("读工作区报错时也当没有 origin，按钮不出现", async function () {
    installFakePi({ path: "/tmp/demo" });
    globalThis.pi.workspace.get = async function () {
      throw new Error("host busy");
    };
    const result = await main.onRendererCall(main.PROBE_ACTION, {});
    assert.equal(result.ok, true);
    assert.equal(result.hasRemote, false);
  });

  it("没有 origin 时探测回 false", async function () {
    installFakePi({ path: "/tmp/demo" });
    const result = await main.onRendererCall(
      main.PROBE_ACTION,
      {},
      fakeExecError({ code: 1 }, "", "")
    );
    assert.equal(result.hasRemote, false);
  });

  it("origin 不能规范成网页时探测回 false", async function () {
    installFakePi({ path: "/tmp/demo" });
    const result = await main.onRendererCall(
      main.PROBE_ACTION,
      {},
      fakeExec("file:///tmp/secret-repo.git\n", { calls: 0 })
    );
    assert.equal(result.ok, true);
    assert.equal(result.hasRemote, false);
  });
});

describe("探测缓存", function () {
  it("同一目录只读一次 origin，清掉缓存后才重读", async function () {
    installFakePi({ path: "/tmp/demo" });
    const counter = { calls: 0 };
    const execFileImpl = fakeExec("git@github.com:w1ndys/demo.git\n", counter);
    const first = await main.onRendererCall(main.PROBE_ACTION, {}, execFileImpl);
    const second = await main.onRendererCall(main.PROBE_ACTION, {}, execFileImpl);
    assert.equal(first.hasRemote, true);
    assert.equal(second.hasRemote, true);
    assert.equal(counter.calls, 1);
    main.clearProbeCache();
    await main.onRendererCall(main.PROBE_ACTION, {}, execFileImpl);
    assert.equal(counter.calls, 2);
  });

  it("工作目录变了就重新探测", async function () {
    const fake = installFakePi({ path: "/tmp/one" });
    const counter = { calls: 0 };
    const execFileImpl = fakeExec("git@github.com:w1ndys/demo.git\n", counter);
    await main.onRendererCall(main.PROBE_ACTION, {}, execFileImpl);
    fake.setWorkspace({ path: "/tmp/two" });
    await main.onRendererCall(main.PROBE_ACTION, {}, execFileImpl);
    assert.equal(counter.calls, 2);
  });

  it("点一次打开后缓存作废，下一次探测重新读 origin", async function () {
    installFakePi({ path: "/tmp/demo" });
    const counter = { calls: 0 };
    const execFileImpl = fakeExec("git@github.com:w1ndys/demo.git\n", counter);
    await main.onRendererCall(main.PROBE_ACTION, {}, execFileImpl);
    await main.onRendererCall(main.OPEN_ACTION, {}, execFileImpl);
    await main.onRendererCall(main.PROBE_ACTION, {}, execFileImpl);
    // 一次探测 + 一次打开读 origin + 打开后缓存作废再探一次
    assert.equal(counter.calls, 3);
  });
});

describe("openGitWeb", function () {
  it("没有工作目录时按 NO_WORKSPACE 拒绝，且不调用 openExternal", async function () {
    const fake = installFakePi(null);
    const result = await main.onRendererCall(main.OPEN_ACTION, {}, fakeExec("", { calls: 0 }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "NO_WORKSPACE");
    assert.deepEqual(fake.opened, []);
    assert.equal(fake.toasts[0], result.message);
  });

  it("成功时只打开规范后的地址，提示用同一个 URL", async function () {
    const fake = installFakePi({ path: "/tmp/demo" });
    const result = await main.onRendererCall(
      main.OPEN_ACTION,
      {},
      fakeExec("git@gitlab.com:group/sub/repo.git\n", { calls: 0 })
    );
    assert.equal(result.ok, true);
    assert.deepEqual(fake.opened, ["https://gitlab.com/group/sub/repo"]);
    assert.equal(result.url, fake.opened[0]);
    assert.equal(fake.toasts[0], "已在浏览器打开 " + fake.opened[0]);
  });

  it("没有 origin 时只提示，不开浏览器", async function () {
    const fake = installFakePi({ path: "/tmp/demo" });
    const result = await main.onRendererCall(
      main.OPEN_ACTION,
      {},
      fakeExecError({ code: 1 }, "", "")
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "NO_ORIGIN");
    assert.deepEqual(fake.opened, []);
    assert.equal(fake.toasts[0], "当前仓库没有 origin。");
  });

  it("浏览器打不开时提示浏览器没有打开", async function () {
    const fake = installFakePi({ path: "/tmp/demo" });
    globalThis.pi.shell.openExternal = async function () {
      return { code: "DISALLOWED_EXTERNAL_URL" };
    };
    const result = await main.onRendererCall(
      main.OPEN_ACTION,
      {},
      fakeExec("git@github.com:w1ndys/demo.git\n", { calls: 0 })
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "BROWSER_FAILED");
    assert.equal(fake.toasts[0], "浏览器没有打开。");
  });
});

describe("斜杠命令", function () {
  it("onLoad 只注册一条命令，onUnload 注销它", async function () {
    installFakePi({ path: "/tmp/demo" });
    await main.onLoad();
    const first = globalThis.pi.registered[0];
    assert.equal(first.id, main.COMMAND_ID);
    assert.equal(first.title, main.COMMAND_TITLE);
    assert.equal(typeof first.run, "function");
    // 界面上的角落按钮由渲染器自己挂，命令只有这一条
    assert.equal(globalThis.pi.registered.length, 1);
    await main.onUnload();
    assert.deepEqual(globalThis.pi.unregistered, [main.COMMAND_ID]);
  });
});
