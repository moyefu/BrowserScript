// ==UserScript==
// @name         网站快照存储与恢复助手
// @namespace    https://github.com/moyefu/BrowserScript
// @version      1.4.3
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
    title: 快照变更时自动同步
    description: 本地快照新增、改名、删除时，防抖 2 秒自动同步至 GitHub Gist
    type: checkbox
    default: false
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
(function initTrustedTypesPolicy() {
  const ttFactory = (typeof window !== "undefined" && window.trustedTypes) ||
                    (typeof unsafeWindow !== "undefined" && unsafeWindow.trustedTypes);
  if (ttFactory && typeof ttFactory.createPolicy === "function") {
    // 候选策略名称列表（兼容不同网站 CSP 白名单限制，如 Google、Next.js、Angular、通用 default 等）
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
})();

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

// 针对 Userscript 环境自动劫持并重写 Element.prototype.innerHTML 赋值
(function patchInnerHTMLSetter() {
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
  } catch (e) {
    // 若环境禁止重定义属性，setSafeInnerHTML 显式调用依然生效
  }
})();

// 全局暴露的 UI 实例，供菜单命令与外部调度使用
let LSM_UI = null;

// =========================================================================
  // 主题系统引擎 (ThemeEngine)
  // 支持结构化 JSON 封装、导入/导出、实时 CSS 变量无刷新换肤与自定义定制
  // =========================================================================
  const ThemeEngine = {
    SCHEMA_TYPE: "LSM_THEME",
    SCHEMA_VERSION: "1.0.0",
    DEFAULT_THEME_ID: "yohaku",
    _shadow: null,
    _uid: null,

    // 内置官方预设主题库
    BUILTIN_THEMES: [
      {
        type: "LSM_THEME",
        version: "1.0.0",
        id: "yohaku",
        name: "Yohaku (余白)",
        description: "基于 Innei Yohaku 设计体系的米白纸张与梅红质感主题",
        isBuiltin: true,
        tokens: {
          accent: "#c56473",
          accentBg: "rgba(197, 100, 115, 0.08)",
          accentBorder: "rgba(197, 100, 115, 0.3)",
          accentHoverBg: "rgba(197, 100, 115, 0.14)",
          accentGlow: "rgba(197, 100, 115, 0.12)",
          bgPaper: "#faf9f5",
          bgHeader: "#f0efeb",
          bgCard: "#ffffff",
          bgList: "#f9f8f5",
          bgHover: "#f0efeb",
          bgActiveCard: "linear-gradient(180deg, rgba(94, 159, 126, 0.06) 0%, #ffffff 60%)",
          borderLight: "#e3e1db",
          borderHover: "#d0cec6",
          textPrimary: "#24231f",
          textSecondary: "#5c5a55",
          textMuted: "#787670",
          textPlaceholder: "#a8a69f",
          colorSuccess: "#5e9f7e",
          bgSuccess: "rgba(94, 159, 126, 0.08)",
          borderSuccess: "rgba(94, 159, 126, 0.25)",
          colorWarning: "#a87a3d",
          bgWarning: "rgba(168, 122, 61, 0.08)",
          borderWarning: "rgba(168, 122, 61, 0.2)",
          colorInfo: "#3d6896",
          bgInfo: "rgba(61, 104, 150, 0.08)",
          borderInfo: "rgba(61, 104, 150, 0.2)",
          colorDanger: "#a64953",
          bgDanger: "rgba(166, 73, 83, 0.08)",
          borderDanger: "rgba(166, 73, 83, 0.25)",
          fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
          radiusWindow: "16px",
          radiusCard: "12px",
          radiusBtn: "8px"
        }
      },
      {
        type: "LSM_THEME",
        version: "1.0.0",
        id: "classic_blue",
        name: "Classic Blue (经典科技蓝)",
        description: "清晰现代的科技蓝调搭配极简冷灰界面",
        isBuiltin: true,
        tokens: {
          accent: "#2563eb",
          accentBg: "rgba(37, 99, 235, 0.08)",
          accentBorder: "rgba(37, 99, 235, 0.3)",
          accentHoverBg: "rgba(37, 99, 235, 0.14)",
          accentGlow: "rgba(37, 99, 235, 0.12)",
          bgPaper: "#f8fafc",
          bgHeader: "#f1f5f9",
          bgCard: "#ffffff",
          bgList: "#f8fafc",
          bgHover: "#f1f5f9",
          bgActiveCard: "linear-gradient(180deg, rgba(22, 163, 74, 0.06) 0%, #ffffff 60%)",
          borderLight: "#e2e8f0",
          borderHover: "#cbd5e1",
          textPrimary: "#0f172a",
          textSecondary: "#334155",
          textMuted: "#64748b",
          textPlaceholder: "#94a3b8",
          colorSuccess: "#16a34a",
          bgSuccess: "rgba(22, 163, 74, 0.08)",
          borderSuccess: "rgba(22, 163, 74, 0.25)",
          colorWarning: "#d97706",
          bgWarning: "rgba(217, 119, 6, 0.08)",
          borderWarning: "rgba(217, 119, 6, 0.2)",
          colorInfo: "#0284c7",
          bgInfo: "rgba(2, 132, 199, 0.08)",
          borderInfo: "rgba(2, 132, 199, 0.2)",
          colorDanger: "#dc2626",
          bgDanger: "rgba(220, 38, 38, 0.08)",
          borderDanger: "rgba(220, 38, 38, 0.25)",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          radiusWindow: "16px",
          radiusCard: "12px",
          radiusBtn: "8px"
        }
      },
      {
        type: "LSM_THEME",
        version: "1.0.0",
        id: "obsidian_dark",
        name: "Obsidian Dark (曜石暗夜)",
        description: "深色沉浸护眼主题，曜石黑灰与高亮翡翠绿点缀",
        isBuiltin: true,
        tokens: {
          accent: "#10b981",
          accentBg: "rgba(16, 185, 129, 0.12)",
          accentBorder: "rgba(16, 185, 129, 0.35)",
          accentHoverBg: "rgba(16, 185, 129, 0.2)",
          accentGlow: "rgba(16, 185, 129, 0.15)",
          bgPaper: "#141312",
          bgHeader: "#1f1e1c",
          bgCard: "#1f1e1c",
          bgList: "#141312",
          bgHover: "#2a2926",
          bgActiveCard: "linear-gradient(180deg, rgba(16, 185, 129, 0.12) 0%, #1f1e1c 60%)",
          borderLight: "#2f2d29",
          borderHover: "#474540",
          textPrimary: "#f5f4f0",
          textSecondary: "#d0cec6",
          textMuted: "#a8a69f",
          textPlaceholder: "#787670",
          colorSuccess: "#10b981",
          bgSuccess: "rgba(16, 185, 129, 0.12)",
          borderSuccess: "rgba(16, 185, 129, 0.3)",
          colorWarning: "#f59e0b",
          bgWarning: "rgba(245, 158, 11, 0.12)",
          borderWarning: "rgba(245, 158, 11, 0.3)",
          colorInfo: "#38bdf8",
          bgInfo: "rgba(56, 189, 248, 0.12)",
          borderInfo: "rgba(56, 189, 248, 0.3)",
          colorDanger: "#f43f5e",
          bgDanger: "rgba(244, 63, 94, 0.12)",
          borderDanger: "rgba(244, 63, 94, 0.3)",
          fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
          radiusWindow: "16px",
          radiusCard: "12px",
          radiusBtn: "8px"
        }
      },
      {
        type: "LSM_THEME",
        version: "1.0.0",
        id: "sakura_pink",
        name: "Sakura Pink (春櫻粉紫)",
        description: "温柔优雅的春日樱花色调，粉白相间与柔润光泽",
        isBuiltin: true,
        tokens: {
          accent: "#e11d48",
          accentBg: "rgba(225, 29, 72, 0.08)",
          accentBorder: "rgba(225, 29, 72, 0.28)",
          accentHoverBg: "rgba(225, 29, 72, 0.14)",
          accentGlow: "rgba(225, 29, 72, 0.1)",
          bgPaper: "#fff5f6",
          bgHeader: "#ffe4e6",
          bgCard: "#ffffff",
          bgList: "#fff1f3",
          bgHover: "#ffe4e6",
          bgActiveCard: "linear-gradient(180deg, rgba(225, 29, 72, 0.06) 0%, #ffffff 60%)",
          borderLight: "#fecdd3",
          borderHover: "#fda4af",
          textPrimary: "#2b1216",
          textSecondary: "#612933",
          textMuted: "#9f4a59",
          textPlaceholder: "#be7683",
          colorSuccess: "#059669",
          bgSuccess: "rgba(5, 150, 105, 0.08)",
          borderSuccess: "rgba(5, 150, 105, 0.2)",
          colorWarning: "#d97706",
          bgWarning: "rgba(217, 119, 6, 0.08)",
          borderWarning: "rgba(217, 119, 6, 0.2)",
          colorInfo: "#7c3aed",
          bgInfo: "rgba(124, 58, 237, 0.08)",
          borderInfo: "rgba(124, 58, 237, 0.2)",
          colorDanger: "#e11d48",
          bgDanger: "rgba(225, 29, 72, 0.08)",
          borderDanger: "rgba(225, 29, 72, 0.25)",
          fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
          radiusWindow: "18px",
          radiusCard: "14px",
          radiusBtn: "10px"
        }
      },
      {
        type: "LSM_THEME",
        version: "1.0.0",
        id: "matcha_green",
        name: "Matcha Green (宇治抹茶)",
        description: "清幽宁静的和风抹茶绿，淡雅米绿与墨茶文字",
        isBuiltin: true,
        tokens: {
          accent: "#15803d",
          accentBg: "rgba(21, 128, 61, 0.08)",
          accentBorder: "rgba(21, 128, 61, 0.28)",
          accentHoverBg: "rgba(21, 128, 61, 0.14)",
          accentGlow: "rgba(21, 128, 61, 0.1)",
          bgPaper: "#f9fcf8",
          bgHeader: "#edf7eb",
          bgCard: "#ffffff",
          bgList: "#f4faf2",
          bgHover: "#e8f5e5",
          bgActiveCard: "linear-gradient(180deg, rgba(21, 128, 61, 0.06) 0%, #ffffff 60%)",
          borderLight: "#d6ebd3",
          borderHover: "#b6deb0",
          textPrimary: "#19281a",
          textSecondary: "#3d543f",
          textMuted: "#678469",
          textPlaceholder: "#93ac95",
          colorSuccess: "#15803d",
          bgSuccess: "rgba(21, 128, 61, 0.08)",
          borderSuccess: "rgba(21, 128, 61, 0.2)",
          colorWarning: "#b45309",
          bgWarning: "rgba(180, 83, 9, 0.08)",
          borderWarning: "rgba(180, 83, 9, 0.2)",
          colorInfo: "#0369a1",
          bgInfo: "rgba(3, 105, 161, 0.08)",
          borderInfo: "rgba(3, 105, 161, 0.2)",
          colorDanger: "#b91c1c",
          bgDanger: "rgba(185, 28, 28, 0.08)",
          borderDanger: "rgba(185, 28, 28, 0.25)",
          fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
          radiusWindow: "16px",
          radiusCard: "12px",
          radiusBtn: "8px"
        }
      }
    ],

    // 获取用户存储的所有自定义主题
    getCustomThemes() {
      try {
        const raw = GM_getValue("Config.custom_themes", {});
        return typeof raw === "object" && raw !== null ? raw : {};
      } catch (e) {
        return {};
      }
    },

    // 保存自定义主题字典
    saveCustomThemesMap(map) {
      try {
        GM_setValue("Config.custom_themes", map || {});
      } catch (e) {}
    },

    // 获取当前全部可用主题列表（内置 + 自定义）
    getAllThemes() {
      const customs = Object.values(this.getCustomThemes());
      return [...this.BUILTIN_THEMES, ...customs];
    },

    // 获取指定 ID 的主题对象
    getThemeById(id) {
      if (!id) return this.BUILTIN_THEMES[0];
      const found = this.getAllThemes().find((t) => t.id === id);
      return found || this.BUILTIN_THEMES[0];
    },

    // 获取当前生效的主题对象
    getActiveTheme() {
      const activeId = GM_getValue("Config.active_theme_id", this.DEFAULT_THEME_ID);
      return this.getThemeById(activeId);
    },

    // 设置当前生效的主题 ID 并持久化
    setActiveTheme(id) {
      const theme = this.getThemeById(id);
      GM_setValue("Config.active_theme_id", theme.id);
      this.applyTheme(theme);
      return theme;
    },

    // 一键重置为默认 Yohaku 主题
    resetToDefault() {
      return this.setActiveTheme(this.DEFAULT_THEME_ID);
    },

    // 绑定当前活动 UI 的 Shadow Root 与 UID
    bindShadow(shadowRoot, uid) {
      this._shadow = shadowRoot;
      this._uid = uid;
      this.applyTheme();
    },

    // 校验与规范化主题数据
    validateAndNormalizeTheme(input) {
      if (!input || typeof input !== "object") {
        throw new Error("主题数据必须为有效的 JSON 对象");
      }
      if (input.type && input.type !== this.SCHEMA_TYPE) {
        throw new Error("非法的主题数据格式类型: " + input.type + "，期望为 " + this.SCHEMA_TYPE);
      }

      const defaultTokens = this.BUILTIN_THEMES[0].tokens;
      const inputTokens = input.tokens || {};

      const cleanTokens = {};
      for (const [key, defVal] of Object.entries(defaultTokens)) {
        cleanTokens[key] = typeof inputTokens[key] === "string" && inputTokens[key].trim() ? inputTokens[key].trim() : defVal;
      }

      const name = String(input.name || "自定义主题").trim();
      const id = String(input.id || ("custom_" + Date.now().toString(36))).trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      const description = String(input.description || "用户自定义导入的主题样式").trim();

      return {
        type: this.SCHEMA_TYPE,
        version: this.SCHEMA_VERSION,
        id,
        name,
        description,
        isBuiltin: false,
        tokens: cleanTokens,
        createdAt: input.createdAt || Date.now(),
        updatedAt: Date.now()
      };
    },

    // 获取用户删除自定义主题的墓碑记录
    getThemeTombstones() {
      try {
        const raw = GM_getValue("Config.theme_tombstones", {});
        return typeof raw === "object" && raw !== null ? raw : {};
      } catch (e) {
        return {};
      }
    },

    // 保存自定义主题墓碑字典
    saveThemeTombstones(map) {
      try {
        GM_setValue("Config.theme_tombstones", map || {});
      } catch (e) {}
    },

    // 记录删除自定义主题墓碑
    addThemeTombstone(id) {
      if (!id) return;
      const tombs = this.getThemeTombstones();
      tombs[id] = Date.now();
      this.saveThemeTombstones(tombs);
    },

    // 移除删除墓碑（如重新创建同名 ID 时）
    removeThemeTombstone(id) {
      if (!id) return;
      const tombs = this.getThemeTombstones();
      if (tombs[id]) {
        delete tombs[id];
        this.saveThemeTombstones(tombs);
      }
    },

    // 导入自定义主题 JSON
    importTheme(jsonStringOrObj) {
      let parsed = jsonStringOrObj;
      if (typeof jsonStringOrObj === "string") {
        try {
          parsed = JSON.parse(jsonStringOrObj);
        } catch (err) {
          throw new Error("JSON 解析失败: " + err.message);
        }
      }

      const theme = this.validateAndNormalizeTheme(parsed);
      const customs = this.getCustomThemes();

      // 如果 ID 与内置主题冲突，则分配新 ID
      if (this.BUILTIN_THEMES.some((b) => b.id === theme.id)) {
        theme.id = "custom_" + theme.id + "_" + Date.now().toString(36).slice(-4);
      }

      customs[theme.id] = theme;
      this.removeThemeTombstone(theme.id);
      this.saveCustomThemesMap(customs);
      this.setActiveTheme(theme.id);
      if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
        GistSyncEngine.scheduleAutoSync();
      }
      return theme;
    },

    // 导出指定主题为结构化 JSON 字符串
    exportTheme(id) {
      const theme = this.getThemeById(id);
      const exportObj = {
        type: this.SCHEMA_TYPE,
        version: this.SCHEMA_VERSION,
        id: theme.id,
        name: theme.name,
        description: theme.description,
        tokens: theme.tokens,
        exportedAt: Date.now()
      };
      return JSON.stringify(exportObj, null, 2);
    },

    // 保存/更新自定义主题
    saveCustomTheme(themeObj) {
      const normalized = this.validateAndNormalizeTheme(themeObj);
      const customs = this.getCustomThemes();
      customs[normalized.id] = normalized;
      this.removeThemeTombstone(normalized.id);
      this.saveCustomThemesMap(customs);
      this.setActiveTheme(normalized.id);
      if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
        GistSyncEngine.scheduleAutoSync();
      }
      return normalized;
    },

    // 删除自定义主题（内置主题禁止删除）
    deleteCustomTheme(id) {
      if (this.BUILTIN_THEMES.some((b) => b.id === id)) {
        throw new Error("内置官方主题受保护，不可删除");
      }
      const customs = this.getCustomThemes();
      if (customs[id]) {
        delete customs[id];
        this.saveCustomThemesMap(customs);
      }
      this.addThemeTombstone(id);
      if (GM_getValue("Config.active_theme_id", "") === id) {
        this.resetToDefault();
      }
      if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
        GistSyncEngine.scheduleAutoSync();
      }
    },

    // 生成 CSS 变量字符串
    generateCssVariables(tokens, targetUid) {
      const rootSel = targetUid ? `#${targetUid}-root` : `:host, [id$="-root"]`;
      return `
    ${rootSel} {
      --lsm-accent: ${tokens.accent};
      --lsm-accent-bg: ${tokens.accentBg};
      --lsm-accent-border: ${tokens.accentBorder};
      --lsm-accent-hover-bg: ${tokens.accentHoverBg};
      --lsm-accent-glow: ${tokens.accentGlow};
      --lsm-bg-paper: ${tokens.bgPaper};
      --lsm-bg-header: ${tokens.bgHeader};
      --lsm-bg-card: ${tokens.bgCard};
      --lsm-bg-list: ${tokens.bgList};
      --lsm-bg-hover: ${tokens.bgHover};
      --lsm-bg-active-card: ${tokens.bgActiveCard};
      --lsm-border: ${tokens.borderLight};
      --lsm-border-hover: ${tokens.borderHover};
      --lsm-text-primary: ${tokens.textPrimary};
      --lsm-text-secondary: ${tokens.textSecondary};
      --lsm-text-muted: ${tokens.textMuted};
      --lsm-text-placeholder: ${tokens.textPlaceholder};
      --lsm-color-success: ${tokens.colorSuccess};
      --lsm-bg-success: ${tokens.bgSuccess};
      --lsm-border-success: ${tokens.borderSuccess};
      --lsm-color-warning: ${tokens.colorWarning};
      --lsm-bg-warning: ${tokens.bgWarning};
      --lsm-border-warning: ${tokens.borderWarning};
      --lsm-color-info: ${tokens.colorInfo};
      --lsm-bg-info: ${tokens.bgInfo};
      --lsm-border-info: ${tokens.borderInfo};
      --lsm-color-danger: ${tokens.colorDanger};
      --lsm-bg-danger: ${tokens.bgDanger};
      --lsm-border-danger: ${tokens.borderDanger};
      --lsm-font-family: ${tokens.fontFamily};
      --lsm-radius-window: ${tokens.radiusWindow || "16px"};
      --lsm-radius-card: ${tokens.radiusCard || "12px"};
      --lsm-radius-btn: ${tokens.radiusBtn || "8px"};
    }
      `;
    },

    // 动态应用主题到当前 UI 实例（Shadow DOM 与 Host Dialogs）
    applyTheme(theme) {
      const active = theme || this.getActiveTheme();
      const cssVars = this.generateCssVariables(active.tokens, this._uid);

      // 1. 注入 Shadow Root 变量样式表
      if (this._shadow) {
        const varStyleId = this._uid ? `${this._uid}-theme-vars` : "lsm-theme-vars";
        let varStyle = this._shadow.getElementById(varStyleId);
        if (!varStyle) {
          varStyle = document.createElement("style");
          varStyle.id = varStyleId;
          this._shadow.insertBefore(varStyle, this._shadow.firstChild);
        }
        varStyle.textContent = cssVars;
      }

      // 2. 注入全局宿主环境弹窗主题变量
      if (typeof document !== "undefined" && document) {
        let hostVarStyle = document.getElementById("lsm-host-theme-vars");
        if (!hostVarStyle) {
          hostVarStyle = document.createElement("style");
          hostVarStyle.id = "lsm-host-theme-vars";
          (document.head || document.documentElement).appendChild(hostVarStyle);
        }
        hostVarStyle.textContent = `
          :root {
            --lsm-host-accent: ${active.tokens.accent};
            --lsm-host-accent-bg: ${active.tokens.accentBg};
            --lsm-host-accent-border: ${active.tokens.accentBorder};
            --lsm-host-bg-paper: ${active.tokens.bgPaper};
            --lsm-host-border: ${active.tokens.borderLight};
            --lsm-host-border-hover: ${active.tokens.borderHover || "#d0cec6"};
            --lsm-host-text-primary: ${active.tokens.textPrimary};
            --lsm-host-text-secondary: ${active.tokens.textSecondary};
            --lsm-host-text-muted: ${active.tokens.textMuted};
            --lsm-host-font: ${active.tokens.fontFamily};
          }

          /* 宿主环境全部相关弹窗、文本域与列表滚动条美化 */
          div[id*="lsm"] * {
            scrollbar-width: thin;
            scrollbar-color: ${active.tokens.borderHover || "#d0cec6"} transparent;
          }
          div[id*="lsm"] *::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          div[id*="lsm"] *::-webkit-scrollbar-track {
            background: transparent;
            border-radius: 9999px;
          }
          div[id*="lsm"] *::-webkit-scrollbar-thumb {
            background-color: ${active.tokens.borderHover || "#d0cec6"};
            border-radius: 9999px;
            border: 1px solid transparent;
            background-clip: padding-box;
            transition: background-color 0.2s ease;
          }
          div[id*="lsm"] *::-webkit-scrollbar-thumb:hover {
            background-color: ${active.tokens.accent};
          }
          div[id*="lsm"] *::-webkit-scrollbar-corner {
            background: transparent;
          }
        `;
      }
    }
  };


// 获取域名过滤模式，自动提取前面英文关键词（whitelist / blacklist）
function getFilterMode() {
  let val = GM_getValue("Config.filter_mode", "whitelist");
  if (Array.isArray(val)) {
    val = val[0];
  }
  const match = String(val || "").match(/[a-zA-Z]+/);
  const mode = match ? match[0].toLowerCase() : "whitelist";
  return mode === "blacklist" ? "blacklist" : "whitelist";
}

function getHostRules() {
  let raw = GM_getValue("Config.host_list", null);
  if (raw === null || raw === undefined) {
    raw = GM_getValue("Config.show_host", "");
  }
  return String(raw || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isHostMatched() {
  const lines = getHostRules();
  if (!lines.length) return false;
  const candidates = [
    location.href,
    location.origin,
    location.protocol + "//" + location.host,
    location.host,
    location.hostname
  ];
  return lines.some((line) => {
    const re = new RegExp(line ? ("^" + line.replace(/[.+?^${}()|[\\]\\]/g, "\\$&").replace(/\\*/g, ".*") + "$") : "^$", "i");
    return candidates.some((c) => re.test(c));
  });
}

function hostBlocked() {
  try {
    const mode = getFilterMode();
    const matched = isHostMatched();
    const lines = getHostRules();
    if (mode === "blacklist") return matched;
    if (!lines.length) return true;
    return !matched;
  } catch (e) {
    return true;
  }
}

(async () => {
  "use strict";

  // =========================================================================
  // 菜单命令注册（Tampermonkey / ScriptCat 菜单）
  // 1. 🔑 快照管理助手
  // 2. 🛡️ 过滤模式切换（白名单 / 黑名单）
  // 3. 📝 编辑域名名单列表
  // 4. 🔒 本地数据加密状态切换
  // 5. 🔄 恢复后刷新跳转状态切换
  // =========================================================================
  function registerAllMenuCommands() {
    // 主题风格与个性化设置
    GM_registerMenuCommand("🎨 主题设置 (切换/导出/导入)", async () => {
      if (!LSM_UI) {
        await initApp();
      }
      if (LSM_UI) {
        if (typeof LSM_UI.openWindow === "function") LSM_UI.openWindow();
        if (typeof LSM_UI.openThemeDialog === "function") LSM_UI.openThemeDialog();
      }
    });

    // 1. 主入口
    GM_registerMenuCommand("🔑 快照管理助手", () => {
      if (hostBlocked()) {
        showBlockedDialog();
      } else {
        showMainDialog();
      }
    });

    // 2. 切换黑/白名单模式
    const currentMode = getFilterMode();
    const modeText = currentMode === "blacklist" ? "🛡️ 当前为【黑名单】模式 (点击切换为白名单)" : "🛡️ 当前为【白名单】模式 (点击切换为黑名单)";
    GM_registerMenuCommand(modeText, () => {
      showSwitchFilterModeDialog();
    });

    // 3. 编辑黑/白名单列表
    GM_registerMenuCommand("📝 编辑域名规则列表 (黑/白名单)", () => {
      showEditHostListDialog();
    });

    // 4. 本地数据加密状态
    const isEnc = GM_getValue("Config.enable_encryption", true);
    const encText = isEnc ? "🔒 本地数据【已加密】 (点击切换/关闭)" : "🔓 本地数据【未加密】 (点击切换/开启)";
    GM_registerMenuCommand(encText, () => {
      showToggleEncryptionDialog();
    });

    // 5. 恢复后刷新状态
    const isAutoReload = GM_getValue("Config.auto_reload_after_restore", false);
    const reloadText = isAutoReload ? "🔄 恢复后【自动刷新/跳转】 (点击切换为不刷新)" : "⏸️ 恢复后【不默认刷新】 (点击切换为自动刷新)";
    GM_registerMenuCommand(reloadText, () => {
      showToggleAutoReloadDialog();
    });

    // 6. 云同步设置
    GM_registerMenuCommand("☁️ 云同步设置与状态 (GitHub Gist)", async () => {
      if (hostBlocked()) {
        showBlockedDialog();
      } else {
        if (!LSM_UI) {
          await initApp();
        }
        if (LSM_UI && typeof LSM_UI.openWindow === "function") {
          LSM_UI.openWindow();
          if (typeof LSM_UI.openCloudSyncDialog === "function") {
            LSM_UI.openCloudSyncDialog();
          }
        }
      }
    });
  }

  registerAllMenuCommands();

  if (hostBlocked()) return;

  initApp();
})();

// 永久开启当前站点（白名单模式下加入列表，黑名单模式下移出列表）
function enableCurrentHost() {
  try {
    const mode = getFilterMode();

    let raw = GM_getValue("Config.host_list", null);
    if (raw === null || raw === undefined) {
      raw = GM_getValue("Config.show_host", "");
    }
    let lines = String(raw || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const candidates = [
      location.href,
      location.origin,
      location.protocol + "//" + location.host,
      location.host,
      location.hostname
    ];

    if (mode === "blacklist") {
      lines = lines.filter((line) => {
        const re = new RegExp(
          "^" + line.replace(/[.+?^${}()|[\\]\\]/g, "\\$&").replace(/\\*/g, ".*") + "$",
          "i"
        );
        return !candidates.some((c) => re.test(c));
      });
    } else {
      const entry = location.origin;
      if (!lines.some((l) => l === entry)) {
        lines.push(entry);
      }
    }
    GM_setValue("Config.host_list", lines.join("\n"));
  } catch (e) {
    console.error("[LSM] 写入配置失败:", e);
  }
}
const addHostToShowList = enableCurrentHost;

// 永久关闭当前站点（白名单模式下移出列表，黑名单模式下加入列表）
function disableCurrentHost() {
  try {
    const mode = getFilterMode();

    let raw = GM_getValue("Config.host_list", null);
    if (raw === null || raw === undefined) {
      raw = GM_getValue("Config.show_host", "");
    }
    let lines = String(raw || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const candidates = [
      location.href,
      location.origin,
      location.protocol + "//" + location.host,
      location.host,
      location.hostname
    ];

    if (mode === "blacklist") {
      const entry = location.origin;
      if (!lines.some((l) => l === entry)) {
        lines.push(entry);
      }
    } else {
      lines = lines.filter((line) => {
      const re = new RegExp(
        "^" + line.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
        "i"
      );
      return !candidates.some((c) => re.test(c));
    });
  }

    GM_setValue("Config.host_list", lines.join("\n"));
  } catch (e) {
    console.error("[LSM] 移除配置失败:", e);
  }
}
const removeHostFromShowList = disableCurrentHost;

// ---------------------------------------------------------------------------
// 移动端/全平台弹窗滚动穿透防护助手
// ---------------------------------------------------------------------------
function bindScrollLock(mask, scrollableSelector) {
  let startY = 0;

  function findScrollable(target) {
    let el = target;
    while (el && el !== mask && el !== document.documentElement && el !== document.body) {
      if (el.scrollHeight > el.clientHeight) {
        const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style) {
          const overflowY = style.overflowY;
          if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
            return el;
          }
        }
      }
      if (scrollableSelector && el.matches && el.matches(scrollableSelector) && el.scrollHeight > el.clientHeight) {
        return el;
      }
      el = el.parentElement || (el.getRootNode ? el.getRootNode().host : null);
    }
    return scrollableSelector && target.closest ? target.closest(scrollableSelector) : null;
  }

  // 1. PC 端鼠标滚轮事件精确拦截
  mask.addEventListener(
    "wheel",
    (e) => {
      e.stopPropagation();
      const scrollable = findScrollable(e.target);
      if (!scrollable) {
        e.preventDefault();
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = scrollable;
      const deltaY = e.deltaY;
      if (scrollHeight <= clientHeight) {
        e.preventDefault();
        return;
      }
      if ((deltaY < 0 && scrollTop <= 0) || (deltaY > 0 && scrollTop + clientHeight >= scrollHeight - 1)) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  // 2. 移动端触摸滑动事件精确拦截
  mask.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        startY = e.touches[0].clientY;
      }
    },
    { passive: true }
  );

  mask.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 1) return;
      const scrollable = findScrollable(e.target);
      if (!scrollable) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        return;
      }

      const currentY = e.touches[0].clientY;
      const deltaY = currentY - startY; // >0 为下拉，<0 为上滑
      const { scrollTop, scrollHeight, clientHeight } = scrollable;

      if (scrollHeight <= clientHeight) {
        // 容器内无需滚动时直接阻止穿透
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (deltaY > 0 && scrollTop <= 0) {
        // 顶部继续下拉，拦截
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      } else if (deltaY < 0 && scrollTop + clientHeight >= scrollHeight - 1) {
        // 底部继续上滑，拦截
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      } else {
        // 容器内部正常滚动，允许并阻止冒泡
        e.stopPropagation();
      }
    },
    { passive: false }
  );
}

function ensureHostAnimationStyle() {
  if (!document.getElementById("lsm-host-animations")) {
    const style = document.createElement("style");
    style.id = "lsm-host-animations";
    style.textContent = "@keyframes lsmFadeIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}";
    (document.head || document.documentElement).appendChild(style);
  }
}

function showBlockedDialog() {
  if (document.querySelector(".lsm-dlg-mask")) return;
  ensureHostAnimationStyle();
  const mask = document.createElement("div");
  mask.className = "lsm-dlg-mask";
  mask.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(20,19,18,0.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:system-ui,-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:360px;max-width:calc(100vw - 32px);background:#faf9f5;border:1px solid #e3e1db;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(36,35,31,0.18),0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;animation:lsmFadeIn .2s cubic-bezier(0.16,1,0.3,1);";

  const title = document.createElement("div");
  title.innerHTML = "🔑 <span style='color:#24231f;font-size:15px;font-weight:600;'>快照管理助手未激活</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const mode = getFilterMode();

  const desc = document.createElement("div");
  desc.textContent = mode === "blacklist"
    ? "当前网站已被加入「黑名单」列表中，快照助手未在此站点激活。你可以选择："
    : "当前网站不在「白名单」列表中，快照助手未在此站点激活。你可以选择：";
  desc.style.cssText = "font-size:13px;color:#5c5a55;line-height:1.6;margin-bottom:18px;";

  const tempBtn = document.createElement("button");
  tempBtn.textContent = "临时显示（仅本次生效）";
  tempBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;margin-bottom:9px;border:1px solid rgba(197,100,115,0.3);border-radius:10px;" +
    "background:rgba(197,100,115,0.08);color:#c56473;font-size:13px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);";
  tempBtn.addEventListener("mouseenter", () => {
    tempBtn.style.background = "rgba(197,100,115,0.14)";
    tempBtn.style.borderColor = "rgba(197,100,115,0.45)";
  });
  tempBtn.addEventListener("mouseleave", () => {
    tempBtn.style.background = "rgba(197,100,115,0.08)";
    tempBtn.style.borderColor = "rgba(197,100,115,0.3)";
  });

  const permBtn = document.createElement("button");
  permBtn.textContent = mode === "blacklist" ? "永久开启（移出黑名单）" : "永久开启（加入白名单）";
  permBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;border:1px solid #e3e1db;border-radius:10px;" +
    "background:transparent;color:#403f3a;font-size:13px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);";
  permBtn.addEventListener("mouseenter", () => {
    permBtn.style.background = "#f0efeb";
    permBtn.style.borderColor = "#d0cec6";
  });
  permBtn.addEventListener("mouseleave", () => {
    permBtn.style.background = "transparent";
    permBtn.style.borderColor = "#e3e1db";
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:8px 0;margin-top:6px;border:none;background:none;" +
    "color:#787670;font-size:12px;cursor:pointer;transition:color .15s;";
  cancelBtn.addEventListener("mouseenter", () => cancelBtn.style.color = "#24231f");
  cancelBtn.addEventListener("mouseleave", () => cancelBtn.style.color = "#787670");

  const close = () => mask.remove();

  tempBtn.addEventListener("click", () => {
    close();
    initApp();
  });

  permBtn.addEventListener("click", () => {
    close();
    addHostToShowList();
    initApp();
  });

  cancelBtn.addEventListener("click", close);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) close();
  });

  box.append(title, desc, tempBtn, permBtn, cancelBtn);
  mask.appendChild(box);
  document.documentElement.appendChild(mask);
}

