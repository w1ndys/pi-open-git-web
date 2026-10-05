/**
 * 数据层：从宿主读当前工作区的主根路径。
 * 只取 path，不读 .git，也不决定怎么打开。
 */

/**
 * 读取当前工作区绝对路径。
 * 没有项目或路径为空时返回 null。
 * @param {{ get: function(): Promise<{ path?: string } | null> }} workspaceApi
 * @returns {Promise<string | null>}
 */
async function readWorkspacePath(workspaceApi) {
  const workspace = await workspaceApi.get();
  // 宿主没给工作区对象，说明当前没有可打开的项目
  if (!workspace) {
    return null;
  }
  // 空路径不能交给 git -C
  if (typeof workspace.path !== "string" || workspace.path.trim() === "") {
    return null;
  }
  return workspace.path;
}

module.exports = { readWorkspacePath };
