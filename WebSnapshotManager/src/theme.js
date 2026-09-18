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