// 脚本正常运行时的菜单弹窗：打开管理窗 / 临时关闭 / 永久关闭
function showMainDialog() {
  if (document.querySelector(".lsm-dlg-mask")) return;
  ensureHostAnimationStyle();
  const mask = document.createElement("div");
  mask.className = "lsm-dlg-mask";
  mask.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(20,19,18,0.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:system-ui,-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:360px;max-width:calc(100vw - 32px);background:#faf9f5;border:1px solid #e3e1db;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(36,35,31,0.18),0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;animation:lsmFadeIn .2s cubic-bezier(0.16,1,0.3,1);";

  const title = document.createElement("div");
  title.innerHTML = "🔑 <span style='color:#24231f;font-size:15px;font-weight:600;'>快照管理助手</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const mode = getFilterMode();

  const desc = document.createElement("div");
  desc.textContent = mode === "blacklist"
    ? "当前网站处于黑名单排除范围之外，功能就绪。你可以选择："
    : "当前网站已在白名单允许列表中，功能就绪。你可以选择：";
  desc.style.cssText = "font-size:13px;color:#5c5a55;line-height:1.6;margin-bottom:18px;";

  const openBtn = document.createElement("button");
  openBtn.textContent = "打开管理窗口";
  openBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;margin-bottom:9px;border:1px solid rgba(197,100,115,0.3);border-radius:10px;" +
    "background:rgba(197,100,115,0.08);color:#c56473;font-size:13px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);";
  openBtn.addEventListener("mouseenter", () => {
    openBtn.style.background = "rgba(197,100,115,0.14)";
    openBtn.style.borderColor = "rgba(197,100,115,0.45)";
  });
  openBtn.addEventListener("mouseleave", () => {
    openBtn.style.background = "rgba(197,100,115,0.08)";
    openBtn.style.borderColor = "rgba(197,100,115,0.3)";
  });

  const tmpBtn = document.createElement("button");
  tmpBtn.textContent = "临时隐藏悬浮球（刷新后恢复）";
  tmpBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;margin-bottom:9px;border:1px solid #e3e1db;border-radius:10px;" +
    "background:transparent;color:#403f3a;font-size:13px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);";
  tmpBtn.addEventListener("mouseenter", () => {
    tmpBtn.style.background = "#f0efeb";
    tmpBtn.style.borderColor = "#d0cec6";
  });
  tmpBtn.addEventListener("mouseleave", () => {
    tmpBtn.style.background = "transparent";
    tmpBtn.style.borderColor = "#e3e1db";
  });

  const permBtn = document.createElement("button");
  permBtn.textContent = mode === "blacklist" ? "永久关闭（加入黑名单）" : "永久关闭（从白名单移除）";
  permBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;border:1px solid rgba(166,73,83,0.25);border-radius:10px;" +
    "background:rgba(166,73,83,0.06);color:#a64953;font-size:13px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);";
  permBtn.addEventListener("mouseenter", () => {
    permBtn.style.background = "rgba(166,73,83,0.12)";
    permBtn.style.borderColor = "rgba(166,73,83,0.4)";
  });
  permBtn.addEventListener("mouseleave", () => {
    permBtn.style.background = "rgba(166,73,83,0.06)";
    permBtn.style.borderColor = "rgba(166,73,83,0.25)";
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:8px 0;margin-top:6px;border:none;background:none;" +
    "color:#787670;font-size:12px;cursor:pointer;transition:color .15s;";
  cancelBtn.addEventListener("mouseenter", () => cancelBtn.style.color = "#24231f");
  cancelBtn.addEventListener("mouseleave", () => cancelBtn.style.color = "#787670");

  const close = () => mask.remove();

  const hideAll = () => {
    if (LSM_UI) {
      if (LSM_UI.ball) LSM_UI.ball.style.display = "none";
      if (LSM_UI.win) {
        LSM_UI.win.style.display = "none";
        LSM_UI.win.classList.add("hidden");
      }
    }
  };

  openBtn.addEventListener("click", async () => {
    close();
    if (!LSM_UI) {
      await initApp();
    }
    if (LSM_UI && typeof LSM_UI.openWindow === "function") {
      LSM_UI.openWindow();
    }
  });

  tmpBtn.addEventListener("click", () => {
    close();
    hideAll();
  });

  permBtn.addEventListener("click", () => {
    close();
    removeHostFromShowList();
    hideAll();
  });

  cancelBtn.addEventListener("click", close);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) close();
  });

  box.append(title, desc, openBtn, tmpBtn, permBtn, cancelBtn);
  mask.appendChild(box);
  document.documentElement.appendChild(mask);
}

// ---------------------------------------------------------------------------
// 菜单命令弹窗：1. 切换黑/白名单模式
// ---------------------------------------------------------------------------
function showSwitchFilterModeDialog() {
  if (document.querySelector(".lsm-dlg-mask")) return;
  ensureHostAnimationStyle();

  const currentMode = getFilterMode();
  const targetMode = currentMode === "blacklist" ? "whitelist" : "blacklist";
  const targetModeLabel = targetMode === "blacklist" ? "黑名单模式" : "白名单模式";

  const mask = document.createElement("div");
  mask.className = "lsm-dlg-mask";
  mask.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(20,19,18,0.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:system-ui,-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:380px;max-width:calc(100vw - 32px);background:#faf9f5;border:1px solid #e3e1db;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(36,35,31,0.18),0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;animation:lsmFadeIn .2s cubic-bezier(0.16,1,0.3,1);";

  const title = document.createElement("div");
  title.innerHTML = "🛡️ <span style='color:#24231f;font-size:15px;font-weight:600;'>切换域名过滤模式</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const desc = document.createElement("div");
  desc.innerHTML =
    `当前模式：<strong style="color:#24231f;">${currentMode === "blacklist" ? "黑名单模式 (列表中的网站不生效)" : "白名单模式 (仅在列表中生效)"}</strong><br>` +
    `点击下方按钮将切换为：<strong style="color:#c56473;">${targetModeLabel}</strong>。<br>` +
    `<span style="color:#787670;font-size:12px;">切换后将立即生效并刷新当前页面。</span>`;
  desc.style.cssText = "font-size:13px;color:#5c5a55;line-height:1.6;margin-bottom:18px;";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = `确认切换为「${targetModeLabel}」`;
  confirmBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;margin-bottom:9px;border:1px solid rgba(197,100,115,0.3);border-radius:10px;" +
    "background:rgba(197,100,115,0.08);color:#c56473;font-size:13px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);";
  confirmBtn.addEventListener("mouseenter", () => {
    confirmBtn.style.background = "rgba(197,100,115,0.14)";
    confirmBtn.style.borderColor = "rgba(197,100,115,0.45)";
  });
  confirmBtn.addEventListener("mouseleave", () => {
    confirmBtn.style.background = "rgba(197,100,115,0.08)";
    confirmBtn.style.borderColor = "rgba(197,100,115,0.3)";
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:8px 0;margin-top:4px;border:none;background:none;" +
    "color:#787670;font-size:12px;cursor:pointer;transition:color .15s;";
  cancelBtn.addEventListener("mouseenter", () => cancelBtn.style.color = "#24231f");
  cancelBtn.addEventListener("mouseleave", () => cancelBtn.style.color = "#787670");

  const close = () => mask.remove();

  confirmBtn.addEventListener("click", () => {
    GM_setValue("Config.filter_mode", targetMode);
    close();
    location.reload();
  });

  cancelBtn.addEventListener("click", close);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) close();
  });

  box.append(title, desc, confirmBtn, cancelBtn);
  mask.appendChild(box);
  document.documentElement.appendChild(mask);
}

// ---------------------------------------------------------------------------
// 菜单命令弹窗：2. 编辑黑/白名单域名列表
// ---------------------------------------------------------------------------
function showEditHostListDialog() {
  if (document.querySelector(".lsm-dlg-mask")) return;
  ensureHostAnimationStyle();

  let raw = GM_getValue("Config.host_list", null);
  if (raw === null || raw === undefined) {
    raw = GM_getValue("Config.show_host", "");
  }

  const mode = getFilterMode();

  const mask = document.createElement("div");
  mask.className = "lsm-dlg-mask";
  mask.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(20,19,18,0.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:system-ui,-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;";
  bindScrollLock(mask, "textarea");

  const box = document.createElement("div");
  box.style.cssText =
    "width:460px;max-width:calc(100vw - 32px);background:#faf9f5;border:1px solid #e3e1db;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(36,35,31,0.18),0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;animation:lsmFadeIn .2s cubic-bezier(0.16,1,0.3,1);";

  const title = document.createElement("div");
  title.innerHTML = "📝 <span style='color:#24231f;font-size:15px;font-weight:600;'>编辑域名规则列表</span>";
  title.style.cssText = "margin-bottom:8px;display:flex;align-items:center;gap:6px;";

  const desc = document.createElement("div");
  desc.innerHTML =
    `当前生效模式：<strong style="color:#c56473;">${mode === "blacklist" ? "黑名单模式 (列表中不生效)" : "白名单模式 (仅在列表中生效)"}</strong><br>` +
    `每行一条规则，支持通配符 <code>*</code>（例：<code>https://*.example.com*</code> 或 <code>*.baidu.com</code>）：`;
  desc.style.cssText = "font-size:12.5px;color:#5c5a55;line-height:1.5;margin-bottom:12px;";

  const textarea = document.createElement("textarea");
  textarea.value = String(raw || "");
  textarea.placeholder = "*.google.com\nhttps://github.com/*\n*.example.org";
  textarea.style.cssText =
    "width:100%;height:160px;box-sizing:border-box;border:1px solid #e3e1db;border-radius:10px;" +
    "padding:10px 12px;font-size:13px;line-height:1.5;font-family:ui-monospace,Consolas,Monaco,monospace;color:#24231f;resize:vertical;outline:none;" +
    "background:#ffffff;background-image:linear-gradient(180deg,rgba(197,100,115,0.03) 0%,transparent 26%);transition:border-color .2s,box-shadow .2s;margin-bottom:16px;";
  textarea.addEventListener("focus", () => {
    textarea.style.borderColor = "rgba(197,100,115,0.35)";
    textarea.style.boxShadow = "0 0 0 3px rgba(197,100,115,0.1)";
  });
  textarea.addEventListener("blur", () => {
    textarea.style.borderColor = "#e3e1db";
    textarea.style.boxShadow = "none";
  });

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:10px;justify-content:flex-end;align-items:center;";

  const addCurrBtn = document.createElement("button");
  addCurrBtn.textContent = "+ 添加当前网站";
  addCurrBtn.style.cssText =
    "padding:7px 12px;border:1px solid #e3e1db;border-radius:8px;background:transparent;color:#403f3a;font-size:12px;cursor:pointer;font-weight:500;transition:all .15s;";
  addCurrBtn.addEventListener("mouseenter", () => {
    addCurrBtn.style.background = "#f0efeb";
    addCurrBtn.style.borderColor = "#d0cec6";
  });
  addCurrBtn.addEventListener("mouseleave", () => {
    addCurrBtn.style.background = "transparent";
    addCurrBtn.style.borderColor = "#e3e1db";
  });
  addCurrBtn.addEventListener("click", () => {
    const origin = location.origin;
    const lines = textarea.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.includes(origin)) {
      lines.push(origin);
      textarea.value = lines.join("\n");
    }
  });

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "保存并应用";
  saveBtn.style.cssText =
    "padding:7px 16px;border:1px solid rgba(197,100,115,0.3);border-radius:8px;background:rgba(197,100,115,0.08);color:#c56473;font-size:12.5px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);";
  saveBtn.addEventListener("mouseenter", () => {
    saveBtn.style.background = "rgba(197,100,115,0.14)";
    saveBtn.style.borderColor = "rgba(197,100,115,0.45)";
  });
  saveBtn.addEventListener("mouseleave", () => {
    saveBtn.style.background = "rgba(197,100,115,0.08)";
    saveBtn.style.borderColor = "rgba(197,100,115,0.3)";
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "padding:7px 12px;border:none;background:none;color:#787670;font-size:12px;cursor:pointer;transition:color .15s;";
  cancelBtn.addEventListener("mouseenter", () => cancelBtn.style.color = "#24231f");
  cancelBtn.addEventListener("mouseleave", () => cancelBtn.style.color = "#787670");

  const close = () => mask.remove();

  saveBtn.addEventListener("click", () => {
    const formatted = textarea.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n");
    GM_setValue("Config.host_list", formatted);
    close();
    location.reload();
  });

  cancelBtn.addEventListener("click", close);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) close();
  });

  btnRow.append(addCurrBtn, cancelBtn, saveBtn);
  box.append(title, desc, textarea, btnRow);
  mask.appendChild(box);
  document.documentElement.appendChild(mask);
}

// ---------------------------------------------------------------------------
// 菜单命令弹窗：3. 本地数据加密切换
// ---------------------------------------------------------------------------
function showToggleEncryptionDialog() {
  if (document.querySelector(".lsm-dlg-mask")) return;
  ensureHostAnimationStyle();

  const isEnc = GM_getValue("Config.enable_encryption", true);
  const targetEnc = !isEnc;

  const mask = document.createElement("div");
  mask.className = "lsm-dlg-mask";
  mask.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(20,19,18,0.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:system-ui,-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:380px;max-width:calc(100vw - 32px);background:#faf9f5;border:1px solid #e3e1db;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(36,35,31,0.18),0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;animation:lsmFadeIn .2s cubic-bezier(0.16,1,0.3,1);";

  const title = document.createElement("div");
  title.innerHTML = "🔒 <span style='color:#24231f;font-size:15px;font-weight:600;'>本地数据加密设置</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const desc = document.createElement("div");
  desc.innerHTML =
    `当前状态：<strong style="color:${isEnc ? "#5e9f7e" : "#a64953"};">${isEnc ? "已开启 AES-GCM 256 位加密" : "未开启（明文存储）"}</strong><br>` +
    `点击确认将切换为：<strong style="color:#c56473;">${targetEnc ? "开启本地数据加密" : "关闭本地数据加密"}</strong>。<br>` +
    `<span style="color:#787670;font-size:12px;">（新保存的快照将按新设置执行，已保存的旧快照依然支持正常读取）</span>`;
  desc.style.cssText = "font-size:13px;color:#5c5a55;line-height:1.6;margin-bottom:18px;";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = targetEnc ? "确认开启加密" : "确认关闭加密";
  confirmBtn.style.cssText =
    `display:block;width:100%;padding:9px 0;margin-bottom:9px;border:1px solid ${targetEnc ? "rgba(197,100,115,0.3)" : "rgba(166,73,83,0.25)"};border-radius:10px;` +
    `background:${targetEnc ? "rgba(197,100,115,0.08)" : "rgba(166,73,83,0.06)"};color:${targetEnc ? "#c56473" : "#a64953"};font-size:13px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);`;
  confirmBtn.addEventListener("mouseenter", () => {
    confirmBtn.style.background = targetEnc ? "rgba(197,100,115,0.14)" : "rgba(166,73,83,0.12)";
  });
  confirmBtn.addEventListener("mouseleave", () => {
    confirmBtn.style.background = targetEnc ? "rgba(197,100,115,0.08)" : "rgba(166,73,83,0.06)";
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:8px 0;margin-top:4px;border:none;background:none;" +
    "color:#787670;font-size:12px;cursor:pointer;transition:color .15s;";
  cancelBtn.addEventListener("mouseenter", () => cancelBtn.style.color = "#24231f");
  cancelBtn.addEventListener("mouseleave", () => cancelBtn.style.color = "#787670");

  const close = () => mask.remove();

  confirmBtn.addEventListener("click", () => {
    GM_setValue("Config.enable_encryption", targetEnc);
    close();
    location.reload();
  });

  cancelBtn.addEventListener("click", close);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) close();
  });

  box.append(title, desc, confirmBtn, cancelBtn);
  mask.appendChild(box);
  document.documentElement.appendChild(mask);
}

// ---------------------------------------------------------------------------
// 菜单命令弹窗：4. 恢复后刷新/跳转状态切换
// ---------------------------------------------------------------------------
function showToggleAutoReloadDialog() {
  if (document.querySelector(".lsm-dlg-mask")) return;
  ensureHostAnimationStyle();

  const isAutoReload = GM_getValue("Config.auto_reload_after_restore", false);
  const targetState = !isAutoReload;

  const mask = document.createElement("div");
  mask.className = "lsm-dlg-mask";
  mask.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(20,19,18,0.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:system-ui,-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:380px;max-width:calc(100vw - 32px);background:#faf9f5;border:1px solid #e3e1db;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(36,35,31,0.18),0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;animation:lsmFadeIn .2s cubic-bezier(0.16,1,0.3,1);";

  const title = document.createElement("div");
  title.innerHTML = "🔄 <span style='color:#24231f;font-size:15px;font-weight:600;'>恢复后自动刷新设置</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const desc = document.createElement("div");
  desc.innerHTML =
    `当前状态：<strong style="color:${isAutoReload ? "#5e9f7e" : "#787670"};">${isAutoReload ? "已开启自动刷新/跳转（无需二次弹窗确认）" : "不默认刷新（恢复后弹窗提示是否刷新）"}</strong><br>` +
    `点击确认将切换为：<strong style="color:#c56473;">${targetState ? "恢复后直接自动刷新/跳转" : "恢复后二次弹窗确认刷新"}</strong>。`;
  desc.style.cssText = "font-size:13px;color:#5c5a55;line-height:1.6;margin-bottom:18px;";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = targetState ? "确认切换为「自动刷新/跳转」" : "确认切换为「不默认刷新」";
  confirmBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;margin-bottom:9px;border:1px solid rgba(197,100,115,0.3);border-radius:10px;" +
    "background:rgba(197,100,115,0.08);color:#c56473;font-size:13px;cursor:pointer;font-weight:500;transition:all .2s cubic-bezier(0.22,1,0.36,1);";
  confirmBtn.addEventListener("mouseenter", () => {
    confirmBtn.style.background = "rgba(197,100,115,0.14)";
    confirmBtn.style.borderColor = "rgba(197,100,115,0.45)";
  });
  confirmBtn.addEventListener("mouseleave", () => {
    confirmBtn.style.background = "rgba(197,100,115,0.08)";
    confirmBtn.style.borderColor = "rgba(197,100,115,0.3)";
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:8px 0;margin-top:4px;border:none;background:none;" +
    "color:#787670;font-size:12px;cursor:pointer;transition:color .15s;";
  cancelBtn.addEventListener("mouseenter", () => cancelBtn.style.color = "#24231f");
  cancelBtn.addEventListener("mouseleave", () => cancelBtn.style.color = "#787670");

  const close = () => mask.remove();

  confirmBtn.addEventListener("click", () => {
    GM_setValue("Config.auto_reload_after_restore", targetState);
    close();
    location.reload();
  });

  cancelBtn.addEventListener("click", close);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) close();
  });

  box.append(title, desc, confirmBtn, cancelBtn);
  mask.appendChild(box);
  document.documentElement.appendChild(mask);
}

