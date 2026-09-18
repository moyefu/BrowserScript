// ==UserScript==
// @name         网站快照存储与恢复助手
// @namespace    https://github.com/moyefu/BrowserScript
// @version      1.5.0
// @description  针对指定网站实现快照（Cookie、LocalStorage、SessionStorage）的一键存储、命名、加密备份、GitHub Gist云同步、二维码生成/扫码与一键恢复
// @author       MOYEFU
// @icon         https://pic1.imgdb.cn/i/034D4F8VwYLLoU73kkQs3l.gif
// @homepage     https://scriptcat.org/zh-CN/script-show-page/7633
// @supportURL   https://scriptcat.org/zh-CN/script-show-page/7633/issue
// @license      MIT
// @match        http*://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @require      https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js
// @require      https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js
// @tag          MOYEFU
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* ==UserConfig==
Config:
  filter_mode:
    title: 域名过滤模式
    description: 白名单模式：仅对列表中的网站生效；黑名单模式：对除列表中之外的所有网站生效
    type: select
    values:
      - [whitelist, 白名单模式 (仅在列表中生效)]
      - [blacklist, 黑名单模式 (列表中的不生效)]
    default: whitelist
  host_list:
    title: 域名列表 (每行一条)
    description: 每行一条，支持通配符 * ，例：https://*.example.org* 或 *.baidu.com；白名单模式下仅列表内网站显示，黑名单模式下列表内网站不显示
    type: textarea
    default: ""
  enable_encryption:
    title: 本地数据加密
    description: 启用 AES-GCM 256 位本地数据加密存储
    type: checkbox
    default: false
  auto_reload_after_restore:
    title: 恢复后直接刷新/跳转
    description: 恢复快照成功后直接刷新或跳转至来源页面（不再弹窗确认）
    type: checkbox
    default: false
  sync_auto:
    title: 空闲时自动同步
    description: 自动同步至 GitHub Gist（检测空闲且未使用插件时静默同步）
    type: checkbox
    default: false
  sync_idle_minutes:
    title: 自动同步空闲时长 (分钟)
    description: 检测无网页操作且无插件操作达到该时长后触发自动同步（默认5分钟）
    type: number
    default: 5
    min: 1
    max: 1440
  sync_gist_token:
    title: GitHub Gist Token
    description: 用于云同步的 GitHub Personal Access Token（需勾选 gist 权限）
    type: text
    default: ""
  sync_gist_id:
    title: GitHub Gist ID
    description: 存储快照数据的 Gist ID（留空可在面板中点击一键自动创建）
    type: text
    default: ""
==/UserConfig== */

// =========================================================================
// 🛡️ Trusted Types 策略引擎与安全 HTML 注入组件
// 兼容严格 CSP（如 GitHub, Google 等 require-trusted-types-for 'script' 策略）
// =========================================================================
let appTrustedPolicy = null;
function initTrustedTypesPolicy() {
  if (appTrustedPolicy) return;
  const ttFactory = (typeof window !== "undefined" && window.trustedTypes) ||
                    (typeof unsafeWindow !== "undefined" && unsafeWindow.trustedTypes);
  if (ttFactory && typeof ttFactory.createPolicy === "function") {
    const CANDIDATE_NAMES = [
      "default",
      "snapshotPolicy",
      "webSnapshotManager",
      "trusted-types",
      "goog#html",
      "dompurify",
      "angular#unsafe-bypass",
      "nextjs#html",
      "webpack#html",
      "bypass"
    ];

    for (const name of CANDIDATE_NAMES) {
      if (appTrustedPolicy) break;
      try {
        appTrustedPolicy = ttFactory.createPolicy(name, {
          createHTML: (string) => string,
          createScript: (string) => string,
          createScriptURL: (string) => string,
        });
      } catch (e) {}
    }

    if (!appTrustedPolicy && ttFactory.defaultPolicy) {
      appTrustedPolicy = ttFactory.defaultPolicy;
    }
  }
}
initTrustedTypesPolicy();

function safeHTML(html) {
  if (appTrustedPolicy && typeof appTrustedPolicy.createHTML === "function") {
    try {
      return appTrustedPolicy.createHTML(html);
    } catch (e) {
      return html;
    }
  }
  return html;
}

function setSafeInnerHTML(element, html) {
  if (!element) return;
  const safeContent = safeHTML(html);
  try {
    element.innerHTML = safeContent;
    return;
  } catch (err) {}

  try {
    const range = document.createRange();
    range.selectNode(element);
    const fragment = range.createContextualFragment(safeContent);
    element.replaceChildren(fragment);
    return;
  } catch (err) {}

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(safeContent, "text/html");
    element.replaceChildren(...doc.body.childNodes);
    return;
  } catch (err) {}
}

// 针对 Userscript 激活环境安全支持 Element.prototype.innerHTML
let innerHTMLPatched = false;
function patchInnerHTMLSetter() {
  if (innerHTMLPatched) return;
  innerHTMLPatched = true;
  try {
    if (typeof Element === "undefined" || !Element.prototype) return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    if (originalDescriptor && originalDescriptor.set) {
      Object.defineProperty(Element.prototype, "innerHTML", {
        set: function (val) {
          const safeVal = safeHTML(val);
          try {
            return originalDescriptor.set.call(this, safeVal);
          } catch (err) {
            try {
              const range = document.createRange();
              range.selectNode(this);
              const fragment = range.createContextualFragment(safeVal);
              this.replaceChildren(fragment);
              return;
            } catch (e2) {
              try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(safeVal, "text/html");
                this.replaceChildren(...doc.body.childNodes);
                return;
              } catch (e3) {
                throw err;
              }
            }
          }
        },
        get: function () {
          return originalDescriptor.get.call(this);
        },
        configurable: true,
        enumerable: true
      });
    }
  } catch (e) {}
}

// 全局暴露的 UI 实例，供菜单命令与外部调度使用
let LSM_UI = null;
