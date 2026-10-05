# 变更记录

## 0.1.0

- 首个版本：命令 `/gitweb` 读取当前仓库 origin，在默认浏览器打开对应网页。
- 只读 `remote.origin.url` 的原始 fetch 地址，规范成 http(s) 后去掉用户名和口令。
- 没有工作目录、不是 git 仓库或没有 origin 时明确提示，不静默失败。