async function initApp() {
  if (document.getElementById("lsm-session-manager-root")) {
    if (LSM_UI && LSM_UI.ball) {
      LSM_UI.ball.style.display = "";
      LSM_UI.ball.classList.remove("hidden");
    }
    return;
  }

  const isEncryptionEnabled = () => GM_getValue("Config.enable_encryption", true);
  const isAutoReloadEnabled = () => GM_getValue("Config.auto_reload_after_restore", false);

  // -----------------------------------------------------------------------
  // 加密与安全擦除引擎 (AES-GCM 256)
  // -----------------------------------------------------------------------
  const CryptoEngine = {
    keyCache: new Map(),

    // 安全派生密钥：支持 v3（跨设备强通用密钥）、v2（域名绑定密钥）、legacy（UA 绑定历史密钥）
    async getDerivedKey(saltString, domain, version = "v3") {
      const host = (domain || location.hostname || "").trim().toLowerCase();
      const salt = saltString || "SESSION_MGR_SALT_2026";
      const cacheKey = `${host}___${salt}___${version}`;

      if (this.keyCache.has(cacheKey)) {
        return this.keyCache.get(cacheKey);
      }

      const enc = new TextEncoder();
      let baseKeyMaterial = "";

      if (version === "v3") {
        // v3: 全局稳定密钥材料，彻底消除跨设备、跨浏览器、二级域名或跨站点恢复时的环境不一致问题
        baseKeyMaterial = "LSM_STABLE_UNIVERSAL_KEY_MATERIAL_2026_SECURE";
      } else if (version === "v2") {
        // v2: 基于主域名的派生密钥材料
        baseKeyMaterial = `LSM_KEY_V2_SNAPSHOT_${host}`;
      } else {
        // legacy: 兼容旧版本保存的历史快照数据 (含 UA 前缀)
        baseKeyMaterial = `LSM_KEY_${navigator.userAgent.slice(0, 32)}_${host}`;
      }

      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(baseKeyMaterial),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
      );

      const derivedKey = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: enc.encode(salt),
          iterations: 100000,
          hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );

      this.keyCache.set(cacheKey, derivedKey);
      return derivedKey;
    },

    async encrypt(plainObject, domain) {
      if (!isEncryptionEnabled() || !crypto.subtle) {
        return { encrypted: false, payload: JSON.stringify(plainObject) };
      }
      try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        // 默认使用 v3 跨设备强通用稳定密钥加密
        const key = await this.getDerivedKey("SESSION_SALT_GCM", domain, "v3");
        const encodedData = new TextEncoder().encode(JSON.stringify(plainObject));

        const cipherBuffer = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv },
          key,
          encodedData
        );

        const ivBase64 = btoa(String.fromCharCode(...iv));
        const cipherBase64 = btoa(String.fromCharCode(...new Uint8Array(cipherBuffer)));

        return {
          encrypted: true,
          v: "3", // 标注密钥协议版本
          iv: ivBase64,
          payload: cipherBase64
        };
      } catch (err) {
        console.warn("[LSM] 加密失败，使用原始格式:", err);
        return { encrypted: false, payload: JSON.stringify(plainObject) };
      }
    },

    async decrypt(cipherObj, domain) {
      if (!cipherObj) return null;
      if (!cipherObj.encrypted) {
        return typeof cipherObj.payload === "string"
          ? JSON.parse(cipherObj.payload)
          : cipherObj.payload;
      }
      try {
        const iv = new Uint8Array(
          atob(cipherObj.iv)
            .split("")
            .map((c) => c.charCodeAt(0))
        );
        const cipherData = new Uint8Array(
          atob(cipherObj.payload)
            .split("")
            .map((c) => c.charCodeAt(0))
        );

        const tryDecryptWithKey = async (targetDomain, version) => {
          try {
            const key = await this.getDerivedKey("SESSION_SALT_GCM", targetDomain, version);
            const decryptedBuffer = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: iv },
              key,
              cipherData
            );
            const decryptedStr = new TextDecoder().decode(decryptedBuffer);
            return JSON.parse(decryptedStr);
          } catch (e) {
            return null;
          }
        };

        // 智能自适应多级回退解密管道：
        // 1. 优先尝试 v3 跨设备强通用密钥 (零环境依赖)
        let res = await tryDecryptWithKey("", "v3");
        if (res) return res;

        // 2. 尝试 v2 密钥 (快照原始 domain)
        if (domain) {
          res = await tryDecryptWithKey(domain, "v2");
          if (res) return res;
        }

        // 3. 尝试 v2 密钥 (当前页面 location.hostname)
        if (location.hostname && location.hostname !== domain) {
          res = await tryDecryptWithKey(location.hostname, "v2");
          if (res) return res;
        }

        // 4. 尝试 legacy 密钥 (快照原始 domain)
        if (domain) {
          res = await tryDecryptWithKey(domain, "legacy");
          if (res) return res;
        }

        // 5. 尝试 legacy 密钥 (当前 location.hostname)
        if (location.hostname && location.hostname !== domain) {
          res = await tryDecryptWithKey(location.hostname, "legacy");
          if (res) return res;
        }

        throw new Error("数据解密失败，快照可能损坏或加密密钥不匹配");
      } catch (err) {
        console.error("[LSM] 解密失败:", err);
        throw err instanceof Error ? err : new Error("数据解密失败");
      }
    },

    wipeMemory(obj) {
      if (typeof obj === "object" && obj !== null) {
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === "string") {
            obj[key] = "";
          } else if (typeof obj[key] === "object") {
            this.wipeMemory(obj[key]);
          }
          delete obj[key];
        }
      }
    }
  };

  // -----------------------------------------------------------------------
  // Cookie & WebStorage 捕获与恢复
  // -----------------------------------------------------------------------
  const SessionManager = {
    hasGmCookie() {
      return (
        typeof GM_cookie !== "undefined" &&
        GM_cookie &&
        typeof GM_cookie.list === "function" &&
        typeof GM_cookie.set === "function"
      );
    },

    async getCookies() {
      if (this.hasGmCookie()) {
        return new Promise((resolve) => {
          try {
            GM_cookie.list({ url: location.href }, (cookies, error) => {
              if (error || !cookies) {
                resolve(this.getDocumentCookies());
              } else {
                resolve(
                  cookies.map((c) => ({
                    name: c.name,
                    value: c.value,
                    domain: c.domain,
                    path: c.path || "/",
                    secure: !!c.secure,
                    httpOnly: !!c.httpOnly,
                    sameSite: c.sameSite || "unspecified",
                    expirationDate: c.expirationDate
                  }))
                );
              }
            });
          } catch (e) {
            resolve(this.getDocumentCookies());
          }
        });
      }
      return this.getDocumentCookies();
    },

    getDocumentCookies() {
      const raw = document.cookie;
      if (!raw || !raw.trim()) return [];
      return raw
        .split(";")
        .map((pair) => {
          const idx = pair.indexOf("=");
          if (idx === -1) return null;
          const name = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          if (!name) return null;
          return {
            name,
            value,
            domain: location.hostname,
            path: "/",
            secure: location.protocol === "https:",
            httpOnly: false
          };
        })
        .filter(Boolean);
    },

    getWebStorage() {
      const local = {};
      const session = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) local[key] = localStorage.getItem(key);
        }
      } catch (e) {}

      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) session[key] = sessionStorage.getItem(key);
        }
      } catch (e) {}

      return { localStorage: local, sessionStorage: session };
    },

    async captureCurrentSession() {
      const cookies = await this.getCookies();
      const storage = this.getWebStorage();

      const sessionObj = {
        domain: location.hostname,
        url: location.href,
        timestamp: Date.now(),
        cookies: cookies,
        localStorage: storage.localStorage,
        sessionStorage: storage.sessionStorage
      };

      const approxBytes = new Blob([JSON.stringify(sessionObj)]).size;

      return {
        ...sessionObj,
        summary: {
          cookieCount: cookies.length,
          localCount: Object.keys(storage.localStorage).length,
          sessionCount: Object.keys(storage.sessionStorage).length,
          approxBytes: approxBytes
        }
      };
    },

    async clearAllData() {
      let cookieCount = 0;
      const hostname = location.hostname;
      const hostParts = hostname.split(".");

      if (this.hasGmCookie()) {
        try {
          // 1. 获取当前页面 URL 作用域下的 Cookie
          const cookiesByUrl = await new Promise((resolve) => {
            GM_cookie.list({ url: location.href }, (c, err) => {
              if (err || !c) resolve([]);
              else resolve(c);
            });
          });

          // 2. 获取当前域名及所有可能父级域名的 Cookie（覆盖带点和不带点）
          const domainList = [hostname, "." + hostname];
          for (let i = 0; i < hostParts.length - 1; i++) {
            const d = hostParts.slice(i).join(".");
            domainList.push(d);
            domainList.push("." + d);
          }

          const domainCookies = [];
          for (const d of Array.from(new Set(domainList))) {
            try {
              const list = await new Promise((resolve) => {
                GM_cookie.list({ domain: d }, (c, err) => {
                  if (err || !c) resolve([]);
                  else resolve(c);
                });
              });
              if (Array.isArray(list)) domainCookies.push(...list);
            } catch (e) {}
          }

          // 合并去重
          const allCookiesMap = new Map();
          for (const c of [...cookiesByUrl, ...domainCookies]) {
            const key = `${c.name}___${c.domain || ""}___${c.path || ""}`;
            allCookiesMap.set(key, c);
          }

          // 并发删除所有已收集的 Cookie
          const deletePromises = Array.from(allCookiesMap.values()).map((c) => {
            return new Promise((resolve) => {
              const delDetails = {
                url: location.href,
                name: c.name
              };
              if (c.domain) delDetails.domain = c.domain;
              if (c.path) delDetails.path = c.path;

              GM_cookie.delete(delDetails, () => {
                cookieCount++;
                resolve();
              });
            });
          });
          await Promise.all(deletePromises);
        } catch (e) {}
      }

      // 无论是否使用了 GM_cookie，均通过 document.cookie 进行逐级域名和 Path 的全域兜底双向清除
      try {
        const docCookies = this.getDocumentCookies();
        for (const c of docCookies) {
          document.cookie = `${encodeURIComponent(c.name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
          document.cookie = `${encodeURIComponent(c.name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${hostname}`;
          document.cookie = `${encodeURIComponent(c.name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${hostname}`;
          for (let i = 0; i < hostParts.length - 1; i++) {
            const domain = hostParts.slice(i).join(".");
            document.cookie = `${encodeURIComponent(c.name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`;
            document.cookie = `${encodeURIComponent(c.name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${domain}`;
          }
          cookieCount++;
        }
      } catch (e) {}

      let storageCount = 0;
      try {
        storageCount += localStorage.length;
        localStorage.clear();
      } catch (e) {}

      try {
        storageCount += sessionStorage.length;
        sessionStorage.clear();
      } catch (e) {}

      return { cookieCount, storageCount };
    },

    async restoreSession(sessionData) {
      // 切换与恢复前，先彻底清空当前所有 Cookie 与 WebStorage
      await this.clearAllData();

      let cookieSuccessCount = 0;
      let cookieFailCount = 0;

      if (Array.isArray(sessionData.cookies)) {
        if (this.hasGmCookie()) {
          const cookieSetPromises = sessionData.cookies.map((c) => {
            return new Promise((resolve) => {
              try {
                let targetDomain = c.domain || location.hostname;
                // 跨浏览器域名规范化：若当前主域名与保存域名的基准一致，统一写入当前 hostname
                if (targetDomain.startsWith(".")) {
                  const noDot = targetDomain.slice(1);
                  if (location.hostname === noDot) {
                    targetDomain = location.hostname;
                  }
                }
                const cookieDetails = {
                  url: location.href,
                  name: c.name,
                  value: c.value,
                  path: c.path || "/",
                  domain: targetDomain,
                  secure: !!c.secure,
                  httpOnly: !!c.httpOnly
                };
                if (c.sameSite && c.sameSite !== "unspecified") cookieDetails.sameSite = c.sameSite;
                if (c.expirationDate) cookieDetails.expirationDate = c.expirationDate;
                GM_cookie.set(cookieDetails, (err) => {
                  if (err) cookieFailCount++;
                  else cookieSuccessCount++;
                  resolve();
                });
              } catch (e) {
                cookieFailCount++;
                resolve();
              }
            });
          });
          await Promise.all(cookieSetPromises);
        } else {
          for (const c of sessionData.cookies) {
            try {
              let cookieStr = `${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}; path=${c.path || "/"}`;
              if (c.domain && !c.domain.startsWith(".")) cookieStr += `; domain=${c.domain}`;
              if (c.secure || location.protocol === "https:") cookieStr += "; Secure";
              if (c.expirationDate)
                cookieStr += `; expires=${new Date(c.expirationDate * 1000).toUTCString()}`;
              document.cookie = cookieStr;
              cookieSuccessCount++;
            } catch (e) {
              cookieFailCount++;
            }
          }
        }
      }

      let localCount = 0;
      if (sessionData.localStorage && typeof sessionData.localStorage === "object") {
        try {
          localStorage.clear();
          for (const [k, v] of Object.entries(sessionData.localStorage)) {
            if (v !== null && v !== undefined) {
              localStorage.setItem(k, v);
              localCount++;
            }
          }
        } catch (e) {}
      }

      let sessionCount = 0;
      if (sessionData.sessionStorage && typeof sessionData.sessionStorage === "object") {
        try {
          sessionStorage.clear();
          for (const [k, v] of Object.entries(sessionData.sessionStorage)) {
            if (v !== null && v !== undefined) {
              sessionStorage.setItem(k, v);
              sessionCount++;
            }
          }
        } catch (e) {}
      }

      return { cookieSuccessCount, cookieFailCount, localCount, sessionCount };
    }
  };

  // -----------------------------------------------------------------------
  // 数据库、墓碑管理与多域名存储
  // -----------------------------------------------------------------------
  const DB = {
    getStorageKey(domain) {
      return `SESSION_DATA_${domain || location.hostname}`;
    },

    getRecords(domain) {
      const key = this.getStorageKey(domain);
      const raw = GM_getValue(key, []);
      return Array.isArray(raw) ? raw : [];
    },

    saveRecords(records, domain) {
      const key = this.getStorageKey(domain);
      GM_setValue(key, records);
    },

    // --- 墓碑 (Tombstones) 机制 ---
    // 用于记录已删除快照的 ID 及删除时间戳，彻底杜绝两端同步时被旧云端数据反向复活
    getTombstones(domain) {
      const raw = GM_getValue("LSM_TOMBSTONES", {});
      const tombstones = (raw && typeof raw === "object") ? raw : {};

      // 30 天自动过期垃圾回收 (30 days in ms = 2592000000)
      const expireThreshold = Date.now() - 30 * 24 * 3600 * 1000;
      let changed = false;
      for (const d of Object.keys(tombstones)) {
        if (Array.isArray(tombstones[d])) {
          const filtered = tombstones[d].filter((t) => t && t.deletedAt && t.deletedAt > expireThreshold);
          if (filtered.length !== tombstones[d].length) {
            tombstones[d] = filtered;
            changed = true;
          }
        }
      }
      if (changed) {
        GM_setValue("LSM_TOMBSTONES", tombstones);
      }

      if (domain) {
        return Array.isArray(tombstones[domain]) ? tombstones[domain] : [];
      }
      return tombstones;
    },

    saveTombstones(tombstoneMap) {
      if (tombstoneMap && typeof tombstoneMap === "object") {
        GM_setValue("LSM_TOMBSTONES", tombstoneMap);
      }
    },

    recordTombstone(id, domain) {
      const d = domain || location.hostname;
      const allTombstones = this.getTombstones();
      if (!Array.isArray(allTombstones[d])) {
        allTombstones[d] = [];
      }
      const existing = allTombstones[d].find((t) => t.id === id);
      if (existing) {
        existing.deletedAt = Date.now();
      } else {
        allTombstones[d].push({ id, deletedAt: Date.now() });
      }
      this.saveTombstones(allTombstones);
    },

    clearTombstone(id, domain) {
      const d = domain || location.hostname;
      const allTombstones = this.getTombstones();
      if (Array.isArray(allTombstones[d])) {
        allTombstones[d] = allTombstones[d].filter((t) => t.id !== id);
        this.saveTombstones(allTombstones);
      }
    },

    async addRecord(name, rawSessionData) {
      const domain = location.hostname;
      const records = this.getRecords(domain);
      const cipherObject = await CryptoEngine.encrypt(rawSessionData);
      const now = Date.now();

      const newRecord = {
        id: "sess_" + now + "_" + Math.random().toString(36).slice(2, 7),
        name: name.trim(),
        domain: domain,
        url: location.href,
        createdAt: now,
        updatedAt: now,
        summary: rawSessionData.summary,
        cipherData: cipherObject
      };

      // 清除可能存在的同 ID 墓碑
      this.clearTombstone(newRecord.id, domain);

      records.unshift(newRecord);
      this.saveRecords(records, domain);
      CryptoEngine.wipeMemory(rawSessionData);

      // 触发自动同步调度
      if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
        GistSyncEngine.scheduleAutoSync();
      }

      return newRecord;
    },

    updateRecordName(id, newName, domain) {
      const d = domain || location.hostname;
      const records = this.getRecords(d);
      const target = records.find((r) => r.id === id);
      if (target) {
        target.name = newName.trim();
        target.updatedAt = Date.now();
        this.saveRecords(records, d);

        // 触发自动同步调度
        if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
          GistSyncEngine.scheduleAutoSync();
        }
        return true;
      }
      return false;
    },

    deleteRecord(id, domain) {
      const d = domain || location.hostname;
      let records = this.getRecords(d);
      const initialLen = records.length;
      records = records.filter((r) => r.id !== id);
      if (records.length !== initialLen) {
        this.saveRecords(records, d);
        // 关键：持久化记录墓碑，保证云端在后续同步中同步清除该记录！
        this.recordTombstone(id, d);

        // 触发自动同步调度
        if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
          GistSyncEngine.scheduleAutoSync();
        }
        return true;
      }
      return false;
    },

    importRecords(newRecords, domain) {
      const d = domain || location.hostname;
      const existing = this.getRecords(d);
      let count = 0;
      let skipped = 0;
      for (const item of newRecords) {
        if (!item || !item.name || !item.cipherData) continue;

        const itemCipherStr = typeof item.cipherData === "string" ? item.cipherData : JSON.stringify(item.cipherData);
        const isDuplicate = existing.some((r) => {
          if (!r || !r.cipherData) return false;
          const rCipherStr = typeof r.cipherData === "string" ? r.cipherData : JSON.stringify(r.cipherData);
          return rCipherStr === itemCipherStr || (r.id && item.id && r.id === item.id);
        });

        if (isDuplicate) {
          skipped++;
          continue;
        }

        const record = {
          ...item,
          id: item.id && !existing.some((r) => r.id === item.id) ? item.id : "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          importedAt: Date.now()
        };
        this.clearTombstone(record.id, d);

        existing.unshift(record);
        count++;
      }
      if (count > 0) {
        this.saveRecords(existing, d);
        if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
          GistSyncEngine.scheduleAutoSync();
        }
      }
      return { count, skipped };
    },

    getAllDomains() {
      const domains = new Set();
      try {
        if (typeof GM_listValues === "function") {
          const keys = GM_listValues();
          for (const key of keys) {
            if (key.startsWith("SESSION_DATA_")) {
              const dom = key.replace("SESSION_DATA_", "");
              if (dom) domains.add(dom);
            }
          }
        }
      } catch (e) {}

      domains.add(location.hostname);
      const hostRules = getHostRules();
      for (const h of hostRules) {
        try {
          const hostOnly = h.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^\*\./, "");
          if (hostOnly && !hostOnly.includes("*")) {
            domains.add(hostOnly);
          }
        } catch (e) {}
      }
      return Array.from(domains);
    },

    getAllLocalData() {
      const domains = this.getAllDomains();
      const recordsMap = {};
      let totalCount = 0;
      for (const d of domains) {
        const recs = this.getRecords(d);
        if (recs && recs.length > 0) {
          recordsMap[d] = recs;
          totalCount += recs.length;
        }
      }
      return {
        format: "LSM_GIST_SYNC",
        version: "1.4.4",
        lastSyncTime: GM_getValue("Config.sync_last_time", 0),
        totalSnapshots: totalCount,
        records: recordsMap,
        tombstones: this.getTombstones(),
        custom_themes: typeof ThemeEngine !== "undefined" ? ThemeEngine.getCustomThemes() : {},
        theme_tombstones: typeof ThemeEngine !== "undefined" ? ThemeEngine.getThemeTombstones() : {}
      };
    },

    applyMergedData(mergedRecordsMap, mergedTombstonesMap) {
      if (mergedRecordsMap && typeof mergedRecordsMap === "object") {
        for (const [domain, recs] of Object.entries(mergedRecordsMap)) {
          this.saveRecords(Array.isArray(recs) ? recs : [], domain);
        }
      }
      if (mergedTombstonesMap && typeof mergedTombstonesMap === "object") {
        this.saveTombstones(mergedTombstonesMap);
      }
    },

    overwriteAllLocalData(remoteRecordsMap, remoteTombstonesMap) {
      const localDomains = this.getAllDomains();
      for (const d of localDomains) {
        this.saveRecords([], d);
      }
      this.applyMergedData(remoteRecordsMap, remoteTombstonesMap);
    },

    async getDecryptedSession(id, domain) {
      const d = domain || location.hostname;
      const records = this.getRecords(d);
      const target = records.find((r) => r.id === id);
      if (!target) throw new Error("未找到对应快照记录");
      const recDomain = target.domain || d;
      return await CryptoEngine.decrypt(target.cipherData, recDomain);
    }
  };

  // -----------------------------------------------------------------------
  // GitHub Gist 云同步引擎 (双向增量合并 / 墓碑判定 / 首次连接冲突协商)
  // -----------------------------------------------------------------------
  const GistSyncEngine = {
    GIST_FILENAME: "web_snapshot_manager_sync.json",
    syncLock: false,
    autoSyncTimer: null,

    httpRequest(options) {
      return new Promise((resolve, reject) => {
        const { method = "GET", url, headers = {}, data } = options;

        if (typeof GM_xmlhttpRequest === "function") {
          GM_xmlhttpRequest({
            method,
            url,
            headers: {
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "WebSnapshotManager-Tampermonkey-Script",
              ...headers
            },
            data: data ? (typeof data === "string" ? data : JSON.stringify(data)) : undefined,
            timeout: 20000,
            onload: (res) => {
              try {
                let parsed = null;
                if (res.responseText) {
                  try {
                    parsed = JSON.parse(res.responseText);
                  } catch (e) {
                    parsed = res.responseText;
                  }
                }
                if (res.status >= 200 && res.status < 300) {
                  resolve({ status: res.status, data: parsed, headers: res.responseHeaders });
                } else {
                  const errorMsg = (parsed && parsed.message) || `HTTP ${res.status}: ${res.statusText || "请求失败"}`;
                  reject(new Error(errorMsg));
                }
              } catch (err) {
                reject(err);
              }
            },
            onerror: () => reject(new Error("网络请求失败，请检查网络或代理设置")),
            ontimeout: () => reject(new Error("网络请求超时 (20秒)"))
          });
        } else {
          fetch(url, {
            method,
            headers: {
              "Accept": "application/vnd.github.v3+json",
              ...headers
            },
            body: data ? (typeof data === "string" ? data : JSON.stringify(data)) : undefined
          })
            .then(async (res) => {
              const text = await res.text();
              let parsed = null;
              try {
                parsed = JSON.parse(text);
              } catch (e) {
                parsed = text;
              }
              if (res.ok) {
                resolve({ status: res.status, data: parsed });
              } else {
                reject(new Error((parsed && parsed.message) || `HTTP ${res.status}`));
              }
            })
            .catch((e) => reject(new Error("Fetch 网络异常: " + e.message)));
        }
      });
    },

    getToken() {
      return (GM_getValue("Config.sync_gist_token", "") || "").trim();
    },

    getGistId() {
      return (GM_getValue("Config.sync_gist_id", "") || "").trim();
    },

    isAutoSyncEnabled() {
      return Boolean(GM_getValue("Config.sync_auto", false));
    },

    getLastSyncTime() {
      return GM_getValue("Config.sync_last_time", 0);
    },

    setSyncConfig(config) {
      if (typeof config.token === "string") GM_setValue("Config.sync_gist_token", config.token.trim());
      if (typeof config.gistId === "string") GM_setValue("Config.sync_gist_id", config.gistId.trim());
      if (typeof config.autoSync === "boolean") GM_setValue("Config.sync_auto", config.autoSync);
      if (typeof config.lastSyncTime === "number") GM_setValue("Config.sync_last_time", config.lastSyncTime);
    },

    async testConnection(customToken) {
      const token = (customToken !== undefined ? customToken : this.getToken()).trim();
      if (!token) throw new Error("请输入 GitHub Personal Access Token");

      const res = await this.httpRequest({
        method: "GET",
        url: "https://api.github.com/user",
        headers: { "Authorization": `Bearer ${token}` }
      });

      return {
        success: true,
        login: res.data.login,
        name: res.data.name || res.data.login,
        avatar_url: res.data.avatar_url,
        public_gists: res.data.public_gists,
        private_gists: res.data.total_private_gists
      };
    },

    async listUserGists(token) {
      const t = (token || this.getToken()).trim();
      if (!t) throw new Error("请先输入有效的 GitHub Token");

      const res = await this.httpRequest({
        method: "GET",
        url: "https://api.github.com/gists?per_page=100",
        headers: { "Authorization": `Bearer ${t}` }
      });

      const gists = Array.isArray(res.data) ? res.data : [];
      return gists.map((g) => {
        const files = g.files ? Object.keys(g.files) : [];
        const isSnapshotGist = files.includes(this.GIST_FILENAME);
        return {
          id: g.id,
          description: g.description || "（未命名 Gist）",
          isPublic: g.public,
          files: files,
          isSnapshotGist: isSnapshotGist,
          createdAt: g.created_at,
          updatedAt: g.updated_at
        };
      });
    },

    async fetchRemoteGist(token, gistId) {
      const t = (token || this.getToken()).trim();
      const gid = (gistId || this.getGistId()).trim();
      if (!t) throw new Error("未配置 GitHub Token");
      if (!gid) throw new Error("未配置 Gist ID");

      const res = await this.httpRequest({
        method: "GET",
        url: `https://api.github.com/gists/${gid}`,
        headers: { "Authorization": `Bearer ${t}` }
      });

      const files = res.data.files || {};
      const targetFile = files[this.GIST_FILENAME];
      if (!targetFile) {
        return {
          exists: true,
          isEmpty: true,
          records: {},
          tombstones: {},
          lastSyncTime: 0,
          rawGist: res.data
        };
      }

      let contentObj = {};
      try {
        contentObj = JSON.parse(targetFile.content);
      } catch (e) {
        throw new Error("Gist 内快照数据 JSON 解析失败，格式可能已损坏");
      }

      return {
        exists: true,
        isEmpty: false,
        records: (contentObj && typeof contentObj.records === "object") ? contentObj.records : {},
        tombstones: (contentObj && typeof contentObj.tombstones === "object") ? contentObj.tombstones : {},
        custom_themes: (contentObj && typeof contentObj.custom_themes === "object") ? contentObj.custom_themes : {},
        theme_tombstones: (contentObj && typeof contentObj.theme_tombstones === "object") ? contentObj.theme_tombstones : {},
        lastSyncTime: contentObj.lastSyncTime || 0,
        version: contentObj.version || "1.0",
        rawGist: res.data
      };
    },

    async createGist(token, initialData) {
      const t = (token || this.getToken()).trim();
      if (!t) throw new Error("请先输入有效的 GitHub Token");

      const dataToSave = initialData || DB.getAllLocalData();
      dataToSave.lastSyncTime = Date.now();
      dataToSave.format = "LSM_GIST_SYNC";
      dataToSave.version = "1.4.4";
      if (!dataToSave.custom_themes && typeof ThemeEngine !== "undefined") {
        dataToSave.custom_themes = ThemeEngine.getCustomThemes();
      }
      if (!dataToSave.theme_tombstones && typeof ThemeEngine !== "undefined") {
        dataToSave.theme_tombstones = ThemeEngine.getThemeTombstones();
      }

      const res = await this.httpRequest({
        method: "POST",
        url: "https://api.github.com/gists",
        headers: {
          "Authorization": `Bearer ${t}`,
          "Content-Type": "application/json"
        },
        data: {
          description: "网站快照存储与恢复助手 - 云同步备份数据 (WebSnapshotManager)",
          public: false,
          files: {
            [this.GIST_FILENAME]: {
              content: JSON.stringify(dataToSave, null, 2)
            }
          }
        }
      });

      const newGistId = res.data.id;
      if (!newGistId) throw new Error("创建 Gist 失败，GitHub 未返回 Gist ID");

      this.setSyncConfig({ gistId: newGistId, lastSyncTime: Date.now() });
      return { gistId: newGistId, htmlUrl: res.data.html_url };
    },

    async updateGist(token, gistId, dataToSave) {
      const t = (token || this.getToken()).trim();
      const gid = (gistId || this.getGistId()).trim();
      if (!t) throw new Error("未配置 GitHub Token");
      if (!gid) throw new Error("未配置 Gist ID");

      const payload = {
        ...dataToSave,
        format: "LSM_GIST_SYNC",
        version: "1.4.4",
        lastSyncTime: Date.now()
      };

      await this.httpRequest({
        method: "PATCH",
        url: `https://api.github.com/gists/${gid}`,
        headers: {
          "Authorization": `Bearer ${t}`,
          "Content-Type": "application/json"
        },
        data: {
          description: "网站快照存储与恢复助手 - 云同步备份数据 (WebSnapshotManager)",
          files: {
            [this.GIST_FILENAME]: {
              content: JSON.stringify(payload, null, 2)
            }
          }
        }
      });

      this.setSyncConfig({ lastSyncTime: payload.lastSyncTime });
      return payload;
    },

    mergeThemeData(localThemes = {}, remoteThemes = {}, localThemeTombs = {}, remoteThemeTombs = {}) {
      const lThemes = (localThemes && typeof localThemes === "object") ? localThemes : {};
      const rThemes = (remoteThemes && typeof remoteThemes === "object") ? remoteThemes : {};
      const lTombs = (localThemeTombs && typeof localThemeTombs === "object") ? localThemeTombs : {};
      const rTombs = (remoteThemeTombs && typeof remoteThemeTombs === "object") ? remoteThemeTombs : {};

      // 1. 合并主题墓碑（保留 30 天内最新的删除记录）
      const mergedTombs = {};
      const expireThreshold = Date.now() - 30 * 24 * 3600 * 1000;
      const allTombKeys = new Set([...Object.keys(lTombs), ...Object.keys(rTombs)]);
      for (const id of allTombKeys) {
        const lTime = typeof lTombs[id] === "number" ? lTombs[id] : 0;
        const rTime = typeof rTombs[id] === "number" ? rTombs[id] : 0;
        const latestTime = Math.max(lTime, rTime);
        if (latestTime > expireThreshold) {
          mergedTombs[id] = latestTime;
        }
      }

      // 2. 合并自定义主题
      const mergedThemes = {};
      const allThemeIds = new Set([...Object.keys(lThemes), ...Object.keys(rThemes)]);
      let addedFromRemoteThemeCount = 0;
      let updatedThemeCount = 0;
      let purgedByThemeTombCount = 0;

      for (const id of allThemeIds) {
        const lTheme = lThemes[id];
        const rTheme = rThemes[id];
        const tombTime = mergedTombs[id] || 0;

        const isThemeDeleted = (t) => {
          if (!t) return true;
          const themeTime = t.updatedAt || t.createdAt || 0;
          return tombTime >= themeTime;
        };

        if (lTheme && isThemeDeleted(lTheme)) {
          purgedByThemeTombCount++;
          continue;
        }
        if (rTheme && isThemeDeleted(rTheme)) {
          purgedByThemeTombCount++;
          continue;
        }

        if (lTheme && !rTheme) {
          mergedThemes[id] = lTheme;
        } else if (!lTheme && rTheme) {
          if (typeof ThemeEngine !== "undefined") {
            try {
              mergedThemes[id] = ThemeEngine.validateAndNormalizeTheme(rTheme);
            } catch (e) {
              mergedThemes[id] = rTheme;
            }
          } else {
            mergedThemes[id] = rTheme;
          }
          addedFromRemoteThemeCount++;
        } else if (lTheme && rTheme) {
          const lTime = lTheme.updatedAt || lTheme.createdAt || 0;
          const rTime = rTheme.updatedAt || rTheme.createdAt || 0;
          if (rTime > lTime) {
            if (typeof ThemeEngine !== "undefined") {
              try {
                mergedThemes[id] = ThemeEngine.validateAndNormalizeTheme(rTheme);
              } catch (e) {
                mergedThemes[id] = rTheme;
              }
            } else {
              mergedThemes[id] = rTheme;
            }
            updatedThemeCount++;
          } else {
            mergedThemes[id] = lTheme;
          }
        }
      }

      return {
        customThemes: mergedThemes,
        themeTombstones: mergedTombs,
        stats: {
          totalThemes: Object.keys(mergedThemes).length,
          addedFromRemoteThemeCount,
          updatedThemeCount,
          purgedByThemeTombCount
        }
      };
    },

    mergeSnapshotData(localData, remoteData) {
      const localRecs = localData.records || {};
      const remoteRecs = remoteData.records || {};
      const localTombstones = localData.tombstones || {};
      const remoteTombstones = remoteData.tombstones || {};

      const allDomains = new Set([
        ...Object.keys(localRecs),
        ...Object.keys(remoteRecs),
        ...Object.keys(localTombstones),
        ...Object.keys(remoteTombstones)
      ]);

      const mergedTombstones = {};
      const expireThreshold = Date.now() - 30 * 24 * 3600 * 1000;

      for (const d of allDomains) {
        const lT = Array.isArray(localTombstones[d]) ? localTombstones[d] : [];
        const rT = Array.isArray(remoteTombstones[d]) ? remoteTombstones[d] : [];
        const tombMap = new Map();

        for (const t of [...lT, ...rT]) {
          if (!t || !t.id || !t.deletedAt) continue;
          if (t.deletedAt <= expireThreshold) continue;

          if (!tombMap.has(t.id) || tombMap.get(t.id).deletedAt < t.deletedAt) {
            tombMap.set(t.id, { id: t.id, deletedAt: t.deletedAt });
          }
        }
        if (tombMap.size > 0) {
          mergedTombstones[d] = Array.from(tombMap.values());
        }
      }

      const mergedRecords = {};
      let totalMergedCount = 0;
      let purgedByTombstoneCount = 0;
      let addedFromRemoteCount = 0;
      let updatedCount = 0;

      for (const d of allDomains) {
        const lList = Array.isArray(localRecs[d]) ? localRecs[d] : [];
        const rList = Array.isArray(remoteRecs[d]) ? remoteRecs[d] : [];
        const dTombs = mergedTombstones[d] || [];
        const tombIdMap = new Map(dTombs.map((t) => [t.id, t.deletedAt]));

        const recordMap = new Map();

        const isDeleted = (rec) => {
          if (!rec || !rec.id) return true;
          if (tombIdMap.has(rec.id)) {
            const delTime = tombIdMap.get(rec.id);
            const recTime = rec.updatedAt || rec.createdAt || 0;
            if (delTime >= recTime) {
              return true;
            }
          }
          return false;
        };

        for (const rec of lList) {
          if (isDeleted(rec)) {
            purgedByTombstoneCount++;
            continue;
          }
          recordMap.set(rec.id, rec);
        }

        for (const rRec of rList) {
          if (isDeleted(rRec)) {
            purgedByTombstoneCount++;
            continue;
          }

          if (!recordMap.has(rRec.id)) {
            recordMap.set(rRec.id, rRec);
            addedFromRemoteCount++;
          } else {
            const lRec = recordMap.get(rRec.id);
            const lTime = lRec.updatedAt || lRec.createdAt || 0;
            const rTime = rRec.updatedAt || rRec.createdAt || 0;

            if (rTime > lTime) {
              recordMap.set(rRec.id, rRec);
              updatedCount++;
            }
          }
        }

        const finalDomainRecs = Array.from(recordMap.values()).sort(
          (a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0)
        );

        if (finalDomainRecs.length > 0) {
          mergedRecords[d] = finalDomainRecs;
          totalMergedCount += finalDomainRecs.length;
        }
      }

      return {
        records: mergedRecords,
        tombstones: mergedTombstones,
        totalSnapshots: totalMergedCount,
        stats: {
          totalMergedCount,
          purgedByTombstoneCount,
          addedFromRemoteCount,
          updatedCount
        }
      };
    },

    async twoWaySync(options = {}) {
      const { silent = false } = options;

      if (this.syncLock) {
        if (!silent && typeof showToast === "function") {
          showToast("已有同步任务正在进行中，请稍候...", "info");
        }
        return { success: false, reason: "locked" };
      }

      const token = this.getToken();
      const gistId = this.getGistId();

      if (!token) {
        if (!silent && typeof showToast === "function") {
          showToast("请先在云同步设置中配置 GitHub Token", "error");
        }
        return { success: false, reason: "no_token" };
      }
      if (!gistId) {
        if (!silent && typeof showToast === "function") {
          showToast("请先配置 Gist ID 或点击一键自动创建", "error");
        }
        return { success: false, reason: "no_gist_id" };
      }

      this.syncLock = true;
      this.notifySyncStatus("syncing");

      try {
        if (!silent && typeof showToast === "function") {
          showToast("正在与 GitHub Gist 双向同步...", "info");
        }

        const localData = DB.getAllLocalData();
        const remoteData = await this.fetchRemoteGist(token, gistId);

        // 1. 合并快照记录与墓碑
        const mergedResult = this.mergeSnapshotData(localData, remoteData);
        DB.applyMergedData(mergedResult.records, mergedResult.tombstones);

        // 2. 合并自定义主题与主题墓碑
        const mergedThemeResult = this.mergeThemeData(
          localData.custom_themes || {},
          remoteData.custom_themes || {},
          localData.theme_tombstones || {},
          remoteData.theme_tombstones || {}
        );
        if (typeof ThemeEngine !== "undefined") {
          ThemeEngine.saveCustomThemesMap(mergedThemeResult.customThemes);
          ThemeEngine.saveThemeTombstones(mergedThemeResult.themeTombstones);
          ThemeEngine.applyTheme();
        }

        // 3. 将合并后的完整数据（快照 + 自定义主题）更新回远程 Gist
        await this.updateGist(token, gistId, {
          records: mergedResult.records,
          tombstones: mergedResult.tombstones,
          totalSnapshots: mergedResult.totalSnapshots,
          custom_themes: mergedThemeResult.customThemes,
          theme_tombstones: mergedThemeResult.themeTombstones
        });

        this.notifySyncStatus("success");

        if (typeof refreshList === "function") {
          refreshList();
        }
        if (typeof renderThemeList === "function") {
          renderThemeList();
        }
        if (typeof renderQuickThemeMenu === "function") {
          renderQuickThemeMenu();
        }

        if (!silent && typeof showToast === "function") {
          const s = mergedResult.stats;
          const ts = mergedThemeResult.stats;
          let msg = `同步成功！全域共 ${mergedResult.totalSnapshots} 条快照，${ts.totalThemes} 套自定义主题`;
          const details = [];
          if (s.addedFromRemoteCount > 0) details.push(`快照 +${s.addedFromRemoteCount}`);
          if (s.purgedByTombstoneCount > 0) details.push(`快照清理 -${s.purgedByTombstoneCount}`);
          if (ts.addedFromRemoteThemeCount > 0) details.push(`主题 +${ts.addedFromRemoteThemeCount}`);
          if (ts.purgedByThemeTombCount > 0) details.push(`主题清理 -${ts.purgedByThemeTombCount}`);
          if (details.length > 0) {
            msg += ` (${details.join("，")})`;
          }
          showToast(msg, "success");
        }

        return { success: true, result: mergedResult, themeResult: mergedThemeResult };
      } catch (err) {
        this.notifySyncStatus("error", err.message);
        if (!silent && typeof showToast === "function") {
          showToast(`同步失败: ${err.message}`, "error");
        }
        return { success: false, error: err };
      } finally {
        this.syncLock = false;
      }
    },

    scheduleAutoSync() {
      if (!this.isAutoSyncEnabled()) return;
      const token = this.getToken();
      const gistId = this.getGistId();
      if (!token || !gistId) return;

      if (this.autoSyncTimer) {
        clearTimeout(this.autoSyncTimer);
      }
      this.autoSyncTimer = setTimeout(() => {
        this.twoWaySync({ silent: true, checkConflict: false });
      }, 2000);
    },

    checkSyncOnOpen() {
      if (!this.isAutoSyncEnabled()) return;
      const token = this.getToken();
      const gistId = this.getGistId();
      if (!token || !gistId) return;

      const last = this.getLastSyncTime();
      const now = Date.now();
      if (!last || now - last > 5 * 60 * 1000) {
        this.twoWaySync({ silent: true, checkConflict: false });
      }
    },

    notifySyncStatus(status, errorMsg) {
      if (typeof updateCloudStatusUI === "function") {
        updateCloudStatusUI(status, errorMsg);
      }
    }
  };

  // -----------------------------------------------------------------------
  // 辅助工具
  // -----------------------------------------------------------------------
  function formatTime(timestamp) {
    if (!timestamp) return "-";
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return "-";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function getDefaultName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${location.hostname}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function downloadJsonFile(filename, contentObj) {
    try {
      const jsonStr = JSON.stringify(contentObj, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (e) {
      alert("下载文件失败: " + e.message);
    }
  }

  function downloadCanvasAsImage(canvas, filename) {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
      }, 100);
    } catch (e) {
      alert("下载图片失败: " + e.message);
    }
  }

  function readFileAsJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          resolve(json);
        } catch (err) {
          reject(new Error("文件解析失败，请确认选择的是正确的 JSON 格式文件"));
        }
      };
      reader.onerror = () => reject(new Error("读取文件出错"));
      reader.readAsText(file);
    });
  }

  // -----------------------------------------------------------------------
  // UI 结构与样式
  // -----------------------------------------------------------------------
  const uid = "lsm-" + Math.random().toString(36).slice(2, 8);
  const container = document.createElement("div");
  container.id = "lsm-session-manager-root";
  const shadow = container.attachShadow({ mode: "open" });
  ThemeEngine.bindShadow(shadow, uid);
  document.documentElement.appendChild(container);

  const style = document.createElement("style");
  style.textContent = `
    #${uid}-root {
      all: initial;
      display: block;
      box-sizing: border-box;
      font-family: var(--lsm-font-family, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      color: var(--lsm-text-primary, #24231f);
      font-size: 13px;
      line-height: 1.5;
      text-align: left;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      letter-spacing: 0.01em;
    }
    #${uid}-root *, #${uid}-root *::before, #${uid}-root *::after {
      box-sizing: border-box;
    }
    #${uid}-root input, #${uid}-root select, #${uid}-root textarea, #${uid}-root button {
      font-family: inherit;
    }

    /* 全局滚动条通用美化 (Shadow DOM 内部全部容器与列表) */
    #${uid}-root * {
      scrollbar-width: thin;
      scrollbar-color: var(--lsm-border-hover, #d0cec6) transparent;
    }
    #${uid}-root *::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    #${uid}-root *::-webkit-scrollbar-track {
      background: transparent;
      border-radius: 9999px;
    }
    #${uid}-root *::-webkit-scrollbar-thumb {
      background-color: var(--lsm-border-hover, #d0cec6);
      border-radius: 9999px;
      border: 1px solid transparent;
      background-clip: padding-box;
      transition: background-color 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    }
    #${uid}-root *::-webkit-scrollbar-thumb:hover {
      background-color: var(--lsm-accent, #c56473);
    }
    #${uid}-root *::-webkit-scrollbar-corner {
      background: transparent;
    }

    /* 悬浮球 (动态主题变量驱动) */
    #${uid}-ball {
      position: fixed;
      left: auto;
      top: auto;
      right: 25px;
      bottom: 80px;
      z-index: 2147483646;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--lsm-bg-paper, #faf9f5);
      border: 1px solid var(--lsm-accent-border, rgba(197, 100, 115, 0.28));
      color: var(--lsm-accent, #c56473);
      font-weight: 600;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 20px -2px var(--lsm-accent-glow, rgba(197, 100, 115, 0.2)), 0 2px 6px rgba(0, 0, 0, 0.05);
      cursor: grab;
      user-select: none;
      opacity: 0.75;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, opacity 0.25s ease, left 0.3s cubic-bezier(0.2, 0, 0, 1), top 0.3s cubic-bezier(0.2, 0, 0, 1), border-color 0.2s ease;
    }
    #${uid}-ball:hover {
      opacity: 1;
      transform: scale(1.05);
      box-shadow: 0 10px 28px -4px var(--lsm-accent-glow, rgba(197, 100, 115, 0.32)), 0 2px 8px rgba(0, 0, 0, 0.08);
      border-color: var(--lsm-accent, rgba(197, 100, 115, 0.55));
    }
    #${uid}-ball.dragging {
      opacity: 1;
      cursor: grabbing;
      transform: scale(0.96);
      transition: none;
    }
    #${uid}-ball svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
      pointer-events: none;
      filter: drop-shadow(0 1px 2px var(--lsm-accent-glow, rgba(197, 100, 115, 0.15)));
    }

    /* 悬浮球右上角微型关闭/菜单按钮 */
    .${uid}-ball-close {
      position: absolute;
      top: -3px;
      right: -3px;
      width: 17px;
      height: 17px;
      border-radius: 50%;
      line-height: 15px;
      background: var(--lsm-text-primary, #24231f);
      color: var(--lsm-bg-paper, #faf9f5);
      font-size: 11px;
      text-align: center;
      cursor: pointer;
      display: none;
      z-index: 3;
      border: 1.5px solid var(--lsm-bg-paper, #faf9f5);
      box-shadow: 0 2px 5px rgba(0,0,0,0.15);
      transition: background 0.15s ease, transform 0.15s ease;
    }
    #${uid}-ball:hover .${uid}-ball-close {
      display: block;
    }
    .${uid}-ball-close:hover {
      background: var(--lsm-color-danger, #a64953);
      transform: scale(1.15);
    }

    /* 徽标 */
    .${uid}-badge {
      position: absolute;
      top: -3px;
      left: -3px;
      background: var(--lsm-accent, #c56473);
      color: #ffffff;
      font-size: 10px;
      font-weight: 600;
      font-family: ui-monospace, "Cascadia Code PL", Consolas, monospace;
      font-variant-numeric: tabular-nums;
      min-width: 18px;
      height: 18px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
      border: 1.5px solid var(--lsm-bg-paper, #faf9f5);
      box-shadow: 0 2px 6px var(--lsm-accent-glow, rgba(197, 100, 115, 0.35));
    }

    /* 悬浮球快捷菜单遮罩与弹窗 */
    .${uid}-menu-mask {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      background: rgba(20, 19, 18, 0.45);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .${uid}-menu-mask.hidden { display: none; }
    .${uid}-ball-menu {
      position: fixed;
      left: 50%;
      top: 45%;
      transform: translate(-50%, -50%);
      z-index: 2147483647;
      background: var(--lsm-bg-paper, #faf9f5);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-window, 16px);
      box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0,0,0,0.04);
      padding: 18px;
      width: 280px;
      animation: lsmFadeIn .2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .${uid}-ball-menu-title {
      font-weight: 600;
      margin: 0 0 12px;
      font-size: 14px;
      color: var(--lsm-text-primary, #24231f);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-ball-menu button {
      display: flex;
      align-items: center;
      width: 100%;
      margin-top: 8px;
      padding: 8px 12px;
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-btn, 8px);
      background: var(--lsm-bg-card, #ffffff);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      text-align: left;
      color: var(--lsm-text-primary, #403f3a);
      transition: all 0.15s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .${uid}-ball-menu button:hover {
      background: var(--lsm-bg-hover, #f0efeb);
      border-color: var(--lsm-border-hover, #d0cec6);
      color: var(--lsm-text-primary, #24231f);
    }
    .${uid}-ball-menu button[data-a="forever"] {
      border-color: var(--lsm-border-danger, rgba(166, 73, 83, 0.2));
      background: var(--lsm-bg-danger, rgba(166, 73, 83, 0.06));
      color: var(--lsm-color-danger, #a64953);
    }
    .${uid}-ball-menu button[data-a="forever"]:hover {
      background: var(--lsm-bg-danger, rgba(166, 73, 83, 0.12));
      border-color: var(--lsm-color-danger, rgba(166, 73, 83, 0.35));
    }

    /* 主管理窗口 (Paper Card 架构) */
    #${uid}-window {
      position: fixed;
      left: auto;
      top: auto;
      right: 30px;
      bottom: 90px;
      z-index: 2147483646;
      width: 500px;
      height: 560px;
      max-width: calc(100vw - 20px);
      max-height: calc(100vh - 30px);
      background: var(--lsm-bg-paper, #faf9f5);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-window, 16px);
      overflow: hidden;
      overflow: clip;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.04);
      overscroll-behavior: contain;
      touch-action: none;
    }
    #${uid}-window.hidden, #${uid}-ball.hidden {
      display: none !important;
    }

    /* 头部 Header */
    #${uid}-header {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      background: var(--lsm-bg-header, #f0efeb);
      color: var(--lsm-text-primary, #24231f);
      font-size: 13.5px;
      font-weight: 600;
      cursor: grab;
      user-select: none;
      border-bottom: 1px solid var(--lsm-border, #e3e1db);
      position: relative;
    }
    #${uid}-header::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1.5px;
      background: linear-gradient(90deg, transparent 0%, var(--lsm-accent, #c56473) 20%, var(--lsm-accent, #c56473) 80%, transparent 100%);
      opacity: 0.7;
    }
    #${uid}-header.dragging {
      cursor: grabbing;
    }
    .${uid}-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .${uid}-header-title {
      display: flex;
      align-items: center;
      gap: 6px;
      letter-spacing: 0.02em;
    }
    .${uid}-domain-tag {
      background: var(--lsm-accent-bg, rgba(197, 100, 115, 0.08));
      border: 1px solid var(--lsm-accent-border, rgba(197, 100, 115, 0.2));
      color: var(--lsm-accent, #c56473);
      font-size: 11px;
      padding: 2px 9px;
      border-radius: 6px;
      font-weight: 500;
      font-family: ui-monospace, "Cascadia Code PL", Consolas, monospace;
      max-width: 180px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .${uid}-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-header-actions button {
      border: 1px solid rgba(0, 0, 0, 0.08);
      background: transparent;
      color: var(--lsm-text-muted, #787670);
      border-radius: 6px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s ease;
    }
    .${uid}-header-actions button:hover {
      background: var(--lsm-border, #e3e1db);
      color: var(--lsm-text-primary, #24231f);
    }

    /* 状态条 */
    .${uid}-status-bar {
      padding: 7px 18px;
      background: var(--lsm-bg-paper, #faf9f5);
      border-bottom: 1px solid var(--lsm-border, #e3e1db);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--lsm-text-muted, #787670);
      flex: none;
    }
    .${uid}-status-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
    }
    .${uid}-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
    }
    .${uid}-dot-green {
      background: var(--lsm-color-success, #5e9f7e);
      box-shadow: 0 0 0 2px var(--lsm-border-success, rgba(94, 159, 126, 0.2));
    }
    .${uid}-dot-amber {
      background: var(--lsm-color-warning, #a87a3d);
      box-shadow: 0 0 0 2px var(--lsm-border-warning, rgba(168, 122, 61, 0.2));
    }

    /* 操作工具栏 */
    .${uid}-toolbar {
      padding: 10px 18px;
      background: var(--lsm-bg-paper, #faf9f5);
      border-bottom: 1px solid var(--lsm-border, #e3e1db);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: none;
    }
    .${uid}-toolbar-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: nowrap;
    }
    .${uid}-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      border-radius: var(--lsm-radius-btn, 8px);
      border: 1px solid transparent;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .${uid}-btn:active {
      transform: translateY(1px);
    }
    .${uid}-btn-primary {
      background: var(--lsm-accent-bg, rgba(197, 100, 115, 0.08)) !important;
      color: var(--lsm-accent, #c56473) !important;
      border: 1px solid var(--lsm-accent-border, rgba(197, 100, 115, 0.3)) !important;
    }
    .${uid}-btn-primary:hover {
      background: var(--lsm-accent-hover-bg, rgba(197, 100, 115, 0.14)) !important;
      border-color: var(--lsm-accent, #c56473) !important;
      color: var(--lsm-accent, #c56473) !important;
    }
    .${uid}-btn-secondary {
      background: transparent;
      color: var(--lsm-text-primary, #403f3a);
      border: 1px solid var(--lsm-border, #e3e1db);
    }
    .${uid}-btn-secondary:hover {
      background: var(--lsm-bg-hover, #f0efeb);
      border-color: var(--lsm-border-hover, #d0cec6);
      color: var(--lsm-text-primary, #24231f);
    }
    .${uid}-btn-danger {
      background: var(--lsm-bg-danger, rgba(166, 73, 83, 0.08));
      color: var(--lsm-color-danger, #a64953);
      border: 1px solid var(--lsm-border-danger, rgba(166, 73, 83, 0.25));
    }
    .${uid}-btn-danger:hover {
      background: var(--lsm-bg-danger, rgba(166, 73, 83, 0.14));
      border-color: var(--lsm-color-danger, rgba(166, 73, 83, 0.4));
    }
    .${uid}-btn-restore-pill {
      background: var(--lsm-bg-success, rgba(94, 159, 126, 0.08)) !important;
      color: var(--lsm-color-success, #5e9f7e) !important;
      border: 1px solid var(--lsm-border-success, rgba(94, 159, 126, 0.28)) !important;
      font-weight: 500;
    }
    .${uid}-btn-restore-pill:hover {
      background: var(--lsm-bg-success, rgba(94, 159, 126, 0.16)) !important;
      border-color: var(--lsm-color-success, rgba(94, 159, 126, 0.45)) !important;
    }
    .${uid}-btn-sm {
      padding: 4px 9px;
      font-size: 11px;
      border-radius: 6px;
    }
    .${uid}-btn-icon {
      padding: 6px 8px !important;
      min-width: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* 更多操作下拉菜单 */
    .${uid}-dropdown-wrapper {
      position: relative;
      display: inline-flex;
      flex-shrink: 0;
    }
    .${uid}-dropdown-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      min-width: 180px;
      background: var(--lsm-bg-paper, #faf9f5);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-card, 12px);
      padding: 5px;
      box-shadow: 0 12px 30px -4px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0,0,0,0.04);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      z-index: 50;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .${uid}-dropdown-menu.hidden {
      display: none !important;
    }
    .${uid}-dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 500;
      color: var(--lsm-text-primary, #403f3a);
      border-radius: 7px;
      cursor: pointer;
      user-select: none;
      transition: all 0.12s ease;
      white-space: nowrap;
    }
    .${uid}-dropdown-item:hover {
      background: var(--lsm-bg-hover, #f0efeb);
      color: var(--lsm-text-primary, #24231f);
    }
    .${uid}-dropdown-divider {
      height: 1px;
      background: var(--lsm-border, #e3e1db);
      margin: 3px 0;
    }
    .${uid}-item-accent {
      color: var(--lsm-accent, #c56473) !important;
      font-weight: 500;
    }
    .${uid}-item-accent:hover {
      background: var(--lsm-accent-bg, rgba(197, 100, 115, 0.08)) !important;
      color: var(--lsm-accent, #c56473) !important;
    }

    /* 移动端与小屏幕自适应响应式布局 */
    @media (max-width: 480px) {
      #${uid}-window {
        left: 10px !important;
        right: 10px !important;
        bottom: 15px !important;
        width: auto !important;
        max-width: calc(100vw - 20px) !important;
        height: 82vh !important;
        border-radius: 14px;
      }
      #${uid}-header {
        padding: 10px 14px;
      }
      .${uid}-domain-tag {
        max-width: 170px;
        font-size: 10px;
        padding: 1px 6px;
      }
      .${uid}-toolbar {
        padding: 8px 12px;
        gap: 6px;
      }
      .${uid}-toolbar-row {
        gap: 6px;
      }
      .${uid}-btn {
        padding: 5px 8px;
        font-size: 11px;
        gap: 4px;
      }
      .${uid}-content {
        padding: 10px 12px;
        gap: 8px;
      }
      .${uid}-card {
        padding: 10px 12px;
      }
      .${uid}-card-chips {
        gap: 4px;
      }
      .${uid}-chip {
        font-size: 10px;
        padding: 1px 6px;
      }
      .${uid}-card-actions {
        flex-wrap: wrap;
        gap: 4px;
        justify-content: flex-end;
      }
      .${uid}-card-actions .${uid}-btn {
        padding: 4px 7px;
        font-size: 10px;
      }
      .${uid}-search-input {
        height: 30px;
        font-size: 11px;
        padding: 0 26px 0 28px;
      }
      .${uid}-theme-grid {
        grid-template-columns: 1fr !important;
        max-height: 280px;
      }
    }

    /* 搜索栏 */
    .${uid}-search-wrap {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
      margin-top: 2px;
    }
    .${uid}-search-icon {
      position: absolute;
      left: 10px;
      pointer-events: none;
      color: var(--lsm-text-placeholder, #a8a69f);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s ease;
    }
    .${uid}-search-input {
      width: 100%;
      height: 32px;
      padding: 0 28px 0 32px;
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-btn, 8px);
      background: var(--lsm-bg-card, #ffffff);
      background-image: linear-gradient(180deg, var(--lsm-accent-glow, rgba(197, 100, 115, 0.03)) 0%, transparent 26%);
      font-size: 12px;
      color: var(--lsm-text-primary, #24231f);
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .${uid}-search-input::placeholder {
      color: var(--lsm-text-placeholder, #a8a69f);
      font-size: 11px;
    }
    .${uid}-search-input:focus {
      background: var(--lsm-bg-card, #ffffff);
      border-color: var(--lsm-accent-border, rgba(197, 100, 115, 0.35));
      box-shadow: 0 0 0 3px var(--lsm-accent-glow, rgba(197, 100, 115, 0.1));
    }
    .${uid}-search-wrap:focus-within .${uid}-search-icon {
      color: var(--lsm-accent, #c56473);
    }
    .${uid}-search-clear {
      position: absolute;
      right: 7px;
      width: 17px;
      height: 17px;
      border-radius: 50%;
      border: none;
      background: var(--lsm-border, #e3e1db);
      color: var(--lsm-text-muted, #787670);
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: all 0.15s ease;
    }
    .${uid}-search-clear:hover {
      background: var(--lsm-border-hover, #d0cec6);
      color: var(--lsm-text-primary, #24231f);
      transform: scale(1.08);
    }
    .${uid}-search-clear.hidden {
      display: none !important;
    }

    /* 记录列表区域 */
    .${uid}-content {
      padding: 12px 18px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      background: var(--lsm-bg-list, #f9f8f5);
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
    .${uid}-card {
      background: var(--lsm-bg-card, #ffffff);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-card, 12px);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
      transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .${uid}-card:hover {
      border-color: var(--lsm-border-hover, #d0cec6);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px -2px rgba(0, 0, 0, 0.06);
    }
    .${uid}-card.${uid}-card-active {
      border-color: var(--lsm-border-success, rgba(94, 159, 126, 0.38));
      background: var(--lsm-bg-active-card, linear-gradient(180deg, rgba(94, 159, 126, 0.05) 0%, #ffffff 60%));
      box-shadow: 0 4px 14px -2px var(--lsm-border-success, rgba(94, 159, 126, 0.12));
    }
    .${uid}-badge-active {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
      background: var(--lsm-bg-success, rgba(94, 159, 126, 0.12));
      color: var(--lsm-color-success, #5e9f7e);
      border: 1px solid var(--lsm-border-success, rgba(94, 159, 126, 0.25));
      margin-left: 4px;
      flex-shrink: 0;
    }
    .${uid}-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .${uid}-card-name {
      font-weight: 600;
      font-size: 13px;
      color: var(--lsm-text-primary, #24231f);
      word-break: break-all;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-card-time {
      font-size: 11px;
      color: var(--lsm-text-muted, #787670);
      font-family: ui-monospace, "Cascadia Code PL", Consolas, monospace;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    
    /* 凭证 Chips 徽章组 */
    .${uid}-card-chips {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .${uid}-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 500;
      padding: 2px 7px;
      border-radius: 6px;
      line-height: 1.35;
      font-family: ui-monospace, "Cascadia Code PL", Consolas, monospace;
      font-variant-numeric: tabular-nums;
    }
    .${uid}-chip-cookie {
      background: var(--lsm-bg-warning, rgba(168, 122, 61, 0.08));
      color: var(--lsm-color-warning, #a87a3d);
      border: 1px solid var(--lsm-border-warning, rgba(168, 122, 61, 0.2));
    }
    .${uid}-chip-local {
      background: var(--lsm-bg-success, rgba(94, 159, 126, 0.08));
      color: var(--lsm-color-success, #5e9f7e);
      border: 1px solid var(--lsm-border-success, rgba(94, 159, 126, 0.2));
    }
    .${uid}-chip-session {
      background: var(--lsm-bg-info, rgba(61, 104, 150, 0.08));
      color: var(--lsm-color-info, #3d6896);
      border: 1px solid var(--lsm-border-info, rgba(61, 104, 150, 0.2));
    }
    .${uid}-chip-encrypted {
      background: var(--lsm-accent-bg, rgba(197, 100, 115, 0.08));
      color: var(--lsm-accent, #c56473);
      border: 1px solid var(--lsm-accent-border, rgba(197, 100, 115, 0.2));
    }

    /* 来源链接小标签 */
    .${uid}-card-origin {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--lsm-bg-header, #f0efeb);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: 6px;
      padding: 3px 8px;
      margin-top: 2px;
      font-size: 11px;
      color: var(--lsm-text-muted, #787670);
    }
    .${uid}-card-url {
      color: var(--lsm-accent, #c56473);
      text-decoration: none;
      word-break: break-all;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-block;
      max-width: calc(100% - 60px);
    }
    .${uid}-card-url:hover {
      text-decoration: underline;
    }

    /* 卡片操作栏 */
    .${uid}-card-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
      border-top: 1px solid var(--lsm-border, #f0efeb);
      padding-top: 8px;
      margin-top: 2px;
    }
    .${uid}-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 50px 0;
      color: var(--lsm-text-placeholder, #a8a69f);
      text-align: center;
      gap: 8px;
    }

    /* 抽屉基础样式 (未打开时强制 display: none，彻底杜绝外层窗口滚动穿透或焦点跳转导致的错位) */
    .${uid}-save-dialog,
    .${uid}-qr-dialog,
    .${uid}-scan-dialog,
    .${uid}-sync-dialog,
    .${uid}-theme-dialog {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--lsm-bg-paper, #faf9f5);
      display: none;
      flex-direction: column;
      padding: 20px;
      gap: 14px;
      transform: translateY(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 10;
      overscroll-behavior: contain;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
      border-top: 1px solid var(--lsm-border, #e3e1db);
      box-sizing: border-box;
      pointer-events: none;
    }
    .${uid}-save-dialog.open,
    .${uid}-qr-dialog.open,
    .${uid}-scan-dialog.open,
    .${uid}-sync-dialog.open,
    .${uid}-theme-dialog.open {
      display: flex !important;
      transform: translateY(0);
      pointer-events: auto;
    }
    .${uid}-dialog-header,
    .${uid}-save-dialog-title {
      font-size: 14.5px;
      font-weight: 600;
      color: var(--lsm-text-primary, #24231f);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      border-bottom: 1px solid var(--lsm-border, #e3e1db);
      padding-bottom: 10px;
    }
    .${uid}-dialog-title {
      font-size: 14.5px;
      font-weight: 600;
      color: var(--lsm-text-primary, #24231f);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-dialog-close {
      background: none;
      border: none;
      font-size: 16px;
      line-height: 1;
      color: var(--lsm-text-muted, #787670);
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .${uid}-dialog-close:hover {
      color: var(--lsm-text-primary, #24231f);
      background: var(--lsm-bg-hover, #f0efeb);
    }

    .${uid}-input-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .${uid}-input-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--lsm-text-secondary, #5c5a55);
    }
    .${uid}-input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-btn, 8px);
      font-size: 12.5px;
      outline: none;
      background: var(--lsm-bg-card, #ffffff);
      background-image: linear-gradient(180deg, var(--lsm-accent-glow, rgba(197, 100, 115, 0.03)) 0%, transparent 26%);
      color: var(--lsm-text-primary, #24231f);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .${uid}-input:focus {
      border-color: var(--lsm-accent-border, rgba(197, 100, 115, 0.35));
      box-shadow: 0 0 0 3px var(--lsm-accent-glow, rgba(197, 100, 115, 0.1));
    }
    .${uid}-grid-preview {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 4px;
    }
    .${uid}-stat-box {
      background: var(--lsm-bg-card, #ffffff);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-card, 10px);
      padding: 10px;
      text-align: center;
    }
    .${uid}-stat-num {
      font-size: 18px;
      font-weight: 600;
      font-family: ui-monospace, "Cascadia Code PL", Consolas, monospace;
      font-variant-numeric: tabular-nums;
      color: var(--lsm-text-primary, #24231f);
      margin-top: 2px;
    }
    .${uid}-stat-label {
      font-size: 11px;
      color: var(--lsm-text-muted, #787670);
    }

    /* 快照二维码展示抽屉 */
    .${uid}-qr-box {
      background: var(--lsm-bg-header, #f0efeb);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-card, 12px);
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    .${uid}-qr-canvas-wrap {
      background: #ffffff;
      padding: 10px;
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-card, 12px);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);
      display: flex;
      align-items: center;
      justify-content: center;
      max-width: 100%;
    }
    .${uid}-qr-canvas-wrap canvas {
      max-width: 100%;
      height: auto !important;
      display: block;
      border-radius: 6px;
    }
    .${uid}-qr-overflow-box {
      background: var(--lsm-bg-warning, rgba(168, 122, 61, 0.06));
      border: 1px solid var(--lsm-border-warning, rgba(168, 122, 61, 0.25));
      border-radius: var(--lsm-radius-card, 12px);
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-align: center;
      max-width: 100%;
    }
    .${uid}-qr-chunk-player {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      width: 100%;
      background: var(--lsm-bg-card, #ffffff);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-card, 12px);
      padding: 12px;
    }
    .${uid}-qr-chunk-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      font-size: 12px;
      color: var(--lsm-text-primary, #403f3a);
      font-weight: 500;
    }
    .${uid}-qr-chunk-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--lsm-accent-bg, rgba(197, 100, 115, 0.08));
      color: var(--lsm-accent, #c56473);
      border: 1px solid var(--lsm-accent-border, rgba(197, 100, 115, 0.2));
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      font-family: ui-monospace, "Cascadia Code PL", Consolas, monospace;
    }
    .${uid}-qr-chunk-bar-wrap {
      width: 100%;
      height: 5px;
      background: var(--lsm-border, #e3e1db);
      border-radius: 9999px;
      overflow: hidden;
    }
    .${uid}-qr-chunk-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--lsm-accent, #c56473), var(--lsm-accent-glow, #e08c99));
      border-radius: 9999px;
      transition: width 0.15s ease;
    }
    .${uid}-qr-chunk-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
    }

    /* 摄像头扫码 */
    .${uid}-camera-viewport {
      position: relative;
      width: 100%;
      height: 220px;
      background: #141312;
      border-radius: var(--lsm-radius-card, 12px);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25) inset;
    }
    .${uid}-camera-video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .${uid}-camera-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #a8a69f;
      gap: 8px;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      background: rgba(20, 19, 18, 0.92);
      z-index: 2;
    }
    .${uid}-scan-chunk-hud {
      position: absolute;
      top: 8px;
      left: 8px;
      right: 8px;
      background: rgba(20, 19, 18, 0.9);
      backdrop-filter: blur(8px);
      border: 1px solid var(--lsm-accent-border, rgba(197, 100, 115, 0.4));
      border-radius: 10px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 6;
      color: #faf9f5;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .${uid}-scan-chunk-title {
      font-size: 11px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #faf9f5;
    }
    .${uid}-scan-chunk-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      max-height: 48px;
      overflow-y: auto;
      padding: 2px 0;
    }
    .${uid}-scan-chunk-dot {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 600;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.1);
      color: #a8a69f;
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-family: ui-monospace, "Cascadia Code PL", Consolas, monospace;
      transition: all 0.15s ease;
    }
    .${uid}-scan-chunk-dot.received {
      background: var(--lsm-color-success, #5e9f7e);
      color: #ffffff;
      border-color: var(--lsm-border-success, #8cbea3);
      box-shadow: 0 0 5px var(--lsm-color-success, rgba(94, 159, 126, 0.7));
      transform: scale(1.05);
    }
    .${uid}-scan-frame {
      position: absolute;
      width: 170px;
      height: 170px;
      border: 2px solid var(--lsm-accent, rgba(197, 100, 115, 0.7));
      border-radius: 12px;
      box-shadow: 0 0 0 9999px rgba(20, 19, 18, 0.5);
      z-index: 3;
      pointer-events: none;
    }
    .${uid}-scan-corner {
      position: absolute;
      width: 16px;
      height: 16px;
      border-color: var(--lsm-accent, #c56473);
      border-style: solid;
    }
    .${uid}-scan-corner-tl { top: -2px; left: -2px; border-width: 3px 0 0 3px; border-top-left-radius: 8px; }
    .${uid}-scan-corner-tr { top: -2px; right: -2px; border-width: 3px 3px 0 0; border-top-right-radius: 8px; }
    .${uid}-scan-corner-bl { bottom: -2px; left: -2px; border-width: 0 0 3px 3px; border-bottom-left-radius: 8px; }
    .${uid}-scan-corner-br { bottom: -2px; right: -2px; border-width: 0 3px 3px 0; border-bottom-right-radius: 8px; }

    .${uid}-scan-laser {
      position: absolute;
      left: 6px;
      right: 6px;
      height: 2px;
      background: linear-gradient(90deg, transparent 0%, var(--lsm-accent, #c56473) 50%, transparent 100%);
      box-shadow: 0 0 10px var(--lsm-accent, #c56473), 0 0 4px var(--lsm-color-danger, #a64953);
      animation: ${uid}-laser-anim 2s infinite ease-in-out;
      z-index: 4;
      pointer-events: none;
    }
    @keyframes ${uid}-laser-anim {
      0% { top: 8px; opacity: 0.8; }
      50% { top: calc(100% - 10px); opacity: 1; }
      100% { top: 8px; opacity: 0.8; }
    }

    /* 导入上传选择区 */
    .${uid}-import-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .${uid}-dropzone-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 12px 8px;
      background: var(--lsm-bg-card, #ffffff);
      border: 1px dashed var(--lsm-border-hover, #d0cec6);
      border-radius: var(--lsm-radius-card, 10px);
      cursor: pointer;
      transition: all 0.15s ease;
      color: var(--lsm-text-primary, #403f3a);
      gap: 6px;
      text-align: center;
    }
    .${uid}-dropzone-btn:hover {
      background: var(--lsm-bg-hover, #f0efeb);
      border-color: var(--lsm-accent, #c56473);
      color: var(--lsm-accent, #c56473);
    }
    .${uid}-dropzone-label {
      font-size: 12px;
      font-weight: 500;
    }
    .${uid}-dropzone-hint {
      font-size: 10px;
      color: var(--lsm-text-muted, #787670);
    }

    /* 识别成功结果展示卡片 */
    .${uid}-result-card {
      background: var(--lsm-bg-success, rgba(94, 159, 126, 0.06));
      border: 1px solid var(--lsm-border-success, rgba(94, 159, 126, 0.25));
      border-radius: var(--lsm-radius-card, 12px);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .${uid}-result-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--lsm-color-success, #5e9f7e);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-result-domain-warn {
      background: var(--lsm-bg-warning, rgba(168, 122, 61, 0.08));
      border: 1px solid var(--lsm-border-warning, rgba(168, 122, 61, 0.25));
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11px;
      color: var(--lsm-color-warning, #a87a3d);
      line-height: 1.5;
    }

    /* 云同步状态指示点与动效 */
    .${uid}-dot-cloud {
      background: var(--lsm-text-placeholder, #a8a69f);
    }
    .${uid}-dot-cloud.ok {
      background: var(--lsm-color-success, #5e9f7e);
      box-shadow: 0 0 0 2px var(--lsm-border-success, rgba(94, 159, 126, 0.2));
    }
    .${uid}-dot-cloud.syncing {
      background: var(--lsm-accent, #c56473);
      box-shadow: 0 0 0 2px var(--lsm-accent-glow, rgba(197, 100, 115, 0.2));
      animation: ${uid}Pulse 1.2s infinite;
    }
    .${uid}-dot-cloud.warn {
      background: var(--lsm-color-warning, #a87a3d);
    }
    .${uid}-dot-cloud.err {
      background: var(--lsm-color-danger, #a64953);
    }

    @keyframes ${uid}Pulse {
      0% { opacity: 0.6; }
      50% { opacity: 1; }
      100% { opacity: 0.6; }
    }

    @keyframes ${uid}Spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .${uid}-icon-sync.spinning {
      animation: ${uid}Spin 0.85s linear infinite;
    }

    /* 云同步专属抽屉 */
    .${uid}-sync-body,
    .${uid}-theme-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
      overscroll-behavior: contain;
      flex: 1;
      min-height: 0;
      padding-right: 0;
      box-sizing: border-box;
    }

    .${uid}-sync-status-card,
    .${uid}-theme-current-card {
      background: var(--lsm-bg-card, #ffffff);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-card, 12px);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .${uid}-sync-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: var(--lsm-bg-card, #ffffff);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: 10px;
    }

    /* Switch 切换开关 */
    .${uid}-switch {
      position: relative;
      display: inline-block;
      width: 38px;
      height: 22px;
      flex-shrink: 0;
    }
    .${uid}-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .${uid}-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--lsm-border-hover, #d0cec6);
      transition: .2s;
      border-radius: 22px;
    }
    .${uid}-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .2s cubic-bezier(0.22, 1, 0.36, 1);
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    }
    .${uid}-switch input:checked + .${uid}-slider {
      background-color: var(--lsm-accent, #c56473);
    }
    .${uid}-switch input:checked + .${uid}-slider:before {
      transform: translateX(16px);
    }

    /* 主题管理网格 (Theme Grid) */
    .${uid}-theme-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-auto-rows: max-content;
      align-content: start;
      gap: 7px;
      max-height: 195px;
      overflow-y: auto;
      padding: 2px;
      box-sizing: border-box;
    }
    .${uid}-theme-item {
      background: var(--lsm-bg-card, #ffffff);
      border: 1px solid var(--lsm-border, #e3e1db);
      border-radius: var(--lsm-radius-card, 10px);
      padding: 9px 10px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 6px;
      position: relative;
      transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
      min-width: 0;
      min-height: 52px;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .${uid}-theme-item:hover {
      border-color: var(--lsm-accent, #c56473);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px var(--lsm-accent-glow, rgba(0,0,0,0.06));
    }
    .${uid}-theme-item.${uid}-theme-item-active {
      border-color: var(--lsm-accent, #c56473);
      background: var(--lsm-accent-bg, rgba(197, 100, 115, 0.04));
      box-shadow: 0 0 0 1.5px var(--lsm-accent, #c56473);
    }
    .${uid}-theme-item-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
      width: 100%;
      flex-shrink: 0;
    }
    .${uid}-theme-item-title {
      font-weight: 600;
      font-size: 12px;
      color: var(--lsm-text-primary, #24231f);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex: 1;
    }
    .${uid}-theme-item-badge {
      flex-shrink: 0;
      white-space: nowrap;
    }
    .${uid}-theme-item-palette {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 1px;
      flex-shrink: 0;
      min-height: 14px;
    }
    .${uid}-theme-swatch-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1px solid rgba(0,0,0,0.12);
      flex-shrink: 0;
      display: inline-block;
      box-sizing: border-box;
    }

    /* Toast 提示 */
    .${uid}-toast {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(-10px);
      background: var(--lsm-text-primary, #24231f);
      color: var(--lsm-bg-paper, #faf9f5);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25);
      opacity: 0;
      pointer-events: none;
      z-index: 2147483647;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .${uid}-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .${uid}-toast.success {
      background: var(--lsm-color-success, #5e9f7e);
      color: #ffffff;
    }
    .${uid}-toast.error {
      background: var(--lsm-color-danger, #a64953);
      color: #ffffff;
    }
    .${uid}-toast.info {
      background: var(--lsm-text-primary, #24231f);
      color: var(--lsm-bg-paper, #faf9f5);
    }

  `;
  shadow.appendChild(style);

  const wrapper = document.createElement("div");
  wrapper.id = `${uid}-root`;
  wrapper.className = `${uid}-root`;
  setSafeInnerHTML(wrapper, `
    <!-- 悬浮球 -->
    <div id="${uid}-ball" title="快照管理助手">
      <span class="${uid}-ball-close" title="更多选项">×</span>
      <div class="${uid}-badge" id="${uid}-badge" style="display: none;">0</div>
      <svg viewBox="0 0 24 24">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm4.5 9c0 1.25-.8 2.25-2.5 2.5v.5h-4v-.5C8.3 18.25 7.5 17.25 7.5 16c0-1.66 2.01-3 4.5-3s4.5 1.34 4.5 3z"/>
      </svg>
    </div>

    <!-- 悬浮球快捷菜单 -->
    <div class="${uid}-menu-mask hidden" id="${uid}-menu-mask">
      <div class="${uid}-ball-menu">
        <div class="${uid}-ball-menu-title">🔑 快照管理助手</div>
        <button data-a="open">打开快照管理窗口</button>
        <button data-a="save">一键加密保存当前快照</button>
        <button data-a="temp">临时隐藏悬浮球（本次）</button>
        <button data-a="forever">永久关闭（不再对此网站生效）</button>
      </div>
    </div>

    <!-- 主管理窗口 -->
    <div id="${uid}-window" class="hidden">
      <!-- 头部 -->
      <div id="${uid}-header">
        <div class="${uid}-header-left">
          <div class="${uid}-header-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span>快照管理</span>
          </div>
          <span class="${uid}-domain-tag" title="${location.hostname}">${location.hostname}</span>
        </div>
        <div class="${uid}-header-actions">
          <div class="${uid}-theme-quick-wrap" style="position: relative; display: inline-flex;">
            <button id="${uid}-btn-quick-theme" class="${uid}-btn-quick-theme" title="快速切换主题" style="font-size: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
              🎨
            </button>
            <div class="${uid}-dropdown-menu ${uid}-theme-quick-menu hidden" id="${uid}-theme-quick-menu" style="top: calc(100% + 7px); right: 0; min-width: 210px; z-index: 60;">
              <div style="font-size: 11px; font-weight: 600; color: var(--lsm-text-muted); padding: 4px 8px 3px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--lsm-border);">
                <span>🎨 快速切换主题</span>
                <span id="${uid}-theme-quick-count" style="font-size: 10px; font-weight: normal; color: var(--lsm-text-placeholder);"></span>
              </div>
              <div class="${uid}-theme-quick-list" id="${uid}-theme-quick-list" style="display: flex; flex-direction: column; gap: 2px; max-height: 190px; overflow-y: auto; padding: 4px 0;">
                <!-- Themes dynamically populated -->
              </div>
              <div class="${uid}-dropdown-divider" style="margin: 2px 0;"></div>
              <div class="${uid}-dropdown-item ${uid}-item-accent" id="${uid}-btn-open-theme-settings" style="font-size: 11.5px; font-weight: 500; padding: 7px 8px;">
                <span style="font-size: 12px;">⚙️</span>
                <span>主题风格与个性化设置</span>
              </div>
            </div>
          </div>
          <button id="${uid}-btn-close" title="隐藏">×</button>
        </div>
      </div>

      <!-- 状态条 -->
      <div class="${uid}-status-bar">
        <div class="${uid}-status-item">
          <span class="${uid}-dot ${SessionManager.hasGmCookie() ? `${uid}-dot-green` : `${uid}-dot-amber`}"></span>
          <span>Cookie: ${SessionManager.hasGmCookie() ? "全量 (GM_cookie)" : "基础 (document.cookie)"}</span>
        </div>
        <div class="${uid}-status-item">
          <span class="${uid}-dot ${isEncryptionEnabled() ? `${uid}-dot-green` : `${uid}-dot-amber`}"></span>
          <span>存储加密: ${isEncryptionEnabled() ? "AES-GCM" : "明文"}</span>
        </div>
        <div class="${uid}-status-item" id="${uid}-status-cloud" style="cursor: pointer;" title="点击打开 GitHub Gist 云同步设置">
          <span class="${uid}-dot ${uid}-dot-cloud" id="${uid}-dot-cloud"></span>
          <span id="${uid}-status-cloud-text">☁️ 云同步: 未配置</span>
        </div>
      </div>

      <!-- 操作工具栏 -->
      <div class="${uid}-toolbar">
        <div class="${uid}-toolbar-row">
          <button class="${uid}-btn ${uid}-btn-primary" id="${uid}-btn-save-current" style="flex: 1.1;" title="一键保存当前快照">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            <span>一键保存</span>
          </button>
          <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-sync-toolbar" title="立即与 GitHub Gist 双向增量同步">
            <svg class="${uid}-icon-sync" id="${uid}-sync-toolbar-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8M22 12.5a10 10 0 0 1-18.8 4.2L2.5 16"></path>
            </svg>
            <span>同步</span>
          </button>
          <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-open-scan" title="扫码或导入快照数据">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M9 9h6v6H9z"></path>
            </svg>
            <span>扫码/导入</span>
          </button>
          <button class="${uid}-btn ${uid}-btn-danger" id="${uid}-btn-clear-current" title="清空当前网站所有Cookie及Storage数据">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>清空</span>
          </button>
          <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-reload" title="刷新页面以生效">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            <span>刷新</span>
          </button>
          <!-- 更多操作下拉按钮 -->
          <div class="${uid}-dropdown-wrapper">
            <button class="${uid}-btn ${uid}-btn-secondary ${uid}-btn-icon" id="${uid}-btn-more" title="更多导入导出与恢复选项">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1.5"></circle>
                <circle cx="19" cy="12" r="1.5"></circle>
                <circle cx="5" cy="12" r="1.5"></circle>
              </svg>
            </button>
            <div class="${uid}-dropdown-menu hidden" id="${uid}-dropdown-menu">
              <div class="${uid}-dropdown-item ${uid}-item-accent" id="${uid}-btn-menu-cloud">
                ☁️
                <span>云同步设置 (Gist)</span>
              </div>
              <div class="${uid}-dropdown-item" id="${uid}-btn-menu-sync-now">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8M22 12.5a10 10 0 0 1-18.8 4.2L2.5 16"></path>
                </svg>
                <span>立即双向同步</span>
              </div>
              <div class="${uid}-dropdown-divider"></div>

            <div class="${uid}-dropdown-item ${uid}-item-accent" id="${uid}-btn-menu-scan">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M9 9h6v6H9z"></path>
                </svg>
                <span>扫码与快照导入</span>
              </div>
              <div class="${uid}-dropdown-divider"></div>
              <div class="${uid}-dropdown-item" id="${uid}-btn-export-all">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <span>批量导出记录</span>
              </div>
              <div class="${uid}-dropdown-item" id="${uid}-btn-import-all">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>批量导入记录</span>
              </div>
              <div class="${uid}-dropdown-divider"></div>
              <div class="${uid}-dropdown-item" id="${uid}-btn-restore-file">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
                <span>从文件恢复(不导入)</span>
              </div>
              <div class="${uid}-dropdown-item" id="${uid}-btn-restore-clipboard" style="color: #0284c7; font-weight: 500;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>从剪贴板恢复(免文件)</span>
              </div>
            </div>
          </div>
        </div>
        <!-- 搜索过滤条 -->
        <div class="${uid}-search-wrap">
          <svg class="${uid}-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="${uid}-search-input" id="${uid}-search-input" placeholder="搜索快照名称或时间..." />
          <button class="${uid}-search-clear hidden" id="${uid}-search-clear" title="清空搜索">✕</button>
        </div>
      </div>
      <!-- 隐藏的文件选择器 -->
      <input type="file" id="${uid}-file-import" accept=".json" style="display: none;" />
      <input type="file" id="${uid}-file-restore-direct" accept=".json" style="display: none;" />
      <input type="file" id="${uid}-file-scan-image" accept="image/*" style="display: none;" />
      <input type="file" id="${uid}-file-scan-json" accept=".json" style="display: none;" />
      <input type="file" id="${uid}-file-theme-json" accept=".json,application/json" style="display: none;" />
      <canvas id="${uid}-scan-hidden-canvas" style="display: none;"></canvas>

      <!-- 列表区 -->
      <div class="${uid}-content" id="${uid}-list"></div>

      <!-- 保存抽屉对话框 -->
      <div class="${uid}-save-dialog" id="${uid}-save-dialog">
        <div class="${uid}-save-dialog-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c56473" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          <span>保存当前快照</span>
        </div>
        <div class="${uid}-input-group">
          <label class="${uid}-input-label">记录名称</label>
          <input type="text" class="${uid}-input" id="${uid}-input-name" placeholder="请输入自定义名称" />
        </div>
        <div class="${uid}-input-group">
          <label class="${uid}-input-label">凭据扫描预览</label>
          <div id="${uid}-preview-box">
            <div style="font-size: 12px; color: #787670;">正在扫描当前页面快照凭据...</div>
          </div>
        </div>
        <div style="margin-top: auto; display: flex; justify-content: flex-end; gap: 8px;">
          <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-cancel-save">取消</button>
          <button class="${uid}-btn ${uid}-btn-primary" id="${uid}-btn-confirm-save">确认加密保存</button>
        </div>
      </div>

      <!-- 快照二维码展示抽屉对话框 -->
      <div class="${uid}-qr-dialog" id="${uid}-qr-dialog">
        <div class="${uid}-dialog-header">
          <div class="${uid}-dialog-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c56473" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
            <span>快照二维码</span>
          </div>
          <button class="${uid}-dialog-close" id="${uid}-btn-close-qr" title="关闭">✕</button>
        </div>
        <div class="${uid}-qr-box">
          <div id="${uid}-qr-rec-info" style="font-size: 12px; color: #403f3a; text-align: center; line-height: 1.5; word-break: break-all; width: 100%;">
            <strong id="${uid}-qr-rec-name" style="font-size: 14px; color: #24231f;">快照名称</strong>
            <div id="${uid}-qr-rec-meta" style="font-size: 11px; color: #787670; margin-top: 2px;"></div>
          </div>
          <div class="${uid}-qr-canvas-wrap" id="${uid}-qr-canvas-wrap">
            <canvas id="${uid}-qr-canvas"></canvas>
          </div>
          <div class="${uid}-qr-overflow-box" id="${uid}-qr-overflow-box" style="display: none;">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#a87a3d" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <div style="font-weight: 700; color: #b45309; font-size: 13px;">快照数据过大，单张二维码无法容纳</div>
            <div id="${uid}-qr-overflow-desc" style="font-size: 11px; color: #78350f; text-align: center; line-height: 1.4;">
              当前快照数据超出二维码标准容量上限（约 2KB）。
            </div>
            <button class="${uid}-btn ${uid}-btn-primary" id="${uid}-btn-start-chunk-qr" style="width: 100%; margin-top: 4px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>分片轮播生成 (500ms/帧)</span>
            </button>
            <div style="font-size: 11px; color: #92400e; background: #fef3c7; padding: 6px 10px; border-radius: 6px; border: 1px dashed #fcd34d; width: 100%;">
              💡 或使用下方「复制数据」/「导出文件」直接流转
            </div>
          </div>
          <div class="${uid}-qr-chunk-player" id="${uid}-qr-chunk-player" style="display: none;">
            <div class="${uid}-qr-chunk-header">
              <span class="${uid}-qr-chunk-badge" id="${uid}-qr-chunk-badge">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#c56473;"></span>
                <span id="${uid}-qr-chunk-idx-text">分片 1 / 1</span>
              </span>
              <span style="font-size: 11px; color: #787670;">500ms / 帧 · 循环播放</span>
            </div>
            <div class="${uid}-qr-chunk-bar-wrap">
              <div class="${uid}-qr-chunk-bar-fill" id="${uid}-qr-chunk-bar-fill" style="width: 0%;"></div>
            </div>
            <div class="${uid}-qr-chunk-controls">
              <button class="${uid}-btn ${uid}-btn-secondary ${uid}-btn-sm" id="${uid}-btn-chunk-prev" title="上一张分片">◀</button>
              <button class="${uid}-btn ${uid}-btn-primary ${uid}-btn-sm" id="${uid}-btn-chunk-play-toggle" title="暂停/继续播放">
                <span id="${uid}-chunk-play-icon">⏸ 暂停</span>
              </button>
              <button class="${uid}-btn ${uid}-btn-secondary ${uid}-btn-sm" id="${uid}-btn-chunk-next" title="下一张分片">▶</button>
              <button class="${uid}-btn ${uid}-btn-secondary ${uid}-btn-sm" id="${uid}-btn-chunk-exit" style="margin-left: auto; color: #ef4444;" title="退出分片轮播模式">✕ 退出分片</button>
            </div>
          </div>
          <div id="${uid}-qr-tip" style="font-size: 11px; color: #787670; text-align: center;">
            使用另一台设备或快照助手的「扫码」功能即可一键导入与恢复
          </div>
        </div>
        <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-download-qr" title="下载二维码 PNG 图片">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>下载图片</span>
            </button>
            <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-copy-qr-data" title="复制完整快照 JSON 数据">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>复制数据</span>
            </button>
          </div>
          <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-close-qr-bottom" style="width: 100%;">返回管理列表</button>
        </div>
      </div>

      <!-- 扫码与综合导入抽屉对话框 -->
      <div class="${uid}-scan-dialog" id="${uid}-scan-dialog">
        <div class="${uid}-dialog-header">
          <div class="${uid}-dialog-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c56473" stroke-width="2">
              <path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M9 9h6v6H9z"></path>
            </svg>
            <span id="${uid}-scan-dialog-title-text">扫码与快照导入</span>
          </div>
          <button class="${uid}-dialog-close" id="${uid}-btn-close-scan" title="关闭">✕</button>
        </div>

        <!-- 视图 1：扫码/识别/选择主视图 -->
        <div id="${uid}-scan-view-main" style="display: flex; flex-direction: column; gap: 12px; height: 100%;">
          <!-- 摄像头视口 -->
          <div class="${uid}-camera-viewport" id="${uid}-camera-viewport">
            <video class="${uid}-camera-video" id="${uid}-camera-video" playsinline muted autoplay></video>
            <!-- 分片接收 HUD 浮层 -->
            <div class="${uid}-scan-chunk-hud" id="${uid}-scan-chunk-hud" style="display: none;">
              <div class="${uid}-scan-chunk-title">
                <span style="display:inline-flex; align-items:center; gap:4px;">
                  <span style="width:7px; height:7px; border-radius:50%; background:#10b981; display:inline-block;"></span>
                  <span>分片实时接收中</span>
                </span>
                <strong id="${uid}-scan-chunk-progress-text" style="color: #38bdf8;">0 / 0 (0%)</strong>
              </div>
              <div class="${uid}-qr-chunk-bar-wrap" style="background: rgba(255,255,255,0.2);">
                <div class="${uid}-qr-chunk-bar-fill" id="${uid}-scan-chunk-bar-fill" style="width: 0%; background: #10b981;"></div>
              </div>
              <div class="${uid}-scan-chunk-chips" id="${uid}-scan-chunk-chips"></div>
              <div style="font-size: 10px; color: #cbd5e1; text-align: center;">请对准屏幕轮播二维码（支持乱序扫描，全部分片集齐自动完成）</div>
            </div>
            <div class="${uid}-scan-frame" id="${uid}-scan-frame" style="display: none;">
              <span class="${uid}-scan-corner ${uid}-scan-corner-tl"></span>
              <span class="${uid}-scan-corner ${uid}-scan-corner-tr"></span>
              <span class="${uid}-scan-corner ${uid}-scan-corner-bl"></span>
              <span class="${uid}-scan-corner ${uid}-scan-corner-br"></span>
              <div class="${uid}-scan-laser"></div>
            </div>
            <div class="${uid}-camera-placeholder" id="${uid}-camera-placeholder">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
              <div id="${uid}-camera-status-text">未开启摄像头实时扫码</div>
              <button class="${uid}-btn ${uid}-btn-primary ${uid}-btn-sm" id="${uid}-btn-start-camera" style="margin-top: 4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
                <span>开启摄像头扫码</span>
              </button>
            </div>
          </div>

          <div style="font-size: 11px; color: #787670; text-align: center;">或通过以下方式快速导入/恢复快照：</div>

          <!-- 备选方式：图片识别二维码 与 JSON 文件导入 -->
          <div class="${uid}-import-options">
            <div class="${uid}-dropzone-btn" id="${uid}-btn-choose-img" title="上传带有二维码的截图或图片进行解析">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c56473" stroke-width="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <div class="${uid}-dropzone-label">图片识别二维码</div>
              <div class="${uid}-dropzone-hint">选择或拖入二维码截图</div>
            </div>

            <div class="${uid}-dropzone-btn" id="${uid}-btn-choose-json" title="直接导入 .json 快照文件">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5e9f7e" stroke-width="1.8">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <div class="${uid}-dropzone-label">JSON 文件导入</div>
              <div class="${uid}-dropzone-hint">单条或批量备份文件</div>
            </div>
          </div>
        </div>

        <!-- 视图 2：解析成功结果展示与操作 -->
        <div id="${uid}-scan-view-result" style="display: none; flex-direction: column; gap: 12px; height: 100%;">
          <div class="${uid}-result-card">
            <div class="${uid}-result-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5e9f7e" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>快照凭据解析成功</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #24231f;" id="${uid}-res-name">-</div>
            <div style="font-size: 11px; color: #475569; display: flex; flex-wrap: wrap; gap: 6px;" id="${uid}-res-chips"></div>
            <div style="font-size: 11px; color: #787670;" id="${uid}-res-meta"></div>
          </div>

          <div id="${uid}-res-domain-warning" class="${uid}-result-domain-warn" style="display: none;"></div>

          <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px;">
            <button class="${uid}-btn ${uid}-btn-primary" id="${uid}-btn-scan-restore-now" style="width: 100%; padding: 11px 0; font-size: 13px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                <path d="M8 16H3v5"></path>
              </svg>
              <span>🚀 立即解密并恢复当前页面</span>
            </button>
            <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-scan-save-db" style="width: 100%; padding: 10px 0; font-size: 13px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              <span>📥 导入并保存到快照列表</span>
            </button>
            <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-scan-retry" style="width: 100%;">
              <span>🔄 重新扫码 / 选择其他</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 云同步设置抽屉对话框 -->
      <div class="${uid}-sync-dialog" id="${uid}-sync-dialog">
        <div class="${uid}-dialog-header">
          <div class="${uid}-dialog-title">
            ☁️
            <span>GitHub Gist 云同步设置</span>
          </div>
          <button class="${uid}-dialog-close" id="${uid}-btn-close-sync" title="关闭">✕</button>
        </div>

        <div class="${uid}-sync-body" id="${uid}-sync-body">
          <!-- 状态卡片 -->
          <div class="${uid}-sync-status-card" id="${uid}-sync-status-card">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-weight: 700; font-size: 13px; color: #24231f;" id="${uid}-sync-card-status-title">☁️ 未配置云同步</span>
              <span class="${uid}-chip" id="${uid}-sync-card-badge" style="background:#f1f5f9;color:#64748b;">未连接</span>
            </div>
            <div style="font-size: 11px; color: #787670; margin-top: 4px; line-height: 1.4;" id="${uid}-sync-card-desc">
              配置 GitHub Token 和 Gist ID 后即可实现跨浏览器/多设备快照自动增量同步与安全备份。
            </div>
            <div style="font-size: 11px; color: #a8a69f; margin-top: 4px;" id="${uid}-sync-card-meta">
              上次同步: 从未同步
            </div>
          </div>

          <!-- Token 输入 -->
          <div class="${uid}-input-group">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <label class="${uid}-input-label">GitHub Personal Access Token</label>
              <a href="https://github.com/settings/tokens/new?scopes=gist&description=WebSnapshotManager" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #c56473; text-decoration: none;">🔑 获取 Token (勾选 gist)</a>
            </div>
            <div style="position: relative; display: flex; align-items: center;">
              <input type="password" class="${uid}-input" id="${uid}-sync-input-token" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" style="padding-right: 36px;" />
              <button type="button" id="${uid}-btn-toggle-token-eye" style="position: absolute; right: 8px; border: none; background: none; color: #787670; cursor: pointer; font-size: 13px; padding: 2px;" title="显示/隐藏 Token">👁️</button>
            </div>
          </div>

          <!-- Gist ID 输入、搜索与自动创建 -->
          <div class="${uid}-input-group">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <label class="${uid}-input-label">Gist ID (留空可点击右侧自动创建)</label>
              <button type="button" id="${uid}-btn-search-gists" style="font-size: 11px; color: #c56473; background: none; border: none; cursor: pointer; padding: 0; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;" title="从 GitHub 获取并搜索选择已有 Gist">
                <span>📋 搜索/选择已有 Gist</span>
              </button>
            </div>
            <div style="display: flex; gap: 6px;">
              <input type="text" class="${uid}-input" id="${uid}-sync-input-gist-id" placeholder="例如：a1b2c3d4e5f6..." style="flex: 1;" />
              <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-auto-create-gist" style="white-space: nowrap;" title="在 GitHub 上自动创建一个私有 Gist 并填入此处">
                🚀 自动创建 Gist
              </button>
            </div>
          </div>

          <!-- 操作与测试按钮组 -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-test-token" style="width: 100%;">
              🔍 测试连接与权限
            </button>
            <button class="${uid}-btn ${uid}-btn-primary" id="${uid}-btn-save-sync-config" style="width: 100%;">
              💾 保存配置
            </button>
          </div>

          <!-- 自动同步选项 -->
          <div class="${uid}-sync-toggle-row">
            <div>
              <div style="font-size: 12.5px; font-weight: 600; color: #24231f;">快照变更时自动同步</div>
              <div style="font-size: 11px; color: #787670;">本地保存、修改、删除快照后 2 秒防抖自动同步</div>
            </div>
            <label class="${uid}-switch">
              <input type="checkbox" id="${uid}-sync-switch-auto" />
              <span class="${uid}-slider"></span>
            </label>
          </div>

          <!-- 主同步按钮 -->
          <button class="${uid}-btn ${uid}-btn-primary" id="${uid}-btn-sync-now-drawer" style="width: 100%; padding: 10px 0; font-size: 13px;">
            <svg class="${uid}-icon-sync" id="${uid}-sync-drawer-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8M22 12.5a10 10 0 0 1-18.8 4.2L2.5 16"></path>
            </svg>
            <span>🔄 立即双向增量同步</span>
          </button>
        </div>
      </div>

      <!-- 主题风格设置抽屉对话框 -->
      <div class="${uid}-theme-dialog" id="${uid}-theme-dialog">
        <div class="${uid}-dialog-header">
          <div class="${uid}-dialog-title">
            <span>🎨</span>
            <span>主题风格与个性化设置</span>
          </div>
          <button class="${uid}-dialog-close" id="${uid}-btn-close-theme" title="关闭">✕</button>
        </div>

        <div class="${uid}-theme-body" id="${uid}-theme-body">
          <!-- 当前生效主题卡片 -->
          <div class="${uid}-theme-current-card" id="${uid}-theme-current-card" style="flex-shrink: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; min-width: 0; width: 100%;">
              <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
                <strong id="${uid}-cur-theme-name" style="font-size: 13.5px; color: var(--lsm-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">Yohaku (余白)</strong>
                <span class="${uid}-chip" id="${uid}-cur-theme-badge" style="background:var(--lsm-accent-bg);color:var(--lsm-accent);border:1px solid var(--lsm-accent-border); flex-shrink: 0; white-space: nowrap;">官方预设</span>
              </div>
            </div>
            <div id="${uid}-cur-theme-desc" style="font-size: 11px; color: var(--lsm-text-secondary); margin-top: 4px; line-height: 1.4; word-break: break-word;">
              基于 Innei Yohaku 设计体系的米白纸张与梅红质感主题
            </div>
            <!-- 色板圆点条 -->
            <div class="${uid}-theme-swatches" id="${uid}-cur-theme-swatches" style="display: flex; gap: 6px; margin-top: 8px; align-items: center; flex-wrap: wrap;"></div>
          </div>

          <!-- 主题选择网格 -->
          <div class="${uid}-input-group" style="flex-shrink: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
              <label class="${uid}-input-label">可选主题预设与自定义主题</label>
              <span style="font-size: 11px; color: var(--lsm-text-muted);" id="${uid}-theme-count-text">共 5 套</span>
            </div>
            <div class="${uid}-theme-grid" id="${uid}-theme-grid"></div>
          </div>

          <!-- 折叠自定义编辑器 (展开时位于主题列表与底部操作按钮之间) -->
          <div class="${uid}-theme-editor-wrap" id="${uid}-theme-editor-wrap" style="display: none; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--lsm-border); border-radius: 10px; background: var(--lsm-bg-card); flex-shrink: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="font-weight: 600; font-size: 12.5px; color: var(--lsm-text-primary);" id="${uid}-theme-editor-title">✏️ 修改当前主题配色</div>
              <button type="button" id="${uid}-btn-cancel-theme-editor" style="background: none; border: none; font-size: 11px; color: var(--lsm-text-muted); cursor: pointer; padding: 2px 4px;">✕ 收起</button>
            </div>
            <div class="${uid}-input-group">
              <label class="${uid}-input-label" id="${uid}-edit-theme-name-label">主题名称</label>
              <input type="text" class="${uid}-input" id="${uid}-edit-theme-name" placeholder="例如: 薄荷清风" />
            </div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
              <div class="${uid}-input-group">
                <label class="${uid}-input-label">强调主色 (Accent)</label>
                <input type="color" class="${uid}-input" id="${uid}-edit-color-accent" style="height: 32px; padding: 2px; cursor: pointer;" value="#c56473" />
              </div>
              <div class="${uid}-input-group">
                <label class="${uid}-input-label">纸张底色 (Paper)</label>
                <input type="color" class="${uid}-input" id="${uid}-edit-color-paper" style="height: 32px; padding: 2px; cursor: pointer;" value="#faf9f5" />
              </div>
              <div class="${uid}-input-group">
                <label class="${uid}-input-label">顶栏底色 (Header)</label>
                <input type="color" class="${uid}-input" id="${uid}-edit-color-header" style="height: 32px; padding: 2px; cursor: pointer;" value="#f0efeb" />
              </div>
            </div>
            <button class="${uid}-btn ${uid}-btn-primary" id="${uid}-btn-save-custom-theme" style="margin-top: 4px;">
              💾 保存并立即应用
            </button>
          </div>

          <!-- 快捷操作按钮组 (沉底) -->
          <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; padding-top: 4px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-export-theme" title="导出当前主题为 JSON 文件或复制到剪贴板">
                📤 导出主题 (JSON)
              </button>
              <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-import-theme" title="从本地 JSON 文件或剪贴板导入自定义主题">
                📥 导入主题 (JSON)
              </button>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-edit-theme" title="修改/微调当前主题的配色方案与名称">
                ✏️ 修改当前配色
              </button>
              <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-create-theme" title="基于当前主题创建全新的自定义主题">
                ➕ 新建自定义主题
              </button>
            </div>

            <button class="${uid}-btn ${uid}-btn-secondary" id="${uid}-btn-reset-default-theme" style="width: 100%; color: var(--lsm-accent);" title="一键重置为 Yohaku (余白) 官方默认配置">
              🔄 恢复默认主题
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div class="${uid}-toast" id="${uid}-toast"></div>
  `);
  shadow.appendChild(wrapper);

  // -----------------------------------------------------------------------
  // DOM 元素引用与 UI 控制器
  // -----------------------------------------------------------------------
  const ball = shadow.getElementById(`${uid}-ball`);
  const win = shadow.getElementById(`${uid}-window`);
  const header = shadow.getElementById(`${uid}-header`);
  const menuMask = shadow.getElementById(`${uid}-menu-mask`);
  const badge = shadow.getElementById(`${uid}-badge`);
  const listEl = shadow.getElementById(`${uid}-list`);
  const saveDialog = shadow.getElementById(`${uid}-save-dialog`);
  const inputName = shadow.getElementById(`${uid}-input-name`);
  const previewBox = shadow.getElementById(`${uid}-preview-box`);
  const toastEl = shadow.getElementById(`${uid}-toast`);

  // 二维码展示抽屉相关元素
  const qrDialog = shadow.getElementById(`${uid}-qr-dialog`);
  const qrRecName = shadow.getElementById(`${uid}-qr-rec-name`);
  const qrRecMeta = shadow.getElementById(`${uid}-qr-rec-meta`);
  const qrCanvasWrap = shadow.getElementById(`${uid}-qr-canvas-wrap`);
  const qrCanvas = shadow.getElementById(`${uid}-qr-canvas`);
  const qrOverflowBox = shadow.getElementById(`${uid}-qr-overflow-box`);
  const qrOverflowDesc = shadow.getElementById(`${uid}-qr-overflow-desc`);
  const btnStartChunkQr = shadow.getElementById(`${uid}-btn-start-chunk-qr`);
  const qrChunkPlayer = shadow.getElementById(`${uid}-qr-chunk-player`);
  const qrChunkBadge = shadow.getElementById(`${uid}-qr-chunk-badge`);
  const qrChunkIdxText = shadow.getElementById(`${uid}-qr-chunk-idx-text`);
  const qrChunkBarFill = shadow.getElementById(`${uid}-qr-chunk-bar-fill`);
  const btnChunkPrev = shadow.getElementById(`${uid}-btn-chunk-prev`);
  const btnChunkPlayToggle = shadow.getElementById(`${uid}-btn-chunk-play-toggle`);
  const chunkPlayIcon = shadow.getElementById(`${uid}-chunk-play-icon`);
  const btnChunkNext = shadow.getElementById(`${uid}-btn-chunk-next`);
  const btnChunkExit = shadow.getElementById(`${uid}-btn-chunk-exit`);
  const qrTip = shadow.getElementById(`${uid}-qr-tip`);
  const btnDownloadQr = shadow.getElementById(`${uid}-btn-download-qr`);
  const btnCopyQrData = shadow.getElementById(`${uid}-btn-copy-qr-data`);
  const btnCloseQr = shadow.getElementById(`${uid}-btn-close-qr`);
  const btnCloseQrBottom = shadow.getElementById(`${uid}-btn-close-qr-bottom`);

  // 扫码与综合导入抽屉相关元素
  const scanDialog = shadow.getElementById(`${uid}-scan-dialog`);
  const scanViewMain = shadow.getElementById(`${uid}-scan-view-main`);
  const scanViewResult = shadow.getElementById(`${uid}-scan-view-result`);
  const cameraVideo = shadow.getElementById(`${uid}-camera-video`);
  const scanChunkHud = shadow.getElementById(`${uid}-scan-chunk-hud`);
  const scanChunkProgressText = shadow.getElementById(`${uid}-scan-chunk-progress-text`);
  const scanChunkBarFill = shadow.getElementById(`${uid}-scan-chunk-bar-fill`);
  const scanChunkChips = shadow.getElementById(`${uid}-scan-chunk-chips`);
  const scanFrame = shadow.getElementById(`${uid}-scan-frame`);
  const cameraPlaceholder = shadow.getElementById(`${uid}-camera-placeholder`);
  const cameraStatusText = shadow.getElementById(`${uid}-camera-status-text`);
  const btnStartCamera = shadow.getElementById(`${uid}-btn-start-camera`);
  const btnChooseImg = shadow.getElementById(`${uid}-btn-choose-img`);
  const btnChooseJson = shadow.getElementById(`${uid}-btn-choose-json`);
  const fileScanImage = shadow.getElementById(`${uid}-file-scan-image`);
  const fileScanJson = shadow.getElementById(`${uid}-file-scan-json`);
  const scanHiddenCanvas = shadow.getElementById(`${uid}-scan-hidden-canvas`);
  const btnCloseScan = shadow.getElementById(`${uid}-btn-close-scan`);
  const resName = shadow.getElementById(`${uid}-res-name`);
  const resChips = shadow.getElementById(`${uid}-res-chips`);
  const resMeta = shadow.getElementById(`${uid}-res-meta`);
  const resDomainWarning = shadow.getElementById(`${uid}-res-domain-warning`);
  const btnScanRestoreNow = shadow.getElementById(`${uid}-btn-scan-restore-now`);
  const btnScanSaveDb = shadow.getElementById(`${uid}-btn-scan-save-db`);
  const btnScanRetry = shadow.getElementById(`${uid}-btn-scan-retry`);

  // 云同步相关 DOM 元素引用
  const statusCloud = shadow.getElementById(`${uid}-status-cloud`);
  const dotCloud = shadow.getElementById(`${uid}-dot-cloud`);
  const textCloud = shadow.getElementById(`${uid}-status-cloud-text`);
  const btnSyncToolbar = shadow.getElementById(`${uid}-btn-sync-toolbar`);
  const syncToolbarIcon = shadow.getElementById(`${uid}-sync-toolbar-icon`);
  const syncDialog = shadow.getElementById(`${uid}-sync-dialog`);
  const btnCloseSync = shadow.getElementById(`${uid}-btn-close-sync`);
  const syncCardStatusTitle = shadow.getElementById(`${uid}-sync-card-status-title`);
  const syncCardBadge = shadow.getElementById(`${uid}-sync-card-badge`);
  const syncCardDesc = shadow.getElementById(`${uid}-sync-card-desc`);
  const syncCardMeta = shadow.getElementById(`${uid}-sync-card-meta`);
  const syncInputToken = shadow.getElementById(`${uid}-sync-input-token`);
  const btnToggleTokenEye = shadow.getElementById(`${uid}-btn-toggle-token-eye`);
  const syncInputGistId = shadow.getElementById(`${uid}-sync-input-gist-id`);
  const btnSearchGists = shadow.getElementById(`${uid}-btn-search-gists`);
  const btnAutoCreateGist = shadow.getElementById(`${uid}-btn-auto-create-gist`);
  const btnTestToken = shadow.getElementById(`${uid}-btn-test-token`);
  const btnSaveSyncConfig = shadow.getElementById(`${uid}-btn-save-sync-config`);
  const syncSwitchAuto = shadow.getElementById(`${uid}-sync-switch-auto`);
  const btnSyncNowDrawer = shadow.getElementById(`${uid}-btn-sync-now-drawer`);
  const syncDrawerIcon = shadow.getElementById(`${uid}-sync-drawer-icon`);

  const btnMenuCloud = shadow.getElementById(`${uid}-btn-menu-cloud`);
  const btnMenuSyncNow = shadow.getElementById(`${uid}-btn-menu-sync-now`);
  const btnMenuTheme = shadow.getElementById(`${uid}-btn-menu-theme`);

  // 主题抽屉相关 DOM 元素引用
  const btnQuickTheme = shadow.getElementById(`${uid}-btn-quick-theme`);
  const themeQuickMenu = shadow.getElementById(`${uid}-theme-quick-menu`);
  const themeQuickList = shadow.getElementById(`${uid}-theme-quick-list`);
  const themeQuickCount = shadow.getElementById(`${uid}-theme-quick-count`);
  const btnOpenThemeSettings = shadow.getElementById(`${uid}-btn-open-theme-settings`);
  const themeDialog = shadow.getElementById(`${uid}-theme-dialog`);
  const btnCloseTheme = shadow.getElementById(`${uid}-btn-close-theme`);
  const curThemeName = shadow.getElementById(`${uid}-cur-theme-name`);
  const curThemeBadge = shadow.getElementById(`${uid}-cur-theme-badge`);
  const curThemeDesc = shadow.getElementById(`${uid}-cur-theme-desc`);
  const curThemeSwatches = shadow.getElementById(`${uid}-cur-theme-swatches`);
  const themeGrid = shadow.getElementById(`${uid}-theme-grid`);
  const themeCountText = shadow.getElementById(`${uid}-theme-count-text`);
  const btnExportTheme = shadow.getElementById(`${uid}-btn-export-theme`);
  const btnImportTheme = shadow.getElementById(`${uid}-btn-import-theme`);
  const btnEditTheme = shadow.getElementById(`${uid}-btn-edit-theme`);
  const btnCreateTheme = shadow.getElementById(`${uid}-btn-create-theme`);
  const btnResetDefaultTheme = shadow.getElementById(`${uid}-btn-reset-default-theme`);
  const themeEditorWrap = shadow.getElementById(`${uid}-theme-editor-wrap`);
  const themeEditorTitle = shadow.getElementById(`${uid}-theme-editor-title`);
  const btnCancelThemeEditor = shadow.getElementById(`${uid}-btn-cancel-theme-editor`);
  const editThemeName = shadow.getElementById(`${uid}-edit-theme-name`);
  const editColorAccent = shadow.getElementById(`${uid}-edit-color-accent`);
  const editColorPaper = shadow.getElementById(`${uid}-edit-color-paper`);
  const editColorHeader = shadow.getElementById(`${uid}-edit-color-header`);
  const btnSaveCustomTheme = shadow.getElementById(`${uid}-btn-save-custom-theme`);
  const fileThemeJson = shadow.getElementById(`${uid}-file-theme-json`);
  const btnMore = shadow.getElementById(`${uid}-btn-more`);
  const dropdownMenu = shadow.getElementById(`${uid}-dropdown-menu`);

  function closeMenu() {
    if (dropdownMenu) dropdownMenu.classList.add("hidden");
  }

  function closeAllDrawers() {
    if (saveDialog) saveDialog.classList.remove("open");
    if (qrDialog) qrDialog.classList.remove("open");
    if (scanDialog) scanDialog.classList.remove("open");
    if (syncDialog) syncDialog.classList.remove("open");
    if (themeDialog) themeDialog.classList.remove("open");
    if (typeof closeThemeEditor === "function") closeThemeEditor();
  }

  let tempCapturedData = null;
  let toastTimer = null;

  function showToast(msg, type = "info") {
    toastEl.textContent = msg;
    toastEl.className = `${uid}-toast ${type} show`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 3000);
  }

  // -----------------------------------------------------------------------
  // 位置持久化
  // -----------------------------------------------------------------------
  function getUIPositions() {
    return GM_getValue("lsm_ui_positions", {});
  }

  function saveUIPos() {
    try {
      const allPos = getUIPositions();
      const hostKey = location.hostname;
      const cur = allPos[hostKey] || {};

      const br = ball.getBoundingClientRect();
      if (br.width > 0 && br.height > 0) {
        cur.ball = { x: Math.round(br.left), y: Math.round(br.top) };
      }

      const wr = win.getBoundingClientRect();
      if (wr.width > 0 && wr.height > 0) {
        cur.win = { x: Math.round(wr.left), y: Math.round(wr.top) };
      }

      allPos[hostKey] = cur;
      GM_setValue("lsm_ui_positions", allPos);
    } catch {}
  }

  function restoreUIPos() {
    try {
      const allPos = getUIPositions();
      const cur = allPos[location.hostname];
      if (!cur) return;

      if (cur.ball && typeof cur.ball.x === "number") {
        const x = Math.max(10, Math.min(window.innerWidth - 60, cur.ball.x));
        const y = Math.max(10, Math.min(window.innerHeight - 60, cur.ball.y));
        ball.style.left = x + "px";
        ball.style.top = y + "px";
        ball.style.right = "auto";
        ball.style.bottom = "auto";
      }

      if (cur.win && typeof cur.win.x === "number") {
        const x = Math.max(10, Math.min(window.innerWidth - 490, cur.win.x));
        const y = Math.max(10, Math.min(window.innerHeight - 530, cur.win.y));
        win.style.left = x + "px";
        win.style.top = y + "px";
        win.style.right = "auto";
        win.style.bottom = "auto";
      }
    } catch {}
  }

  // -----------------------------------------------------------------------
  // 拖拽逻辑（兼容鼠标与移动端触摸）
  // -----------------------------------------------------------------------
  function makeDraggable(el, handle, onClick) {
    let dragging = false,
      moved = false,
      sx,
      sy,
      sLeft,
      sTop;

    const onStart = (clientX, clientY, target) => {
      const tag = target.tagName;
      if (["BUTTON", "SELECT", "TEXTAREA", "INPUT"].includes(tag)) return false;
      if (target.closest && target.closest(`.${uid}-ball-close`)) return false;

      dragging = true;
      moved = false;
      const rect = el.getBoundingClientRect();
      sx = clientX;
      sy = clientY;
      sLeft = rect.left;
      sTop = rect.top;
      handle.classList.add("dragging");
      return true;
    };

    const onMove = (clientX, clientY) => {
      if (!dragging) return false;
      const dx = clientX - sx,
        dy = clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (!moved) return false;

      let nl = Math.max(0, Math.min(sLeft + dx, window.innerWidth - el.offsetWidth));
      let nt = Math.max(0, Math.min(sTop + dy, window.innerHeight - el.offsetHeight));
      el.style.left = nl + "px";
      el.style.top = nt + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      return true;
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      if (moved) {
        if (el === ball) {
          // 悬浮球松手后智能平滑贴边吸附
          const curLeft = el.offsetLeft;
          const ballWidth = el.offsetWidth || 50;
          const winWidth = window.innerWidth;
          const margin = 12;
          const targetLeft = curLeft + ballWidth / 2 < winWidth / 2 ? margin : winWidth - ballWidth - margin;
          el.style.left = targetLeft + "px";
          const curTop = Math.max(margin, Math.min(el.offsetTop, window.innerHeight - (el.offsetHeight || 50) - margin));
          el.style.top = curTop + "px";
          setTimeout(saveUIPos, 350);
        } else {
          saveUIPos();
        }
      }
      if (!moved && onClick) onClick();
    };

    // 鼠标事件
    handle.addEventListener("mousedown", (e) => {
      if (onStart(e.clientX, e.clientY, e.target)) {
        e.preventDefault();
      }
    });

    document.addEventListener("mousemove", (e) => {
      onMove(e.clientX, e.clientY);
    });

    document.addEventListener("mouseup", () => {
      onEnd();
    });

    // 触摸事件 (移动端)
    handle.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1) {
          const t = e.touches[0];
          if (onStart(t.clientX, t.clientY, e.target)) {
            // 记录触摸启动，避免同时触发默认手势
          }
        }
      },
      { passive: true }
    );

    document.addEventListener(
      "touchmove",
      (e) => {
        if (dragging && e.touches.length === 1) {
          const t = e.touches[0];
          if (onMove(t.clientX, t.clientY)) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
          }
        }
      },
      { passive: false }
    );

    document.addEventListener("touchend", () => {
      onEnd();
    });
    document.addEventListener("touchcancel", () => {
      onEnd();
    });
  }

  // -----------------------------------------------------------------------
  // 当前生效快照状态管理
  // -----------------------------------------------------------------------
  function getActiveRecordId() {
    return GM_getValue("lsm_active_" + location.hostname, "");
  }

  function setActiveRecordId(id) {
    GM_setValue("lsm_active_" + location.hostname, id || "");
  }

  // -----------------------------------------------------------------------
  // UI 窗口交互与记录列表渲染
  // -----------------------------------------------------------------------
  function refreshList(keyword) {
    const allRecords = DB.getRecords();
    const activeId = getActiveRecordId();

    if (allRecords.length > 0) {
      badge.textContent = allRecords.length > 99 ? "99+" : allRecords.length;
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }

    const filterText = String(keyword !== undefined ? keyword : (shadow.getElementById(`${uid}-search-input`) ? shadow.getElementById(`${uid}-search-input`).value : "")).trim().toLowerCase();
    
    let records = allRecords;
    if (filterText) {
      records = allRecords.filter((r) => {
        const nameMatch = (r.name || "").toLowerCase().includes(filterText);
        const timeMatch = formatTime(r.createdAt || r.createTime || r.updatedAt).includes(filterText);
        const urlMatch = (r.url || "").toLowerCase().includes(filterText);
        return nameMatch || timeMatch || urlMatch;
      });
    }

    if (allRecords.length === 0) {
      listEl.innerHTML = `
        <div class="${uid}-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
          </svg>
          <div>当前网站暂无已保存的快照信息</div>
          <div style="font-size: 11px;">点击上方“一键保存”即可快速备份</div>
        </div>
      `;
      return;
    }

    if (records.length === 0 && filterText) {
      listEl.innerHTML = `
        <div class="${uid}-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <div>未找到匹配的快照记录</div>
          <div style="font-size: 11px;">可尝试更换关键词或点击清空搜索</div>
        </div>
      `;
      return;
    }

    let html = "";
    records.forEach((r) => {
      const cookieCount = r.summary ? r.summary.cookieCount : "?";
      const localCount = r.summary ? r.summary.localCount : "?";
      const sessionCount = r.summary ? r.summary.sessionCount : "?";
      const isActive = r.id === activeId;

      html += `
        <div class="${uid}-card ${isActive ? `${uid}-card-active` : ""}" data-id="${r.id}">
          <div class="${uid}-card-header">
            <span class="${uid}-card-name" title="${escapeHtml(r.name)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isActive ? "#16a34a" : "#2563eb"}" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              ${escapeHtml(r.name)}
              ${isActive ? `<span class="${uid}-badge-active">✓ 当前生效</span>` : ""}
            </span>
            <span class="${uid}-card-time">${formatTime(r.createdAt || r.createTime || r.updatedAt)}</span>
          </div>
          <div class="${uid}-card-chips">
            <span class="${uid}-chip ${uid}-chip-cookie">🍪 Cookie: ${cookieCount}</span>
            <span class="${uid}-chip ${uid}-chip-local">💾 Local: ${localCount}</span>
            <span class="${uid}-chip ${uid}-chip-session">📦 Session: ${sessionCount}</span>
            <span class="${uid}-chip ${uid}-chip-encrypted">🔒 ${r.cipherData && r.cipherData.encrypted ? "AES-GCM" : "明文"}</span>
          </div>
          ${
            r.url
              ? `<div class="${uid}-card-origin">
                  <span style="font-weight: 500;">来源:</span>
                  <a class="${uid}-card-url" href="${escapeHtml(r.url)}" title="保存来源页面：${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 2px;">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>${escapeHtml(r.url)}
                  </a>
                </div>`
              : ""
          }
          <div class="${uid}-card-actions">
            <button class="${uid}-btn ${uid}-btn-primary ${uid}-btn-sm btn-restore" data-id="${r.id}" data-url="${escapeHtml(r.url || "")}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                <path d="M8 16H3v5"></path>
              </svg>
              一键恢复
            </button>
            <button class="${uid}-btn ${uid}-btn-secondary ${uid}-btn-sm btn-qrcode" data-id="${r.id}" title="生成快照二维码以供扫码或导出">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              二维码
            </button>
            <button class="${uid}-btn ${uid}-btn-secondary ${uid}-btn-sm btn-copy-single" data-id="${r.id}" title="一键复制加密快照至剪贴板">
              复制
            </button>
            <button class="${uid}-btn ${uid}-btn-secondary ${uid}-btn-sm btn-export-single" data-id="${r.id}" title="导出此单条记录为独立 JSON 文件">
              导出
            </button>
            <button class="${uid}-btn ${uid}-btn-secondary ${uid}-btn-sm btn-rename" data-id="${r.id}" data-name="${escapeHtml(r.name)}">
              重命名
            </button>
            <button class="${uid}-btn ${uid}-btn-danger ${uid}-btn-sm btn-delete" data-id="${r.id}" data-name="${escapeHtml(r.name)}">
              删除
            </button>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;

    listEl.querySelectorAll(".btn-restore").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const originUrl = btn.getAttribute("data-url");
        try {
          showToast("正在解密并恢复快照...", "info");
          const sessionData = await DB.getDecryptedSession(id);
          const res = await SessionManager.restoreSession(sessionData);
          CryptoEngine.wipeMemory(sessionData);
          setActiveRecordId(id);
          refreshList();
          showToast(`恢复成功: Cookie ${res.cookieSuccessCount}个, Storage ${res.localCount + res.sessionCount}项`, "success");
          
          setTimeout(() => {
            const hasSpecificUrl = originUrl && originUrl.startsWith("http") && originUrl !== location.href;
            const targetJumpUrl = hasSpecificUrl ? originUrl : location.href;

            if (isAutoReloadEnabled()) {
              if (hasSpecificUrl) {
                location.href = targetJumpUrl;
              } else {
                location.reload();
              }
              return;
            }

            const confirmMsg = hasSpecificUrl
              ? `快照已恢复！\n检测到该记录保存自页面：\n${originUrl}\n\n是否立即跳转/刷新至该页面以应用快照？`
              : "快照已恢复！是否立即刷新网页以应用快照？";

            if (confirm(confirmMsg)) {
              if (hasSpecificUrl) {
                location.href = originUrl;
              } else {
                location.reload();
              }
            }
          }, 300);
        } catch (e) {
          showToast(`恢复失败: ${e.message}`, "error");
        }
      });
    });

    listEl.querySelectorAll(".btn-qrcode").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const records = DB.getRecords();
        const target = records.find((r) => r.id === id);
        if (!target) {
          showToast("未找到对应快照记录", "error");
          return;
        }
        openQrCodeDialog(target);
      });
    });

    listEl.querySelectorAll(".btn-copy-single").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const records = DB.getRecords();
        const target = records.find((r) => r.id === id);
        if (!target) {
          showToast("未找到对应快照记录", "error");
          return;
        }
        const exportData = {
          type: "LSM_SINGLE_EXPORT",
          version: "1.2.0",
          domain: target.domain || location.hostname,
          exportTime: Date.now(),
          record: target
        };
        try {
          GM_setClipboard(JSON.stringify(exportData, null, 2), "text");
          showToast(`快照「${target.name}」已复制至剪贴板！`, "success");
        } catch (err) {
          showToast(`复制失败: ${err.message}`, "error");
        }
      });
    });

    listEl.querySelectorAll(".btn-export-single").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const records = DB.getRecords();
        const target = records.find((r) => r.id === id);
        if (!target) {
          showToast("未找到对应记录", "error");
          return;
        }
        const exportData = {
          type: "LSM_SINGLE_EXPORT",
          version: "1.2.0",
          domain: target.domain || location.hostname,
          exportTime: Date.now(),
          record: target
        };
        const safeName = (target.name || "session").replace(/[\\/:*?"<>|]/g, "_");
        downloadJsonFile(`${location.hostname}_${safeName}.json`, exportData);
        showToast("单条记录已导出为 JSON", "success");
      });
    });

    listEl.querySelectorAll(".btn-rename").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const oldName = btn.getAttribute("data-name");
        const newName = prompt("请输入新的记录名称：", oldName);
        if (newName && newName.trim() && newName.trim() !== oldName) {
          DB.updateRecordName(id, newName.trim());
          refreshList();
          showToast("已重命名", "success");
        }
      });
    });

    listEl.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name");
        if (confirm(`确定要删除记录 [${name}] 吗？`)) {
          DB.deleteRecord(id);
          if (getActiveRecordId() === id) {
            setActiveRecordId("");
          }
          refreshList();
          showToast("已删除记录", "info");
        }
      });
    });
  }

  async function openSaveDialog() {
    closeAllDrawers();
    if (win) win.scrollTop = 0;
    if (saveDialog) saveDialog.scrollTop = 0;
    inputName.value = getDefaultName();
    previewBox.innerHTML = `<span style="color: #787670; font-size: 12px;">正在扫描当前快照...</span>`;
    saveDialog.classList.add("open");

    // 自动聚焦并全选输入框 (防止浏览器因授权弹窗切焦点产生意外滚动)
    setTimeout(() => {
      if (saveDialog && saveDialog.classList.contains("open") && inputName) {
        inputName.focus({ preventScroll: true });
        inputName.select();
      }
    }, 50);

    try {
      const data = await SessionManager.captureCurrentSession();
      tempCapturedData = data;
      const sizeKb = data.summary.approxBytes ? (data.summary.approxBytes / 1024).toFixed(1) : "0";
      const isTooLarge = data.summary.approxBytes && data.summary.approxBytes > 1.5 * 1024 * 1024;

      previewBox.innerHTML = `
        <div class="${uid}-grid-preview">
          <div class="${uid}-stat-box" style="border-color: rgba(168,122,61,0.2); background: rgba(168,122,61,0.06);">
            <div class="${uid}-stat-label" style="color: #b45309;">🍪 Cookie</div>
            <div class="${uid}-stat-num" style="color: #92400e;">${data.summary.cookieCount}</div>
          </div>
          <div class="${uid}-stat-box" style="border-color: rgba(94,159,126,0.2); background: rgba(94,159,126,0.06);">
            <div class="${uid}-stat-label" style="color: #15803d;">💾 Local</div>
            <div class="${uid}-stat-num" style="color: #166534;">${data.summary.localCount}</div>
          </div>
          <div class="${uid}-stat-box" style="border-color: rgba(61,104,150,0.2); background: rgba(61,104,150,0.06);">
            <div class="${uid}-stat-label" style="color: #7e22ce;">📦 Session</div>
            <div class="${uid}-stat-num" style="color: #6b21a8;">${data.summary.sessionCount}</div>
          </div>
        </div>
        <div style="margin-top: 6px; font-size: 11px; color: ${isTooLarge ? "#b45309" : "#64748b"}; display: flex; align-items: center; justify-content: space-between;">
          <span>预估体积: <strong>${sizeKb} KB</strong></span>
          ${isTooLarge ? '<span style="color: #e11d48; font-weight: 600;">⚠️ 快照体积偏大 (>1.5MB)</span>' : '<span style="color: #10b981;">✓ 状态良好</span>'}
        </div>
      `;

      // 授权弹窗关闭后重新确保顶栏与抽屉位置平正
      if (win) win.scrollTop = 0;
      if (saveDialog) saveDialog.scrollTop = 0;
    } catch (e) {
      previewBox.innerHTML = `<span style="color: #dc2626; font-size: 12px;">扫描异常: ${e.message}</span>`;
      if (win) win.scrollTop = 0;
    }
  }

  function closeSaveDialog() {
    saveDialog.classList.remove("open");
    if (tempCapturedData) {
      CryptoEngine.wipeMemory(tempCapturedData);
      tempCapturedData = null;
    }
  }

  // -----------------------------------------------------------------------
  // 快照二维码展示抽屉逻辑 & 分片轮播播放器
  // -----------------------------------------------------------------------
  let currentQrRecord = null;
  let currentQrJson = "";
  let activeChunks = [];
  let currentChunkIndex = 0;
  let chunkCarouselTimer = null;
  let isChunkPlaying = true;

  /**
   * 使用 qrcode-generator 渲染二维码至指定的 Canvas 元素
   */
  function renderQrCodeToCanvas(canvas, text, options = {}) {
    const {
      margin = 2,
      cellSize = 4,
      colorDark = "#0f172a",
      colorLight = "#ffffff",
      errorCorrectionLevel = "M"
    } = options;

    const qrFactory = typeof qrcode !== "undefined" ? qrcode : (typeof window !== "undefined" && window.qrcode ? window.qrcode : null);
    if (!qrFactory) {
      throw new Error("QR 编码库 (qrcode-generator) 未成功加载，请检查网络或脚本 @require 声明");
    }

    // version 0 表示自动计算最佳版本 (1-40)
    const qr = qrFactory(0, errorCorrectionLevel);
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const targetSize = options.size || 220;
    const computedCellSize = Math.max(2, Math.floor(targetSize / (count + margin * 2)));
    const totalSize = (count + margin * 2) * computedCellSize;

    canvas.width = totalSize;
    canvas.height = totalSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法初始化 Canvas 2D 绘图上下文");

    // 填充背景色
    ctx.fillStyle = colorLight;
    ctx.fillRect(0, 0, totalSize, totalSize);

    // 绘制暗色模块
    ctx.fillStyle = colorDark;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            (c + margin) * computedCellSize,
            (r + margin) * computedCellSize,
            computedCellSize,
            computedCellSize
          );
        }
      }
    }
  }

  function getJsQRDecoder() {
    if (typeof jsQR !== "undefined") return jsQR;
    if (typeof window !== "undefined" && window.jsQR) return window.jsQR;
    if (typeof globalThis !== "undefined" && globalThis.jsQR) return globalThis.jsQR;
    return null;
  }

  /**
   * 将较长数据切割成 LSM_CHUNK 分片包
   */
  function generateQrChunks(record, jsonStr) {
    const CHUNK_SIZE = 1200; // 每个分片约 1.2 KB，保证 QR Code Version <= 20，识别速度和容错率最高
    const totalChunks = Math.max(1, Math.ceil(jsonStr.length / CHUNK_SIZE));
    const chunkId = "chk_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const slice = jsonStr.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const payload = {
        type: "LSM_CHUNK",
        id: chunkId,
        idx: i,
        total: totalChunks,
        data: slice,
        name: record ? record.name : "快照"
      };
      chunks.push(JSON.stringify(payload));
    }
    return chunks;
  }

  function renderCurrentChunk() {
    if (!activeChunks || activeChunks.length === 0) return;
    const text = activeChunks[currentChunkIndex];
    try {
      renderQrCodeToCanvas(qrCanvas, text, {
        size: 220,
        margin: 2,
        errorCorrectionLevel: "M",
        colorDark: "#0f172a",
        colorLight: "#ffffff"
      });
    } catch (err) {
      console.warn("渲染分片二维码失败:", err);
    }
    if (qrChunkIdxText) {
      qrChunkIdxText.textContent = `分片 ${currentChunkIndex + 1} / ${activeChunks.length}`;
    }
    if (qrChunkBarFill) {
      const pct = Math.round(((currentChunkIndex + 1) / activeChunks.length) * 100);
      qrChunkBarFill.style.width = `${pct}%`;
    }
  }

  function startChunkTimer() {
    if (chunkCarouselTimer) clearInterval(chunkCarouselTimer);
    chunkCarouselTimer = setInterval(() => {
      if (!activeChunks || activeChunks.length <= 1) return;
      currentChunkIndex = (currentChunkIndex + 1) % activeChunks.length;
      renderCurrentChunk();
    }, 500);
  }

  function startChunkCarousel() {
    if (!currentQrRecord || !currentQrJson) return;
    activeChunks = generateQrChunks(currentQrRecord, currentQrJson);
    currentChunkIndex = 0;
    isChunkPlaying = true;

    if (qrOverflowBox) qrOverflowBox.style.display = "none";
    if (qrCanvasWrap) qrCanvasWrap.style.display = "flex";
    if (qrChunkPlayer) qrChunkPlayer.style.display = "flex";
    if (qrTip) {
      qrTip.style.display = "block";
      qrTip.textContent = `共生成 ${activeChunks.length} 张分片二维码，正在以 500ms/帧 循环轮播`;
    }
    if (chunkPlayIcon) chunkPlayIcon.textContent = "⏸ 暂停";

    renderCurrentChunk();
    startChunkTimer();
  }

  function stopChunkCarousel() {
    if (chunkCarouselTimer) {
      clearInterval(chunkCarouselTimer);
      chunkCarouselTimer = null;
    }
    activeChunks = [];
    currentChunkIndex = 0;
    isChunkPlaying = false;
    if (qrChunkPlayer) qrChunkPlayer.style.display = "none";
  }

  function toggleChunkPlay() {
    if (isChunkPlaying) {
      isChunkPlaying = false;
      if (chunkCarouselTimer) {
        clearInterval(chunkCarouselTimer);
        chunkCarouselTimer = null;
      }
      if (chunkPlayIcon) chunkPlayIcon.textContent = "▶ 继续";
    } else {
      isChunkPlaying = true;
      if (chunkPlayIcon) chunkPlayIcon.textContent = "⏸ 暂停";
      startChunkTimer();
    }
  }

  function prevChunk() {
    if (!activeChunks || activeChunks.length === 0) return;
    currentChunkIndex = (currentChunkIndex - 1 + activeChunks.length) % activeChunks.length;
    renderCurrentChunk();
  }

  function nextChunk() {
    if (!activeChunks || activeChunks.length === 0) return;
    currentChunkIndex = (currentChunkIndex + 1) % activeChunks.length;
    renderCurrentChunk();
  }

  function exitChunkMode() {
    stopChunkCarousel();
    if (qrCanvasWrap) qrCanvasWrap.style.display = "none";
    if (qrOverflowBox) qrOverflowBox.style.display = "flex";
    if (qrTip) qrTip.style.display = "none";
  }

  function openQrCodeDialog(record) {
    if (!record) return;
    stopChunkCarousel();
    currentQrRecord = record;
    qrRecName.textContent = record.name || "未命名快照";

    const timeVal = record.createdAt || record.createTime || record.updatedAt || Date.now();
    const dateStr = formatTime(timeVal);
    const cookieCount = record.summary ? record.summary.cookieCount : 0;
    const localCount = record.summary ? record.summary.localCount : 0;
    const sessionCount = record.summary ? record.summary.sessionCount : 0;
    const approxBytes = record.summary && record.summary.approxBytes ? record.summary.approxBytes : 0;
    const sizeKb = approxBytes ? (approxBytes / 1024).toFixed(1) : "-";

    qrRecMeta.innerHTML = `
      <span>创建时间: <strong>${dateStr}</strong></span> · 
      <span>域名: <strong>${escapeHtml(record.domain || location.hostname)}</strong></span><br>
      <span>凭据概览: Cookie <strong>${cookieCount}</strong> 项, Local <strong>${localCount}</strong> 项, Session <strong>${sessionCount}</strong> 项 (${sizeKb} KB)</span>
    `;

    const exportData = {
      type: "LSM_SINGLE_EXPORT",
      version: "1.2.0",
      domain: record.domain || location.hostname,
      exportTime: Date.now(),
      record: record
    };
    currentQrJson = JSON.stringify(exportData);
    const byteLength = new Blob([currentQrJson]).size;
    const actualKb = (byteLength / 1024).toFixed(1);

    // 标准 QR Code Level M 最大容量约 2,331 字节 (~2.2 KB)
    // 如果超过 2,200 字节，直接判定为超限，显示超限提示及分片轮播生成按钮
    const QR_MAX_SAFE_BYTES = 2200;

    if (byteLength > QR_MAX_SAFE_BYTES) {
      if (qrCanvasWrap) qrCanvasWrap.style.display = "none";
      if (qrOverflowBox) qrOverflowBox.style.display = "flex";
      if (qrOverflowDesc) {
        qrOverflowDesc.innerHTML = `当前快照数据体积为 <strong>${actualKb} KB</strong> (${byteLength} 字节)，已超出标准单张二维码容纳极限（约 2.2 KB）。`;
      }
      if (qrTip) qrTip.style.display = "none";
      if (btnDownloadQr) {
        btnDownloadQr.disabled = true;
        btnDownloadQr.style.opacity = "0.45";
        btnDownloadQr.style.cursor = "not-allowed";
        btnDownloadQr.title = "快照数据过大，无法生成单张二维码图片";
      }
    } else {
      let renderSuccess = false;
      try {
        renderQrCodeToCanvas(qrCanvas, currentQrJson, {
          size: 220,
          margin: 2,
          errorCorrectionLevel: "M",
          colorDark: "#0f172a",
          colorLight: "#ffffff"
        });
        renderSuccess = true;
      } catch (err) {
        console.warn("二维码生成失败:", err);
      }

      if (renderSuccess) {
        if (qrCanvasWrap) qrCanvasWrap.style.display = "flex";
        if (qrOverflowBox) qrOverflowBox.style.display = "none";
        if (qrTip) {
          qrTip.style.display = "block";
          qrTip.textContent = "使用另一台设备或快照助手的「扫码」功能即可一键导入与恢复";
        }
        if (btnDownloadQr) {
          btnDownloadQr.disabled = false;
          btnDownloadQr.style.opacity = "1";
          btnDownloadQr.style.cursor = "pointer";
          btnDownloadQr.title = "下载二维码 PNG 图片";
        }
      } else {
        if (qrCanvasWrap) qrCanvasWrap.style.display = "none";
        if (qrOverflowBox) qrOverflowBox.style.display = "flex";
        if (qrOverflowDesc) {
          qrOverflowDesc.innerHTML = `当前快照数据体积为 <strong>${actualKb} KB</strong>，超出二维码容量限制。`;
        }
        if (qrTip) qrTip.style.display = "none";
        if (btnDownloadQr) {
          btnDownloadQr.disabled = true;
          btnDownloadQr.style.opacity = "0.45";
          btnDownloadQr.style.cursor = "not-allowed";
          btnDownloadQr.title = "快照数据过大，无法生成二维码图片";
        }
      }
    }

    qrDialog.classList.add("open");
  }

  function closeQrCodeDialog() {
    stopChunkCarousel();
    qrDialog.classList.remove("open");
    currentQrRecord = null;
    currentQrJson = "";
    if (btnDownloadQr) {
      btnDownloadQr.disabled = false;
      btnDownloadQr.style.opacity = "1";
      btnDownloadQr.style.cursor = "pointer";
    }
  }

  // -----------------------------------------------------------------------
  // 扫码与综合导入抽屉逻辑 (摄像头 / 图片二维码 / JSON 文件 / 乱序分片接收)
  // -----------------------------------------------------------------------
  let cameraStream = null;
  let cameraAnimId = null;
  let currentScannedSnapshot = null;
  const chunkScanPool = new Map();

  function updateScanChunkHud(entry) {
    if (!scanChunkProgressText || !scanChunkBarFill || !scanChunkChips) return;
    const pct = Math.round((entry.receivedCount / entry.total) * 100);
    scanChunkProgressText.textContent = `${entry.receivedCount} / ${entry.total} (${pct}%)`;
    scanChunkBarFill.style.width = `${pct}%`;

    let dotsHtml = "";
    for (let i = 0; i < entry.total; i++) {
      const isReceived = entry.chunks[i] !== null;
      dotsHtml += `<span class="${uid}-scan-chunk-dot ${isReceived ? "received" : ""}" title="分片 ${i + 1}/${entry.total}">${i + 1}</span>`;
    }
    scanChunkChips.innerHTML = dotsHtml;
  }

  function handleIncomingChunk(chunkObj) {
    const { id, idx, total, data, name } = chunkObj;
    if (!id || typeof idx !== "number" || !total || typeof data !== "string") return;

    let entry = chunkScanPool.get(id);
    if (!entry) {
      entry = {
        id: id,
        total: total,
        name: name || "分片快照",
        chunks: new Array(total).fill(null),
        receivedCount: 0,
        createdAt: Date.now()
      };
      chunkScanPool.set(id, entry);
    }

    if (scanChunkHud) scanChunkHud.style.display = "flex";

    if (entry.chunks[idx] === null) {
      entry.chunks[idx] = data;
      entry.receivedCount++;
      updateScanChunkHud(entry);
    }

    if (entry.receivedCount === entry.total) {
      stopCameraScan();
      if (scanChunkHud) scanChunkHud.style.display = "none";
      const fullJsonStr = entry.chunks.join("");
      chunkScanPool.delete(id);
      showToast(`所有分片 (${total}/${total}) 已完整接收，正在解析快照...`, "success");
      handleQrDecodedString(fullJsonStr);
    }
  }

  function stopCameraScan() {
    if (cameraAnimId) {
      cancelAnimationFrame(cameraAnimId);
      cameraAnimId = null;
    }
    if (cameraStream) {
      try {
        cameraStream.getTracks().forEach((track) => track.stop());
      } catch (e) {}
      cameraStream = null;
    }
    if (cameraVideo) {
      cameraVideo.srcObject = null;
    }
    if (scanFrame) scanFrame.style.display = "none";
    if (cameraPlaceholder) cameraPlaceholder.style.display = "flex";
    if (btnStartCamera) btnStartCamera.style.display = "inline-flex";
    if (cameraStatusText) cameraStatusText.textContent = "未开启摄像头实时扫码";
  }

  async function startCameraScan() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast("当前环境或浏览器不支持访问摄像头", "error");
      return;
    }
    try {
      cameraStatusText.textContent = "正在请求摄像头权限...";
      btnStartCamera.style.display = "none";
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      cameraStream = stream;
      cameraVideo.srcObject = stream;
      cameraVideo.setAttribute("playsinline", "true");
      await cameraVideo.play();

      cameraPlaceholder.style.display = "none";
      scanFrame.style.display = "block";
      cameraStatusText.textContent = "正在实时扫码中，请对准二维码...";

      scanCameraLoop();
    } catch (err) {
      console.error("启动摄像头失败:", err);
      stopCameraScan();
      cameraStatusText.textContent = "无法访问摄像头: " + (err.message || "用户拒绝或设备不可用");
      showToast("无法访问摄像头: " + (err.message || "权限被拒绝"), "error");
    }
  }

  function scanCameraLoop() {
    if (!cameraStream) return;
    if (cameraVideo.readyState === cameraVideo.HAVE_ENOUGH_DATA) {
      const canvas = scanHiddenCanvas || document.createElement("canvas");
      canvas.width = cameraVideo.videoWidth;
      canvas.height = cameraVideo.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoder = getJsQRDecoder();
      if (decoder) {
        const code = decoder(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert"
        });
        if (code && code.data) {
          let chunkObj = null;
          try {
            const parsed = JSON.parse(code.data.trim());
            if (parsed && parsed.type === "LSM_CHUNK" && parsed.id && typeof parsed.idx === "number" && parsed.total && typeof parsed.data === "string") {
              chunkObj = parsed;
            }
          } catch (e) {}

          if (chunkObj) {
            handleIncomingChunk(chunkObj);
            // 分片模式下不停止相机，继续下一帧扫描直到全部集齐
          } else {
            // 普通完整二维码，直接停止扫描并解析
            stopCameraScan();
            handleQrDecodedString(code.data);
            return;
          }
        }
      }
    }
    cameraAnimId = requestAnimationFrame(scanCameraLoop);
  }

  function resetScanModal() {
    stopCameraScan();
    chunkScanPool.clear();
    if (scanChunkHud) scanChunkHud.style.display = "none";
    if (scanChunkProgressText) scanChunkProgressText.textContent = "0 / 0 (0%)";
    if (scanChunkBarFill) scanChunkBarFill.style.width = "0%";
    if (scanChunkChips) scanChunkChips.innerHTML = "";
    currentScannedSnapshot = null;
    scanViewMain.style.display = "flex";
    scanViewResult.style.display = "none";
    if (fileScanImage) fileScanImage.value = "";
    if (fileScanJson) fileScanJson.value = "";
  }

  function openScanImportModal() {
    resetScanModal();
    scanDialog.classList.add("open");
  }

  function closeScanDialog() {
    stopCameraScan();
    chunkScanPool.clear();
    if (scanChunkHud) scanChunkHud.style.display = "none";
    scanDialog.classList.remove("open");
    currentScannedSnapshot = null;
  }

  function handleQrDecodedString(rawStr) {
    if (!rawStr || typeof rawStr !== "string") {
      showToast("识别到的内容为空", "error");
      return;
    }
    let json;
    try {
      json = JSON.parse(rawStr.trim());
    } catch {
      showToast("二维码解析成功，但内容不是合法的 JSON 快照数据", "error");
      return;
    }

    if (json && json.type === "LSM_CHUNK" && json.id && typeof json.idx === "number" && json.total && typeof json.data === "string") {
      handleIncomingChunk(json);
      const entry = chunkScanPool.get(json.id);
      if (entry && entry.receivedCount < entry.total) {
        showToast(`已暂存分片 ${json.idx + 1}/${json.total}，请继续扫描或导入剩余分片`, "info");
      }
      return;
    }

    handleParsedSnapshot(json, "扫码导入快照");
  }

  function handleImageQrFile(file) {
    if (!file) return;
    showToast("正在识别图片中的二维码...", "info");
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = scanHiddenCanvas || document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoder = getJsQRDecoder();
        if (!decoder) {
          showToast("jsQR 解码库未成功加载，请检查网络或脚本 @require 依赖", "error");
          return;
        }
        const code = decoder(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "attemptBoth"
        });
        if (code && code.data) {
          handleQrDecodedString(code.data);
        } else {
          showToast("未能从该图片中识别到有效二维码，请确认图片清晰", "error");
        }
      };
      img.onerror = () => showToast("图片加载失败", "error");
      img.src = e.target.result;
    };
    reader.onerror = () => showToast("读取文件失败", "error");
    reader.readAsDataURL(file);
  }

  function handleParsedSnapshot(json, defaultName) {
    let targetRecord = null;
    let recordsToImport = [];
    let sourceDomain = json.domain || "";
    let name = defaultName || "导入快照";

    if (json.type === "LSM_SINGLE_EXPORT" && json.record) {
      targetRecord = json.record;
      recordsToImport = [json.record];
      sourceDomain = json.record.domain || sourceDomain;
      name = json.record.name || name;
    } else if (json.type === "LSM_BATCH_EXPORT" && Array.isArray(json.records) && json.records.length > 0) {
      targetRecord = json.records[0];
      recordsToImport = json.records;
      sourceDomain = json.domain || targetRecord.domain || sourceDomain;
      name = targetRecord.name ? `${targetRecord.name} (等共 ${json.records.length} 条)` : name;
    } else if (json.name && json.cipherData) {
      targetRecord = json;
      recordsToImport = [json];
      sourceDomain = json.domain || sourceDomain;
      name = json.name;
    } else if (Array.isArray(json) && json.length > 0 && json[0].cipherData) {
      targetRecord = json[0];
      recordsToImport = json;
      sourceDomain = targetRecord.domain || sourceDomain;
      name = targetRecord.name ? `${targetRecord.name} (共 ${json.length} 条)` : name;
    } else if (json.cookies || json.localStorage) {
      targetRecord = {
        id: "rec_" + Date.now(),
        name: name,
        domain: json.domain || location.hostname,
        url: json.url || location.href,
        createdAt: Date.now(),
        createTime: Date.now(),
        summary: json.summary || {
          cookieCount: Array.isArray(json.cookies) ? json.cookies.length : 0,
          localCount: json.localStorage ? Object.keys(json.localStorage).length : 0,
          sessionCount: json.sessionStorage ? Object.keys(json.sessionStorage).length : 0
        },
        cipherData: { encrypted: false, payload: JSON.stringify(json) }
      };
      recordsToImport = [targetRecord];
      sourceDomain = targetRecord.domain;
    } else {
      showToast("无法识别的快照数据格式", "error");
      return;
    }

    currentScannedSnapshot = {
      json: json,
      targetRecord: targetRecord,
      recordsToImport: recordsToImport,
      sourceDomain: sourceDomain,
      name: name
    };

    resName.textContent = name;
    const summary = targetRecord.summary || {};
    const cookieCount = typeof summary.cookieCount === "number" ? summary.cookieCount : "-";
    const localCount = typeof summary.localCount === "number" ? summary.localCount : "-";
    const sessionCount = typeof summary.sessionCount === "number" ? summary.sessionCount : "-";
    const isEnc = targetRecord.cipherData ? (targetRecord.cipherData.encrypted ? "AES-GCM" : "明文") : "未知";

    resChips.innerHTML = `
      <span class="${uid}-chip" style="background:#eff6ff;color:#2563eb;border-color:#bfdbfe;">🍪 Cookie: ${cookieCount}</span>
      <span class="${uid}-chip" style="background:#f0fdf4;color:#16a34a;border-color:#bbf7d0;">💾 Local: ${localCount}</span>
      <span class="${uid}-chip" style="background:#faf5ff;color:#9333ea;border-color:#e9d5ff;">📦 Session: ${sessionCount}</span>
      <span class="${uid}-chip" style="background:#faf9f5;color:#475569;border-color:#e2e8f0;">🔒 ${isEnc}</span>
    `;

    const createTimeVal = targetRecord.createdAt || targetRecord.createTime || (json && (json.exportTime || json.createdAt || json.createTime));
    const createTimeStr = createTimeVal ? formatTime(createTimeVal) : "未知时间";
    resMeta.textContent = `来源域名: ${sourceDomain || location.hostname} · 创建于 ${createTimeStr}`;

    if (sourceDomain && sourceDomain !== location.hostname) {
      resDomainWarning.style.display = "block";
      resDomainWarning.innerHTML = `⚠️ <strong>域名不匹配提醒</strong>：该快照保存自 <code>${escapeHtml(sourceDomain)}</code>，而当前所在网页为 <code>${escapeHtml(location.hostname)}</code>。直接恢复可能会因域名隔离导致部分 Cookie 无法生效。`;
    } else {
      resDomainWarning.style.display = "none";
    }

    scanViewMain.style.display = "none";
    scanViewResult.style.display = "flex";
    showToast("快照解析成功，请选择操作", "success");
  }

  // -----------------------------------------------------------------------
  // 云同步状态 UI 刷新与抽屉交互
  // -----------------------------------------------------------------------
  function updateCloudStatusUI(status, errorMsg) {
    const token = GistSyncEngine.getToken();
    const gistId = GistSyncEngine.getGistId();
    const lastTime = GistSyncEngine.getLastSyncTime();
    const lastTimeStr = lastTime ? formatTime(lastTime) : "从未同步";

    if (status === "syncing") {
      if (dotCloud) dotCloud.className = `${uid}-dot ${uid}-dot-cloud syncing`;
      if (textCloud) textCloud.textContent = "☁️ 云同步: 同步中...";
      if (syncToolbarIcon) syncToolbarIcon.classList.add("spinning");
      if (syncDrawerIcon) syncDrawerIcon.classList.add("spinning");
      if (syncCardStatusTitle) syncCardStatusTitle.textContent = "☁️ 正在与 GitHub Gist 同步...";
      if (syncCardBadge) {
        syncCardBadge.textContent = "同步中";
        syncCardBadge.style.cssText = "background:#dbeafe;color:#2563eb;";
      }
      if (syncCardDesc) syncCardDesc.textContent = "正在双向传输与合并全域快照数据，请稍候...";
      if (syncCardMeta) syncCardMeta.textContent = `上次同步: ${lastTimeStr}`;
      return;
    }

    if (syncToolbarIcon) syncToolbarIcon.classList.remove("spinning");
    if (syncDrawerIcon) syncDrawerIcon.classList.remove("spinning");

    if (status === "error") {
      if (dotCloud) dotCloud.className = `${uid}-dot ${uid}-dot-cloud err`;
      if (textCloud) textCloud.textContent = "☁️ 云同步: 异常";
      if (syncCardStatusTitle) syncCardStatusTitle.textContent = "☁️ 云同步异常";
      if (syncCardBadge) {
        syncCardBadge.textContent = "连接失败";
        syncCardBadge.style.cssText = "background:#fee2e2;color:#991b1b;";
      }
      if (syncCardDesc) syncCardDesc.textContent = `错误原因: ${errorMsg || "网络连接超时或 Token 无效"}`;
      if (syncCardMeta) syncCardMeta.textContent = `上次同步: ${lastTimeStr}`;
      return;
    }

    if (token && gistId) {
      if (dotCloud) dotCloud.className = `${uid}-dot ${uid}-dot-cloud ok`;
      if (textCloud) textCloud.textContent = "☁️ 云同步: 已连接";
      if (syncCardStatusTitle) syncCardStatusTitle.textContent = "☁️ GitHub Gist 云同步就绪";
      if (syncCardBadge) {
        syncCardBadge.textContent = "已连接";
        syncCardBadge.style.cssText = "background:#dcfce7;color:#166534;";
      }
      if (syncCardDesc) syncCardDesc.textContent = "已与 GitHub Gist 建立连接，支持双向智能增量合并与防抖自动同步。";
      if (syncCardMeta) syncCardMeta.textContent = `上次同步: ${lastTimeStr}`;
    } else if (token && !gistId) {
      if (dotCloud) dotCloud.className = `${uid}-dot ${uid}-dot-cloud warn`;
      if (textCloud) textCloud.textContent = "☁️ 云同步: 待绑定Gist";
      if (syncCardStatusTitle) syncCardStatusTitle.textContent = "☁️ Token 已就绪，请绑定 Gist";
      if (syncCardBadge) {
        syncCardBadge.textContent = "待绑定";
        syncCardBadge.style.cssText = "background:#fef3c7;color:#b45309;";
      }
      if (syncCardDesc) syncCardDesc.textContent = "已输入 Token，请点击下方「🚀 自动创建 Gist」或手动填入已有 Gist ID。";
      if (syncCardMeta) syncCardMeta.textContent = `上次同步: ${lastTimeStr}`;
    } else {
      if (dotCloud) dotCloud.className = `${uid}-dot ${uid}-dot-cloud`;
      if (textCloud) textCloud.textContent = "☁️ 云同步: 未配置";
      if (syncCardStatusTitle) syncCardStatusTitle.textContent = "☁️ 未配置云同步";
      if (syncCardBadge) {
        syncCardBadge.textContent = "未连接";
        syncCardBadge.style.cssText = "background:#f1f5f9;color:#64748b;";
      }
      if (syncCardDesc) syncCardDesc.textContent = "配置 GitHub Token 和 Gist ID 后即可实现跨浏览器/多设备快照自动增量同步与安全备份。";
      if (syncCardMeta) syncCardMeta.textContent = `上次同步: ${lastTimeStr}`;
    }
  }

  function openCloudSyncDialog() {
    if (!syncDialog) return;
    closeAllDrawers();
    if (win) win.scrollTop = 0;
    if (syncDialog) syncDialog.scrollTop = 0;
    if (syncInputToken) syncInputToken.value = GistSyncEngine.getToken();
    if (syncInputGistId) syncInputGistId.value = GistSyncEngine.getGistId();
    if (syncSwitchAuto) syncSwitchAuto.checked = GistSyncEngine.isAutoSyncEnabled();
    updateCloudStatusUI();
    syncDialog.classList.add("open");
  }

  function closeCloudSyncDialog() {
    if (syncDialog) {
      syncDialog.classList.remove("open");
    }
  }

  // 搜索并选择已有 Gist 模态框
  async function showGistPickerModal(token) {
    if (document.querySelector(".lsm-gist-picker-mask")) return;
    ensureHostAnimationStyle();

    const t = (token || (syncInputToken ? syncInputToken.value.trim() : "") || GistSyncEngine.getToken()).trim();
    if (!t) {
      showToast("请先在上方输入有效的 GitHub Token", "error");
      if (syncInputToken) syncInputToken.focus();
      return;
    }

    showToast("正在从 GitHub 获取 Gist 列表...", "info");

    let gists = [];
    try {
      gists = await GistSyncEngine.listUserGists(t);
    } catch (err) {
      showToast(`获取 Gist 列表失败: ${err.message}`, "error");
      return;
    }

    if (!gists.length) {
      showToast("当前 GitHub 账号下未找到任何 Gist，请点击「🚀 自动创建 Gist」", "info");
      return;
    }

    const mask = document.createElement("div");
    mask.className = "lsm-dlg-mask lsm-gist-picker-mask";
    mask.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(20,19,18,0.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
      "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:system-ui,-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;";
    bindScrollLock(mask, null);

    const box = document.createElement("div");
    box.style.cssText =
      "width:480px;max-width:calc(100vw - 32px);max-height:85vh;background:#faf9f5;border:1px solid #e3e1db;border-radius:16px;" +
      "padding:20px 22px;box-shadow:0 20px 45px -10px rgba(36,35,31,0.18),0 1px 3px rgba(0,0,0,0.04);box-sizing:border-box;" +
      "display:flex;flex-direction:column;gap:12px;animation:lsmFadeIn .2s cubic-bezier(0.16,1,0.3,1);";

    const headerRow = document.createElement("div");
    headerRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
    headerRow.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c56473" stroke-width="2">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>
        </svg>
        <span style="font-weight:600;font-size:15px;color:#24231f;">选择已有 Gist 进行绑定 (${gists.length})</span>
      </div>
      <button class="lsm-picker-close-btn" style="border:none;background:none;font-size:16px;color:#787670;cursor:pointer;padding:4px;transition:color .15s;" title="关闭">✕</button>
    `;

    const closeBtn = headerRow.querySelector(".lsm-picker-close-btn");
    closeBtn.addEventListener("mouseenter", () => closeBtn.style.color = "#24231f");
    closeBtn.addEventListener("mouseleave", () => closeBtn.style.color = "#787670");

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "🔍 实时搜索 Gist 描述、文件名或 ID...";
    searchInput.style.cssText =
      "width:100%;box-sizing:border-box;padding:8px 12px;font-size:12.5px;border:1px solid #e3e1db;border-radius:8px;outline:none;" +
      "background:#ffffff;background-image:linear-gradient(180deg,rgba(197,100,115,0.03) 0%,transparent 26%);color:#24231f;transition:border-color .2s,box-shadow .2s;";
    searchInput.addEventListener("focus", () => {
      searchInput.style.borderColor = "rgba(197,100,115,0.35)";
      searchInput.style.boxShadow = "0 0 0 3px rgba(197,100,115,0.1)";
    });
    searchInput.addEventListener("blur", () => {
      searchInput.style.borderColor = "#e3e1db";
      searchInput.style.boxShadow = "none";
    });

    const listContainer = document.createElement("div");
    listContainer.style.cssText =
      "flex:1;overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:8px;padding-right:2px;";
    bindScrollLock(listContainer, null);

    const close = () => mask.remove();
    closeBtn.addEventListener("click", close);

    function renderGists(filterText = "") {
      listContainer.innerHTML = "";
      const q = filterText.toLowerCase().trim();

      const filtered = gists.filter((g) => {
        if (!q) return true;
        return (
          (g.description || "").toLowerCase().includes(q) ||
          g.id.toLowerCase().includes(q) ||
          g.files.some((f) => f.toLowerCase().includes(q))
        );
      });

      if (!filtered.length) {
        listContainer.innerHTML = `<div style="text-align:center;padding:24px;color:#787670;font-size:12px;">未匹配到符合条件的 Gist</div>`;
        return;
      }

      // 排序：包含快照备份文件 web_snapshot_manager_sync.json 的排最前
      filtered.sort((a, b) => (b.isSnapshotGist ? 1 : 0) - (a.isSnapshotGist ? 1 : 0));

      for (const item of filtered) {
        const row = document.createElement("div");
        const isSnap = !!item.isSnapshotGist;
        row.style.cssText =
          "border:1px solid " + (isSnap ? "rgba(197,100,115,0.25)" : "#e3e1db") + ";" +
          "background:" + (isSnap ? "rgba(197,100,115,0.04)" : "#ffffff") + ";" +
          "border-radius:10px;padding:10px 12px;cursor:pointer;transition:all 0.2s cubic-bezier(0.22,1,0.36,1);display:flex;flex-direction:column;gap:4px;";

        row.addEventListener("mouseenter", () => {
          row.style.borderColor = "#c56473";
          row.style.transform = "translateY(-1px)";
          row.style.boxShadow = "0 4px 14px rgba(197,100,115,0.12)";
        });
        row.addEventListener("mouseleave", () => {
          row.style.borderColor = isSnap ? "rgba(197,100,115,0.25)" : "#e3e1db";
          row.style.transform = "none";
          row.style.boxShadow = "none";
        });

        const filesSummary = item.files.slice(0, 3).join(", ") + (item.files.length > 3 ? ` 等 ${item.files.length} 个文件` : "");
        const updateDate = item.updatedAt ? formatTime(new Date(item.updatedAt).getTime()) : "-";

        row.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <div style="font-size:12.5px;font-weight:600;color:#24231f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
              ${isSnap ? "🌸 " : ""}${escapeHtml(item.description || "（未命名 Gist）")}
            </div>
            <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:${item.isPublic ? "rgba(166,73,83,0.08);color:#a64953;border:1px solid rgba(166,73,83,0.2);" : "#f0efeb;color:#5c5a55;border:1px solid #e3e1db;"};white-space:nowrap;font-family:ui-monospace,monospace;">
              ${item.isPublic ? "Public" : "Secret"}
            </span>
          </div>
          ${isSnap ? `<div style="font-size:11px;color:#c56473;font-weight:500;">✨ 包含快照备份文件 (${GistSyncEngine.GIST_FILENAME})</div>` : ""}
          <div style="font-size:11px;color:#787670;display:flex;align-items:center;justify-content:space-between;gap:4px;">
            <span>包含文件: <code>${escapeHtml(filesSummary || "无")}</code></span>
            <span>更新于: <span style="font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums;">${updateDate}</span></span>
          </div>
          <div style="font-size:10px;color:#a8a69f;font-family:ui-monospace,monospace;">ID: ${item.id}</div>
        `;

        row.addEventListener("click", () => {
          if (syncInputGistId) {
            syncInputGistId.value = item.id;
          }
          GistSyncEngine.setSyncConfig({ token: t, gistId: item.id });
          updateCloudStatusUI();
          showToast(`已选择并绑定 Gist: ${item.description || item.id}`, "success");
          close();
        });

        listContainer.appendChild(row);
      }
    }

    searchInput.addEventListener("input", (e) => renderGists(e.target.value));

    mask.addEventListener("click", (e) => {
      if (e.target === mask) close();
    });

    renderGists("");

    box.appendChild(headerRow);
    box.appendChild(searchInput);
    box.appendChild(listContainer);
    mask.appendChild(box);
    document.documentElement.appendChild(mask);
    setTimeout(() => searchInput.focus(), 50);
  }
  


  // -----------------------------------------------------------------------
  // 主题抽屉渲染与交互控制器
  // -----------------------------------------------------------------------
  function renderQuickThemeMenu() {
    if (!themeQuickList) return;
    const active = ThemeEngine.getActiveTheme();
    const allThemes = ThemeEngine.getAllThemes();
    if (themeQuickCount) themeQuickCount.textContent = `共 ${allThemes.length} 款`;

    themeQuickList.innerHTML = allThemes
      .map((t) => {
        const isActive = t.id === active.id;
        return `
          <div class="${uid}-dropdown-item ${isActive ? `${uid}-item-accent` : ""}" data-quick-theme-id="${t.id}" style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
              <span style="display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0;">
                <span class="${uid}-theme-swatch-dot" style="width: 10px; height: 10px; background: ${t.tokens.accent};" title="主色"></span>
                <span class="${uid}-theme-swatch-dot" style="width: 10px; height: 10px; background: ${t.tokens.bgPaper};" title="底色"></span>
              </span>
              <span style="font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.name)}</span>
            </div>
            ${isActive ? `<span style="color: var(--lsm-accent); font-weight: bold; font-size: 11px; flex-shrink: 0;">✓</span>` : ""}
          </div>
        `;
      })
      .join("");

    themeQuickList.querySelectorAll("[data-quick-theme-id]").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const tid = item.getAttribute("data-quick-theme-id");
        if (tid) {
          const switched = ThemeEngine.setActiveTheme(tid);
          renderQuickThemeMenu();
          renderThemeList();
          if (themeQuickMenu) themeQuickMenu.classList.add("hidden");
          showToast(`已切换为主题: ${switched.name}`, "success");
        }
      });
    });
  }

  function renderThemeList() {
    const active = ThemeEngine.getActiveTheme();
    const allThemes = ThemeEngine.getAllThemes();

    if (curThemeName) curThemeName.textContent = active.name;
    if (curThemeBadge) {
      curThemeBadge.textContent = active.isBuiltin ? "官方预设" : "自定义";
      curThemeBadge.style.cssText = active.isBuiltin
        ? "background:var(--lsm-accent-bg);color:var(--lsm-accent);border:1px solid var(--lsm-accent-border);"
        : "background:var(--lsm-bg-warning);color:var(--lsm-color-warning);border:1px solid var(--lsm-border-warning);";
    }
    if (curThemeDesc) curThemeDesc.textContent = active.description || "暂无描述";

    if (curThemeSwatches) {
      const swatches = [
        { label: "Accent", color: active.tokens.accent },
        { label: "Paper", color: active.tokens.bgPaper },
        { label: "Header", color: active.tokens.bgHeader },
        { label: "Success", color: active.tokens.colorSuccess },
        { label: "Warning", color: active.tokens.colorWarning },
        { label: "Info", color: active.tokens.colorInfo }
      ];
      curThemeSwatches.innerHTML = swatches
        .map(
          (s) =>
            `<span title="${s.label}: ${s.color}" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--lsm-text-muted);">
              <span class="${uid}-theme-swatch-dot" style="background:${s.color};"></span>
              <span>${s.label}</span>
            </span>`
        )
        .join("");
    }

    if (themeCountText) themeCountText.textContent = `共 ${allThemes.length} 套`;

    if (themeGrid) {
      themeGrid.innerHTML = allThemes
        .map((t) => {
          const isActive = t.id === active.id;
          const isBuiltin = !!t.isBuiltin;
          return `
            <div class="${uid}-theme-item ${isActive ? `${uid}-theme-item-active` : ""}" data-theme-id="${t.id}">
              <div class="${uid}-theme-item-header">
                <div class="${uid}-theme-item-title" title="${escapeHtml(t.name)}">
                  ${isActive ? "✓ " : ""}${escapeHtml(t.name)}
                </div>
                ${
                  !isBuiltin
                    ? `<button class="${uid}-btn-del-theme ${uid}-theme-item-badge" data-del-id="${t.id}" style="background:none;border:none;color:var(--lsm-color-danger);font-size:12px;cursor:pointer;padding:1px 4px;line-height:1;flex-shrink:0;white-space:nowrap;" title="删除此自定义主题">✕</button>`
                    : `<span class="${uid}-theme-item-badge" style="font-size:9.5px;color:var(--lsm-text-muted);background:var(--lsm-bg-header);padding:1px 4px;border-radius:3px;flex-shrink:0;white-space:nowrap;">内置</span>`
                }
              </div>
              <div class="${uid}-theme-item-palette">
                <span class="${uid}-theme-swatch-dot" style="background:${t.tokens.accent};" title="主色"></span>
                <span class="${uid}-theme-swatch-dot" style="background:${t.tokens.bgPaper};" title="底色"></span>
                <span class="${uid}-theme-swatch-dot" style="background:${t.tokens.colorSuccess};" title="成功色"></span>
                <span class="${uid}-theme-swatch-dot" style="background:${t.tokens.colorWarning};" title="提示色"></span>
              </div>
            </div>
          `;
        })
        .join("");

      // 绑定主题切换点击
      themeGrid.querySelectorAll(`.${uid}-theme-item`).forEach((item) => {
        item.addEventListener("click", (e) => {
          if (e.target.closest(".btn-del-theme") || e.target.classList.contains(`${uid}-btn-del-theme`)) return;
          const tid = item.getAttribute("data-theme-id");
          if (tid) {
            const switched = ThemeEngine.setActiveTheme(tid);
            if (themeEditorMode === "edit") {
              openThemeEditor("edit");
            }
            renderThemeList();
            showToast(`已切换为主题: ${switched.name}`, "success");
          }
        });
      });

      // 绑定自定义主题删除
      themeGrid.querySelectorAll(`.${uid}-btn-del-theme`).forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const delId = btn.getAttribute("data-del-id");
          if (confirm("确定要删除此自定义主题吗？")) {
            try {
              ThemeEngine.deleteCustomTheme(delId);
              if (themeEditorWrap && themeEditorWrap.style.display !== "none") {
                closeThemeEditor();
              }
              renderThemeList();
              renderQuickThemeMenu();
              showToast("已删除自定义主题", "info");
            } catch (err) {
              showToast(err.message, "error");
            }
          }
        });
      });
    }
  }

  function openThemeDialog() {
    closeAllDrawers();
    renderThemeList();
    if (themeDialog) themeDialog.classList.add("open");
  }

  function closeThemeDialog() {
    closeThemeEditor();
    if (themeDialog) themeDialog.classList.remove("open");
  }

  if (btnCloseTheme) {
    btnCloseTheme.addEventListener("click", closeThemeDialog);
  }

  if (btnQuickTheme) {
    btnQuickTheme.addEventListener("click", (e) => {
      e.stopPropagation();
      renderQuickThemeMenu();
      if (themeQuickMenu) themeQuickMenu.classList.toggle("hidden");
      if (dropdownMenu) dropdownMenu.classList.add("hidden");
    });
  }

  if (btnOpenThemeSettings) {
    btnOpenThemeSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      if (themeQuickMenu) themeQuickMenu.classList.add("hidden");
      openThemeDialog();
    });
  }

  if (btnMenuTheme) {
    btnMenuTheme.addEventListener("click", () => {
      closeMenu();
      openThemeDialog();
    });
  }

  // 导出当前主题
  if (btnExportTheme) {
    btnExportTheme.addEventListener("click", () => {
      const active = ThemeEngine.getActiveTheme();
      const jsonStr = ThemeEngine.exportTheme(active.id);
      const safeName = (active.name || "theme").replace(/[\\/:*?"<>|]/g, "_");
      downloadJsonFile(`${safeName}_theme.json`, JSON.parse(jsonStr));
      try {
        GM_setClipboard(jsonStr, "text");
        showToast(`主题「${active.name}」已导出文件并复制至剪贴板！`, "success");
      } catch (e) {
        showToast(`主题「${active.name}」已导出为 JSON 文件`, "success");
      }
    });
  }

  // 导入自定义主题 (直接唤起文件选择器)
  function handleThemeFileImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = ThemeEngine.importTheme(evt.target.result);
        renderThemeList();
        renderQuickThemeMenu();
        showToast(`主题「${imported.name}」导入成功并已应用！`, "success");
      } catch (err) {
        showToast(`导入失败: ${err.message}`, "error");
      }
      if (e.target) e.target.value = "";
    };
    reader.readAsText(file);
  }

  if (btnImportTheme) {
    btnImportTheme.addEventListener("click", () => {
      let inputEl = fileThemeJson || shadow.getElementById(`${uid}-file-theme-json`);
      if (!inputEl) {
        inputEl = document.createElement("input");
        inputEl.type = "file";
        inputEl.id = `${uid}-file-theme-json`;
        inputEl.accept = ".json,application/json";
        inputEl.style.display = "none";
        shadow.appendChild(inputEl);
        inputEl.addEventListener("change", handleThemeFileImport);
      }
      inputEl.value = "";
      inputEl.click();
    });
  }

  if (fileThemeJson) {
    fileThemeJson.addEventListener("change", handleThemeFileImport);
  }

  // 恢复默认主题
  if (btnResetDefaultTheme) {
    btnResetDefaultTheme.addEventListener("click", () => {
      closeThemeEditor();
      ThemeEngine.resetToDefault();
      renderThemeList();
      renderQuickThemeMenu();
      showToast("已恢复为 Yohaku (余白) 默认主题", "success");
    });
  }

  // -----------------------------------------------------------------------
  // 主题配色编辑器交互（修改当前配色 / 新建自定义主题）
  // -----------------------------------------------------------------------
  let themeEditorMode = null; // 'edit' | 'create' | null

  function closeThemeEditor() {
    themeEditorMode = null;
    if (themeEditorWrap) themeEditorWrap.style.display = "none";
    if (btnEditTheme) {
      btnEditTheme.classList.remove(`${uid}-btn-primary`);
      btnEditTheme.classList.add(`${uid}-btn-secondary`);
    }
    if (btnCreateTheme) {
      btnCreateTheme.classList.remove(`${uid}-btn-primary`);
      btnCreateTheme.classList.add(`${uid}-btn-secondary`);
    }
  }

  function openThemeEditor(mode) {
    if (themeEditorMode === mode && themeEditorWrap && themeEditorWrap.style.display !== "none") {
      closeThemeEditor();
      return;
    }

    themeEditorMode = mode;
    if (themeEditorWrap) themeEditorWrap.style.display = "flex";

    const cur = ThemeEngine.getActiveTheme();
    const isEdit = mode === "edit";

    // 切换按钮激活态高亮
    if (btnEditTheme) {
      if (isEdit) {
        btnEditTheme.classList.add(`${uid}-btn-primary`);
        btnEditTheme.classList.remove(`${uid}-btn-secondary`);
      } else {
        btnEditTheme.classList.remove(`${uid}-btn-primary`);
        btnEditTheme.classList.add(`${uid}-btn-secondary`);
      }
    }
    if (btnCreateTheme) {
      if (!isEdit) {
        btnCreateTheme.classList.add(`${uid}-btn-primary`);
        btnCreateTheme.classList.remove(`${uid}-btn-secondary`);
      } else {
        btnCreateTheme.classList.remove(`${uid}-btn-primary`);
        btnCreateTheme.classList.add(`${uid}-btn-secondary`);
      }
    }

    if (themeEditorTitle) {
      themeEditorTitle.textContent = isEdit ? "✏️ 修改当前主题配色" : "➕ 新建自定义主题";
    }

    if (btnSaveCustomTheme) {
      btnSaveCustomTheme.textContent = isEdit ? "💾 保存修改并应用" : "💾 创建并立即应用";
    }

    if (isEdit) {
      if (editThemeName) editThemeName.value = cur.name;
    } else {
      if (editThemeName) {
        editThemeName.value = cur.isBuiltin ? `${cur.name} (定制)` : `${cur.name} 副本`;
      }
    }

    if (editColorAccent) editColorAccent.value = (cur.tokens.accent && cur.tokens.accent.startsWith("#")) ? cur.tokens.accent.slice(0, 7) : "#c56473";
    if (editColorPaper) editColorPaper.value = (cur.tokens.bgPaper && cur.tokens.bgPaper.startsWith("#")) ? cur.tokens.bgPaper.slice(0, 7) : "#faf9f5";
    if (editColorHeader) editColorHeader.value = (cur.tokens.bgHeader && cur.tokens.bgHeader.startsWith("#")) ? cur.tokens.bgHeader.slice(0, 7) : "#f0efeb";

    setTimeout(() => {
      try {
        themeEditorWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (e) {}
    }, 40);
  }

  function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== "string") return `rgba(197, 100, 115, ${alpha})`;
    let c = hex.replace("#", "").trim();
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    if (c.length >= 6) {
      const r = parseInt(c.slice(0, 2), 16);
      const g = parseInt(c.slice(2, 4), 16);
      const b = parseInt(c.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
    return hex;
  }

  if (btnEditTheme) {
    btnEditTheme.addEventListener("click", () => openThemeEditor("edit"));
  }

  if (btnCreateTheme) {
    btnCreateTheme.addEventListener("click", () => openThemeEditor("create"));
  }

  if (btnCancelThemeEditor) {
    btnCancelThemeEditor.addEventListener("click", closeThemeEditor);
  }

  // 保存（修改或新建）自定义主题
  if (btnSaveCustomTheme) {
    btnSaveCustomTheme.addEventListener("click", () => {
      const isEdit = themeEditorMode === "edit";
      const name = (editThemeName && editThemeName.value ? editThemeName.value.trim() : "") || (isEdit ? "未命名主题" : "自定义主题");
      const accent = (editColorAccent && editColorAccent.value) || "#c56473";
      const paper = (editColorPaper && editColorPaper.value) || "#faf9f5";
      const header = (editColorHeader && editColorHeader.value) || "#f0efeb";

      const baseTheme = ThemeEngine.getActiveTheme();
      const newTokens = Object.assign({}, baseTheme.tokens, {
        accent: accent,
        accentBg: hexToRgba(accent, 0.08),
        accentBorder: hexToRgba(accent, 0.3),
        accentHoverBg: hexToRgba(accent, 0.14),
        accentGlow: hexToRgba(accent, 0.12),
        bgPaper: paper,
        bgHeader: header,
        bgList: paper,
        bgHover: header
      });

      let themeObj;
      if (isEdit && !baseTheme.isBuiltin) {
        // 修改现有的自定义主题：保留原 ID 与创建时间
        themeObj = {
          type: ThemeEngine.SCHEMA_TYPE,
          version: ThemeEngine.SCHEMA_VERSION,
          id: baseTheme.id,
          name: name,
          description: baseTheme.description || `修改于 ${new Date().toLocaleDateString()}`,
          isBuiltin: false,
          tokens: newTokens,
          createdAt: baseTheme.createdAt || Date.now(),
          updatedAt: Date.now()
        };
      } else {
        // 新建自定义主题 或 基于官方预设修改后生成独立自定义主题
        const newId = "custom_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
        themeObj = {
          type: ThemeEngine.SCHEMA_TYPE,
          version: ThemeEngine.SCHEMA_VERSION,
          id: newId,
          name: name,
          description: isEdit ? `基于官方预设「${baseTheme.name}」定制的主题` : `基于「${baseTheme.name}」新建的个性化主题`,
          isBuiltin: false,
          tokens: newTokens,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }

      try {
        const saved = ThemeEngine.saveCustomTheme(themeObj);
        renderThemeList();
        renderQuickThemeMenu();
        closeThemeEditor();
        showToast(isEdit ? `主题「${saved.name}」修改已保存并生效！` : `新主题「${saved.name}」已创建并应用！`, "success");
      } catch (err) {
        showToast(`保存失败: ${err.message}`, "error");
      }
    });
  }

    function openWindow() {
    if (ball) {
      ball.style.display = "none";
      ball.classList.add("hidden");
    }
    if (win) {
      win.style.display = "flex";
      win.classList.remove("hidden");
      refreshList();
      updateCloudStatusUI();
      if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.checkSyncOnOpen) {
        GistSyncEngine.checkSyncOnOpen();
      }
    }
  }

  function closeWindow() {
    if (win) {
      win.style.display = "none";
      win.classList.add("hidden");
    }
    if (ball) {
      ball.style.display = "flex";
      ball.classList.remove("hidden");
    }
    closeSaveDialog();
    closeQrCodeDialog();
    closeScanDialog();
    closeCloudSyncDialog();
  }

  // -----------------------------------------------------------------------
  // 事件绑定
  // -----------------------------------------------------------------------
  makeDraggable(ball, ball, () => openWindow());
  makeDraggable(win, header);

  // 严格锁定外层管理窗口容器自身的滚动偏移（防止因权限弹窗/焦点切换导致窗口内内容整体错位）
  win.addEventListener("scroll", () => {
    if (win.scrollTop !== 0) win.scrollTop = 0;
    if (win.scrollLeft !== 0) win.scrollLeft = 0;
  }, { passive: true });

  // 阻止管理窗口与抽屉弹窗内滚动穿透到宿主网页（PC 滚轮 + 移动端触摸双重拦截）
  bindScrollLock(win, `.${uid}-content, .${uid}-save-dialog, .${uid}-qr-dialog, .${uid}-scan-dialog, .${uid}-sync-dialog, .${uid}-sync-body, .${uid}-theme-dialog, .${uid}-theme-body`);
  bindScrollLock(menuMask, null);

  // 悬浮球右上角菜单
  const ballCloseBtn = shadow.querySelector(`.${uid}-ball-close`);
  if (ballCloseBtn) {
    ballCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuMask.classList.remove("hidden");
    });
  }

  menuMask.addEventListener("click", (e) => {
    if (e.target === menuMask) menuMask.classList.add("hidden");
  });

  menuMask.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      menuMask.classList.add("hidden");
      const action = btn.getAttribute("data-a");
      if (action === "open") {
        openWindow();
      } else if (action === "save") {
        openWindow();
        openSaveDialog();
      } else if (action === "temp") {
        ball.style.display = "none";
        win.style.display = "none";
        win.classList.add("hidden");
      } else if (action === "forever") {
        removeHostFromShowList();
        ball.style.display = "none";
        win.style.display = "none";
        win.classList.add("hidden");
      }
    });
  });

  // 窗口顶部操作
  shadow.getElementById(`${uid}-btn-close`).addEventListener("click", () => closeWindow());

  // 工具栏操作
  shadow.getElementById(`${uid}-btn-save-current`).addEventListener("click", () => openSaveDialog());
  shadow.getElementById(`${uid}-btn-clear-current`).addEventListener("click", async () => {
    if (confirm(`确定要清空当前网站 (${location.hostname}) 的所有快照数据（Cookie、LocalStorage、SessionStorage）吗？\n清空后将处于未快照。`)) {
      showToast("正在清空当前网站数据...", "info");
      try {
        const res = await SessionManager.clearAllData();
        setActiveRecordId("");
        refreshList();
        showToast(`已清空 Cookie ${res.cookieCount}个, Storage ${res.storageCount}项`, "success");
        setTimeout(() => {
          if (confirm("当前网站快照数据已彻底清空！是否立即刷新网页以生效？")) {
            location.reload();
          }
        }, 300);
      } catch (e) {
        showToast(`清空失败: ${e.message}`, "error");
      }
    }
  });
  shadow.getElementById(`${uid}-btn-reload`).addEventListener("click", () => location.reload());

  // 状态条云同步点击
  if (statusCloud) {
    statusCloud.addEventListener("click", () => {
      openCloudSyncDialog();
    });
  }

  // 工具栏同步按钮点击
  if (btnSyncToolbar) {
    btnSyncToolbar.addEventListener("click", async () => {
      const token = GistSyncEngine.getToken();
      const gistId = GistSyncEngine.getGistId();
      if (!token || !gistId) {
        openCloudSyncDialog();
        showToast("请先配置 GitHub Token 和 Gist ID", "info");
        return;
      }
      await GistSyncEngine.twoWaySync({ silent: false });
    });
  }

  // 云同步抽屉内操作绑定
  if (btnCloseSync) {
    btnCloseSync.addEventListener("click", () => closeCloudSyncDialog());
  }

  if (btnToggleTokenEye && syncInputToken) {
    btnToggleTokenEye.addEventListener("click", () => {
      const isPwd = syncInputToken.type === "password";
      syncInputToken.type = isPwd ? "text" : "password";
      btnToggleTokenEye.textContent = isPwd ? "🙈" : "👁️";
    });
  }

  if (btnTestToken) {
    btnTestToken.addEventListener("click", async () => {
      const val = syncInputToken ? syncInputToken.value.trim() : "";
      if (!val) {
        showToast("请先输入 GitHub Token", "error");
        return;
      }
      try {
        showToast("正在连接 GitHub API 验证 Token...", "info");
        btnTestToken.disabled = true;
        const res = await GistSyncEngine.testConnection(val);
        showToast(`Token 验证成功！账号: @${res.login} (${res.name})`, "success");
        GistSyncEngine.setSyncConfig({ token: val });
        updateCloudStatusUI();
      } catch (err) {
        showToast(`连接失败: ${err.message}`, "error");
        updateCloudStatusUI("error", err.message);
      } finally {
        btnTestToken.disabled = false;
      }
    });
  }

  if (btnSearchGists) {
    btnSearchGists.addEventListener("click", () => {
      showGistPickerModal();
    });
  }

  if (btnAutoCreateGist) {
    btnAutoCreateGist.addEventListener("click", async () => {
      const tokenVal = syncInputToken ? syncInputToken.value.trim() : "";
      if (!tokenVal) {
        showToast("请先填写有效的 GitHub Token", "error");
        if (syncInputToken) syncInputToken.focus();
        return;
      }
      if (confirm("是否立即在 GitHub 上创建一个专属私有 Gist 用于存储快照同步数据？")) {
        try {
          showToast("正在 GitHub 创建 Secret Gist...", "info");
          btnAutoCreateGist.disabled = true;
          const res = await GistSyncEngine.createGist(tokenVal);
          if (syncInputGistId) {
            syncInputGistId.value = res.gistId;
          }
          GistSyncEngine.setSyncConfig({ token: tokenVal, gistId: res.gistId });
          showToast("Gist 创建并绑定成功！", "success");
          updateCloudStatusUI();
        } catch (err) {
          showToast(`创建 Gist 失败: ${err.message}`, "error");
        } finally {
          btnAutoCreateGist.disabled = false;
        }
      }
    });
  }

  if (btnSaveSyncConfig) {
    btnSaveSyncConfig.addEventListener("click", () => {
      const tokenVal = syncInputToken ? syncInputToken.value.trim() : "";
      const gistVal = syncInputGistId ? syncInputGistId.value.trim() : "";
      const autoVal = syncSwitchAuto ? syncSwitchAuto.checked : false;

      GistSyncEngine.setSyncConfig({
        token: tokenVal,
        gistId: gistVal,
        autoSync: autoVal
      });
      updateCloudStatusUI();
      showToast("云同步配置已保存！", "success");
    });
  }

  if (syncSwitchAuto) {
    syncSwitchAuto.addEventListener("change", (e) => {
      const enabled = e.target.checked;
      GistSyncEngine.setSyncConfig({ autoSync: enabled });
      showToast(enabled ? "已开启快照变更时自动同步 (2秒防抖)" : "已关闭快照自动同步", "info");
    });
  }

  if (btnSyncNowDrawer) {
    btnSyncNowDrawer.addEventListener("click", async () => {
      const tokenVal = syncInputToken ? syncInputToken.value.trim() : "";
      const gistVal = syncInputGistId ? syncInputGistId.value.trim() : "";
      if (!tokenVal || !gistVal) {
        showToast("请先填写并保存 Token 与 Gist ID", "error");
        return;
      }
      GistSyncEngine.setSyncConfig({ token: tokenVal, gistId: gistVal });
      await GistSyncEngine.twoWaySync({ silent: false });
    });
  }

  // 更多操作下拉菜单中的云同步项
  if (btnMenuCloud) {
    btnMenuCloud.addEventListener("click", () => {
      dropdownMenu.classList.add("hidden");
      openCloudSyncDialog();
    });
  }
  if (btnMenuSyncNow) {
    btnMenuSyncNow.addEventListener("click", async () => {
      dropdownMenu.classList.add("hidden");
      await GistSyncEngine.twoWaySync({ silent: false });
    });
  }

  // 搜索过滤框事件绑定
  const searchInput = shadow.getElementById(`${uid}-search-input`);
  const searchClearBtn = shadow.getElementById(`${uid}-search-clear`);

  searchInput.addEventListener("input", () => {
    const val = searchInput.value;
    searchClearBtn.classList.toggle("hidden", !val);
    refreshList(val);
  });

  searchClearBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchClearBtn.classList.add("hidden");
    searchInput.focus();
    refreshList("");
  });

  // 更多操作下拉菜单
  if (btnMore) {
    btnMore.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle("hidden");
    });
  }

  // 点击外部收起下拉菜单
  wrapper.addEventListener("click", (e) => {
    if (themeQuickMenu && !themeQuickMenu.classList.contains("hidden") && btnQuickTheme && !btnQuickTheme.contains(e.target) && !themeQuickMenu.contains(e.target)) {
      themeQuickMenu.classList.add("hidden");
    }
    if (!dropdownMenu.classList.contains("hidden") && !btnMore.contains(e.target)) {
      dropdownMenu.classList.add("hidden");
    }
  });

  // 批量导出
  shadow.getElementById(`${uid}-btn-export-all`).addEventListener("click", () => {
    dropdownMenu.classList.add("hidden");
    const records = DB.getRecords();
    if (!records.length) {
      showToast("当前网站暂无可导出的记录", "info");
      return;
    }
    const exportData = {
      type: "LSM_BATCH_EXPORT",
      version: "1.0",
      domain: location.hostname,
      exportTime: Date.now(),
      count: records.length,
      records: records
    };
    downloadJsonFile(`${location.hostname}_all_sessions.json`, exportData);
    showToast(`成功导出 ${records.length} 条记录`, "success");
  });

  // 批量导入
  const fileImportInput = shadow.getElementById(`${uid}-file-import`);
  shadow.getElementById(`${uid}-btn-import-all`).addEventListener("click", () => {
    dropdownMenu.classList.add("hidden");
    fileImportInput.value = "";
    fileImportInput.click();
  });
  fileImportInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      showToast("正在读取导入文件...", "info");
      const json = await readFileAsJson(file);
      let toImport = [];
      let fileDomain = json.domain || "";

      if (json.type === "LSM_BATCH_EXPORT" && Array.isArray(json.records)) {
        toImport = json.records;
      } else if (json.type === "LSM_SINGLE_EXPORT" && json.record) {
        toImport = [json.record];
        fileDomain = json.record.domain || fileDomain;
      } else if (Array.isArray(json)) {
        toImport = json;
      } else if (json.name && json.cipherData) {
        toImport = [json];
        fileDomain = json.domain || fileDomain;
      } else {
        throw new Error("无法识别的备份文件结构");
      }

      // 检测跨域名
      if (fileDomain && fileDomain !== location.hostname) {
        const proceed = confirm(
          `⚠️ 域名不匹配提示：\n\n该备份文件来源网站为：[${fileDomain}]\n而当前所在网站为：[${location.hostname}]\n\n跨网站导入可能导致快照无法生效或无法直接解密。是否仍要继续导入到当前网站？`
        );
        if (!proceed) {
          showToast("已取消导入", "info");
          return;
        }
      }

      const { count, skipped } = DB.importRecords(toImport);
      refreshList();
      if (count === 0 && skipped > 0) {
        showToast(`检测到 ${skipped} 条快照数据已存在，已全部自动跳过`, "info");
      } else if (skipped > 0) {
        showToast(`成功导入 ${count} 条快照，已自动跳过 ${skipped} 条重复记录`, "success");
      } else {
        showToast(`成功导入 ${count} 条快照记录！`, "success");
      }
    } catch (err) {
      showToast(`导入失败: ${err.message}`, "error");
    }
  });

  // -----------------------------------------------------------------------
  // 快照通用直接恢复引擎（支持文件直接恢复、剪贴板恢复、Ctrl+V 粘贴触发）
  // -----------------------------------------------------------------------
  async function restoreSnapshotData(json, defaultName) {
    let targetCipher = null;
    let targetUrl = "";
    let targetName = defaultName || "";
    let fileDomain = json.domain || "";

    if (json.type === "LSM_SINGLE_EXPORT" && json.record) {
      targetCipher = json.record.cipherData;
      targetUrl = json.record.url || "";
      targetName = json.record.name || targetName;
      fileDomain = json.record.domain || fileDomain;
    } else if (json.type === "LSM_BATCH_EXPORT" && Array.isArray(json.records) && json.records.length > 0) {
      targetCipher = json.records[0].cipherData;
      targetUrl = json.records[0].url || "";
      targetName = json.records[0].name || targetName;
      fileDomain = json.records[0].domain || fileDomain;
    } else if (json.name && json.cipherData) {
      targetCipher = json.cipherData;
      targetUrl = json.url || "";
      targetName = json.name || targetName;
      fileDomain = json.domain || fileDomain;
    } else if (json.cookies || json.localStorage) {
      targetCipher = { encrypted: false, payload: JSON.stringify(json) };
      targetUrl = json.url || "";
      fileDomain = json.domain || fileDomain;
    } else {
      throw new Error("无法识别的快照数据格式");
    }

    if (!targetCipher) throw new Error("快照数据中缺少有效凭据");

    // 检测跨域名
    if (fileDomain && fileDomain !== location.hostname) {
      const proceed = confirm(
        `⚠️ 域名不匹配提示：\n\n该快照来源网站为：[${fileDomain}]\n而当前所在网站为：[${location.hostname}]\n\n跨网站恢复可能导致当前网站无法识别该快照。是否仍要继续恢复？`
      );
      if (!proceed) {
        showToast("已取消恢复", "info");
        return;
      }
    }

    showToast("正在解密并恢复快照...", "info");
    const recDomain = fileDomain || location.hostname;
    const sessionData = await CryptoEngine.decrypt(targetCipher, recDomain);
    const res = await SessionManager.restoreSession(sessionData);
    CryptoEngine.wipeMemory(sessionData);
    setActiveRecordId("");
    refreshList();
    showToast(`恢复成功: Cookie ${res.cookieSuccessCount}个, Storage ${res.localCount + res.sessionCount}项`, "success");

    setTimeout(() => {
      const hasSpecificUrl = targetUrl && targetUrl.startsWith("http") && targetUrl !== location.href;
      const targetJumpUrl = hasSpecificUrl ? targetUrl : location.href;

      if (isAutoReloadEnabled()) {
        if (hasSpecificUrl) {
          location.href = targetJumpUrl;
        } else {
          location.reload();
        }
        return;
      }

      const confirmMsg = hasSpecificUrl
        ? `快照 [${targetName || "已选择"}] 已恢复！\n检测到该记录保存自页面：\n${targetUrl}\n\n是否立即跳转/刷新至该页面以应用快照？`
        : `快照 [${targetName || "已选择"}] 已恢复！是否立即刷新网页以应用快照？`;

      if (confirm(confirmMsg)) {
        if (hasSpecificUrl) {
          location.href = targetUrl;
        } else {
          location.reload();
        }
      }
    }, 300);
  }

  // 从文件恢复（不导入）
  const fileRestoreDirectInput = shadow.getElementById(`${uid}-file-restore-direct`);
  shadow.getElementById(`${uid}-btn-restore-file`).addEventListener("click", () => {
    dropdownMenu.classList.add("hidden");
    fileRestoreDirectInput.value = "";
    fileRestoreDirectInput.click();
  });
  fileRestoreDirectInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      showToast("正在解析备份文件...", "info");
      const json = await readFileAsJson(file);
      await restoreSnapshotData(json, file.name);
    } catch (err) {
      showToast(`恢复失败: ${err.message}`, "error");
    }
  });

  // 从剪贴板恢复（免文件）
  shadow.getElementById(`${uid}-btn-restore-clipboard`).addEventListener("click", async () => {
    dropdownMenu.classList.add("hidden");
    try {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        text = prompt("请在此粘贴快照 JSON 数据：") || "";
      }
      if (!text || !text.trim()) {
        showToast("未获取到剪贴板文本，请先复制快照数据", "info");
        return;
      }

      let json;
      try {
        json = JSON.parse(text.trim());
      } catch {
        throw new Error("剪贴板内容不是合法的 JSON 快照数据");
      }

      await restoreSnapshotData(json, "剪贴板快照");
    } catch (err) {
      showToast(`剪贴板恢复失败: ${err.message}`, "error");
    }
  });

  // 监听全局 Ctrl+V / Paste 事件，仅在管理窗口打开时响应，检测到快照 JSON 直接触发恢复
  window.addEventListener(
    "paste",
    async (e) => {
      // 只有在管理窗口处于激活显示状态时才响应快捷快照粘贴，避免干扰正常浏览网页时的日常粘贴
      if (win.classList.contains("hidden") || win.style.display === "none") return;

      const activeEl = shadow.activeElement || document.activeElement;
      // 如果焦点在快照重命名/自定义命名的 input 输入框内，且粘贴的不是包含快照特征的 JSON，则正常粘贴
      const isRenameInput = activeEl && activeEl.id === `${uid}-input-name`;

      let text = "";
      if (e.clipboardData) {
        text = e.clipboardData.getData("text");
      }
      if (!text || typeof text !== "string") return;

      const trimmed = text.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return;

      try {
        const json = JSON.parse(trimmed);
        const isSnapshot =
          (json.type === "LSM_SINGLE_EXPORT" && json.record) ||
          (json.type === "LSM_BATCH_EXPORT" && Array.isArray(json.records) && json.records.length > 0) ||
          (json.name && json.cipherData) ||
          (json.cipherData && json.cipherData.ciphertext) ||
          (json.summary && (json.cookies || json.localStorage));

        if (!isSnapshot) return;

        // 如果是在输入框中，且用户粘贴的是合法的快照，才拦截默认粘贴
        e.preventDefault();
        e.stopPropagation();

        const targetName =
          (json.record && json.record.name) ||
          json.name ||
          (json.records && json.records[0] && json.records[0].name) ||
          "剪贴板快照";

        const originDomain = json.domain || (json.record && json.record.domain) || "";
        const domainTip = originDomain && originDomain !== location.hostname ? `\n(⚠️ 来源域名: ${originDomain}，当前域名: ${location.hostname})` : "";

        const confirmRestore = confirm(
          `📋 检测到您在管理面板中粘贴了快照数据 [${targetName}]！${domainTip}\n\n是否立即解密并恢复此快照到当前网站？`
        );
        if (confirmRestore) {
          await restoreSnapshotData(json, targetName);
        }
      } catch (err) {
        // 忽略非快照数据解析错误
      }
    },
    true
  );

  // 保存弹窗操作
  const btnConfirmSave = shadow.getElementById(`${uid}-btn-confirm-save`);
  shadow.getElementById(`${uid}-btn-cancel-save`).addEventListener("click", () => closeSaveDialog());

  btnConfirmSave.addEventListener("click", async () => {
    const name = inputName.value.trim() || getDefaultName();
    if (!tempCapturedData) {
      showToast("未检测到有效数据，请重新打开", "error");
      return;
    }
    try {
      const newRec = await DB.addRecord(name, tempCapturedData);
      tempCapturedData = null;
      if (newRec && newRec.id) {
        setActiveRecordId(newRec.id);
      }
      closeSaveDialog();
      refreshList();
      showToast("快照信息已安全加密保存！", "success");
    } catch (e) {
      showToast(`保存失败: ${e.message}`, "error");
    }
  });

  // 保存抽屉按键与全局弹窗 Escape 事件
  window.addEventListener(
    "keydown",
    (e) => {
      // 仅在主管理窗口可见时响应
      if (win.classList.contains("hidden") || win.style.display === "none") return;

      if (e.key === "Escape") {
        if (qrDialog && qrDialog.classList.contains("open")) {
          e.preventDefault();
          e.stopPropagation();
          closeQrCodeDialog();
          return;
        }
        if (scanDialog && scanDialog.classList.contains("open")) {
          e.preventDefault();
          e.stopPropagation();
          closeScanDialog();
          return;
        }
        if (saveDialog && saveDialog.classList.contains("open")) {
          e.preventDefault();
          e.stopPropagation();
          closeSaveDialog();
          return;
        }
      } else if (e.key === "Enter") {
        if (saveDialog && saveDialog.classList.contains("open")) {
          e.preventDefault();
          e.stopPropagation();
          btnConfirmSave.click();
          return;
        }
      }
    },
    true
  );

  // -----------------------------------------------------------------------
  // 二维码与扫码导入抽屉操作事件绑定
  // -----------------------------------------------------------------------
  const btnOpenScan = shadow.getElementById(`${uid}-btn-open-scan`);
  if (btnOpenScan) {
    btnOpenScan.addEventListener("click", () => openScanImportModal());
  }

  const btnMenuScan = shadow.getElementById(`${uid}-btn-menu-scan`);
  if (btnMenuScan) {
    btnMenuScan.addEventListener("click", () => {
      dropdownMenu.classList.add("hidden");
      openScanImportModal();
    });
  }

  // 二维码抽屉按钮
  if (btnCloseQr) btnCloseQr.addEventListener("click", () => closeQrCodeDialog());
  if (btnCloseQrBottom) btnCloseQrBottom.addEventListener("click", () => closeQrCodeDialog());

  // 分片轮播播放器事件绑定
  if (btnStartChunkQr) btnStartChunkQr.addEventListener("click", () => startChunkCarousel());
  if (btnChunkPlayToggle) btnChunkPlayToggle.addEventListener("click", () => toggleChunkPlay());
  if (btnChunkPrev) btnChunkPrev.addEventListener("click", () => prevChunk());
  if (btnChunkNext) btnChunkNext.addEventListener("click", () => nextChunk());
  if (btnChunkExit) btnChunkExit.addEventListener("click", () => exitChunkMode());

  if (btnDownloadQr) {
    btnDownloadQr.addEventListener("click", () => {
      if (btnDownloadQr.disabled) {
        showToast("快照数据过大无法生成二维码图片，请使用「复制数据」或「导出文件」", "error");
        return;
      }
      if (!qrCanvas) return;
      try {
        const url = qrCanvas.toDataURL("image/png");
        const a = document.createElement("a");
        const fileName = (currentQrRecord && currentQrRecord.name ? currentQrRecord.name : "snapshot").replace(/[\\/:*?"<>|]/g, "_");
        a.href = url;
        a.download = `${location.hostname}_${fileName}_qr.png`;
        a.click();
        showToast("二维码图片已开始下载", "success");
      } catch (err) {
        showToast(`二维码图片下载失败: ${err.message}`, "error");
      }
    });
  }

  if (btnCopyQrData) {
    btnCopyQrData.addEventListener("click", () => {
      if (!currentQrJson) {
        showToast("暂无可复制的二维码数据", "info");
        return;
      }
      try {
        if (typeof GM_setClipboard === "function") {
          GM_setClipboard(currentQrJson, "text");
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(currentQrJson).catch(() => {});
        }
        showToast("快照 JSON 数据已复制到剪贴板！", "success");
      } catch (err) {
        showToast(`复制失败: ${err.message}`, "error");
      }
    });
  }

  // 扫码与导入抽屉按钮
  if (btnCloseScan) btnCloseScan.addEventListener("click", () => closeScanDialog());
  if (btnStartCamera) btnStartCamera.addEventListener("click", () => startCameraScan());

  if (btnChooseImg && fileScanImage) {
    btnChooseImg.addEventListener("click", () => {
      fileScanImage.value = "";
      fileScanImage.click();
    });
  }

  if (fileScanImage) {
    fileScanImage.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleImageQrFile(file);
    });
  }

  if (btnChooseJson && fileScanJson) {
    btnChooseJson.addEventListener("click", () => {
      fileScanJson.value = "";
      fileScanJson.click();
    });
  }

  if (fileScanJson) {
    fileScanJson.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        showToast("正在读取 JSON 快照文件...", "info");
        const json = await readFileAsJson(file);
        handleParsedSnapshot(json, file.name);
      } catch (err) {
        showToast(`读取失败: ${err.message}`, "error");
      }
    });
  }

  // 拖拽解析支持
  if (scanViewMain) {
    scanViewMain.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    scanViewMain.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (file.type.startsWith("image/")) {
        handleImageQrFile(file);
      } else if (file.name.endsWith(".json") || file.type.includes("json")) {
        try {
          showToast("正在读取 JSON 快照文件...", "info");
          const json = await readFileAsJson(file);
          handleParsedSnapshot(json, file.name);
        } catch (err) {
          showToast(`读取失败: ${err.message}`, "error");
        }
      } else {
        showToast("请拖入图片二维码截图或 .json 快照文件", "error");
      }
    });
  }

  // 扫码结果视图操作
  if (btnScanRestoreNow) {
    btnScanRestoreNow.addEventListener("click", async () => {
      if (!currentScannedSnapshot || !currentScannedSnapshot.json) {
        showToast("无可恢复的快照数据", "error");
        return;
      }
      const targetJson = currentScannedSnapshot.json;
      const targetName = currentScannedSnapshot.name;
      try {
        closeScanDialog();
        await restoreSnapshotData(targetJson, targetName);
      } catch (err) {
        showToast(`恢复失败: ${err.message}`, "error");
      }
    });
  }

  if (btnScanSaveDb) {
    btnScanSaveDb.addEventListener("click", () => {
      if (!currentScannedSnapshot || !currentScannedSnapshot.recordsToImport) {
        showToast("无可保存的快照数据", "error");
        return;
      }
      const recordsToImport = currentScannedSnapshot.recordsToImport;
      try {
        const { count, skipped } = DB.importRecords(recordsToImport);
        refreshList();
        closeScanDialog();
        if (count === 0 && skipped > 0) {
          showToast(`检测到 ${skipped} 条快照数据已存在，已全部跳过`, "info");
        } else if (skipped > 0) {
          showToast(`成功导入 ${count} 条快照，跳过 ${skipped} 条重复记录`, "success");
        } else {
          showToast(`成功导入并保存 ${count} 条快照记录！`, "success");
        }
      } catch (err) {
        showToast(`保存失败: ${err.message}`, "error");
      }
    });
  }

  if (btnScanRetry) {
    btnScanRetry.addEventListener("click", () => {
      resetScanModal();
    });
  }

  // 初始化位置与列表
  restoreUIPos();
  refreshList();

  // 视口 Resize 时防止悬浮球和管理窗口溢出屏幕
  window.addEventListener("resize", () => {
    try {
      if (ball && ball.style.display !== "none" && !ball.classList.contains("hidden")) {
        const br = ball.getBoundingClientRect();
        if (br.left + br.width > window.innerWidth || br.top + br.height > window.innerHeight) {
          const maxLeft = Math.max(10, window.innerWidth - (ball.offsetWidth || 50) - 12);
          const maxTop = Math.max(10, window.innerHeight - (ball.offsetHeight || 50) - 12);
          ball.style.left = Math.min(br.left, maxLeft) + "px";
          ball.style.top = Math.min(br.top, maxTop) + "px";
        }
      }
      if (win && win.style.display !== "none" && !win.classList.contains("hidden")) {
        const wr = win.getBoundingClientRect();
        if (wr.left + wr.width > window.innerWidth || wr.top + wr.height > window.innerHeight) {
          const maxLeft = Math.max(10, window.innerWidth - (win.offsetWidth || 480) - 20);
          const maxTop = Math.max(10, window.innerHeight - (win.offsetHeight || 520) - 20);
          win.style.left = Math.min(wr.left, maxLeft) + "px";
          win.style.top = Math.min(wr.top, maxTop) + "px";
        }
      }
    } catch {}
  });

  // SPA 单页应用路由切换感知 (History API / Hash)
  const handleRouteChange = () => {
    // 如果窗口正在展示且保存抽屉处于开启状态，动态刷新默认命名
    if (saveDialog && saveDialog.classList.contains("open") && inputName) {
      const currentVal = inputName.value;
      if (currentVal.startsWith("快照_") || !currentVal) {
        inputName.value = getDefaultName();
      }
    }
  };

  window.addEventListener("popstate", handleRouteChange);
  window.addEventListener("hashchange", handleRouteChange);

  if (!window.__LSM_HISTORY_HOOKED__) {
    window.__LSM_HISTORY_HOOKED__ = true;
    const rawPushState = history.pushState;
    if (typeof rawPushState === "function") {
      history.pushState = function (...args) {
        const ret = rawPushState.apply(this, args);
        handleRouteChange();
        return ret;
      };
    }

    const rawReplaceState = history.replaceState;
    if (typeof rawReplaceState === "function") {
      history.replaceState = function (...args) {
        const ret = rawReplaceState.apply(this, args);
        handleRouteChange();
        return ret;
      };
    }
  }

  // 暴露给全局控制器
  LSM_UI = {
    ball,
    win,
    openWindow,
    openThemeDialog,
    closeWindow,
    openCloudSyncDialog,
    closeCloudSyncDialog
  };
}
