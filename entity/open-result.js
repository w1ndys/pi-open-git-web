/**
 * 实体层：一次「在浏览器打开仓库」的结果。
 * 成功只带规范后的网页地址，失败带稳定错误码和给人看的说明。
 */

/**
 * 打开成功。
 * @param {string} url 规范后的 http(s) 地址
 */
function okResult(url) {
  return { ok: true, url: url };
}

/**
 * 打开失败。
 * @param {string} code 稳定错误码
 * @param {string} message 给人看的说明，不得带口令或 stderr
 */
function failResult(code, message) {
  return { ok: false, code: code, message: message };
}

module.exports = { okResult, failResult };
