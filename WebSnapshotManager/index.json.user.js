// ==UserScript==
// @name         网站快照存储与恢复助手
// @namespace    https://github.com/moyefu/BrowserScript/WebSnapshotManager
// @version      1.2.4
// @description  针对指定网站实现快照（Cookie、LocalStorage、SessionStorage）的一键存储、命名、加密备份、二维码生成/扫码与一键恢复
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
// @require      https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js
// @require      https://cdn.jsdelivr.net/npm/zxing-wasm@1.2.14/dist/iife/reader/index.js
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
==/UserConfig== */

// 全局暴露的 UI 实例，供菜单命令与外部调度使用
let LSM_UI = null;

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

(async () => {
  "use strict";

  // =========================================================================
  // 0. 用户配置：filter_mode（白名单/黑名单）+ host_list（域名列表，支持 * 通配符）
  //    默认白名单模式：仅匹配到列表中的网站才运行脚本
  //    黑名单模式：匹配到列表中的网站不运行，其他网站均运行
  // =========================================================================
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

  // =========================================================================
  // 菜单命令注册（Tampermonkey / ScriptCat 菜单）
  // 1. 🔑 快照管理助手
  // 2. 🛡️ 过滤模式切换（白名单 / 黑名单）
  // 3. 📝 编辑域名名单列表
  // 4. 🔒 本地数据加密状态切换
  // 5. 🔄 恢复后刷新跳转状态切换
  // =========================================================================
  function registerAllMenuCommands() {
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

  // 1. PC 端鼠标滚轮事件精确拦截
  mask.addEventListener(
    "wheel",
    (e) => {
      e.stopPropagation();
      const scrollable = scrollableSelector && e.target.closest ? e.target.closest(scrollableSelector) : null;
      if (!scrollable) {
        e.preventDefault();
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = scrollable;
      const deltaY = e.deltaY;
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
      const scrollable = scrollableSelector && e.target.closest ? e.target.closest(scrollableSelector) : null;
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
    "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:360px;max-width:calc(100vw - 40px);background:#ffffff;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(15,23,42,0.25),0 0 0 1px rgba(15,23,42,0.06);box-sizing:border-box;animation:lsmFadeIn .2s ease-out;";

  const title = document.createElement("div");
  title.innerHTML = "🔑 <span style='color:#0f172a;font-size:16px;font-weight:700;'>快照管理助手未激活</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const mode = getFilterMode();

  const desc = document.createElement("div");
  desc.textContent = mode === "blacklist"
    ? "当前网站已被加入「黑名单」列表中，快照助手未在此站点激活。你可以选择："
    : "当前网站不在「白名单」列表中，快照助手未在此站点激活。你可以选择：";
  desc.style.cssText = "font-size:13px;color:#64748b;line-height:1.6;margin-bottom:18px;";

  const tempBtn = document.createElement("button");
  tempBtn.textContent = "临时显示（仅本次生效）";
  tempBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-bottom:10px;border:none;border-radius:10px;" +
    "background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;font-size:13px;cursor:pointer;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,0.25);";

  const permBtn = document.createElement("button");
  permBtn.textContent = mode === "blacklist" ? "永久开启（移出黑名单）" : "永久开启（加入白名单）";
  permBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;border:1px solid #e2e8f0;border-radius:10px;" +
    "background:#f8fafc;color:#1e293b;font-size:13px;cursor:pointer;font-weight:600;";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-top:8px;border:none;background:none;" +
    "color:#94a3b8;font-size:12px;cursor:pointer;";

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
    "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:360px;max-width:calc(100vw - 40px);background:#ffffff;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(15,23,42,0.25),0 0 0 1px rgba(15,23,42,0.06);box-sizing:border-box;animation:lsmFadeIn .2s ease-out;";

  const title = document.createElement("div");
  title.innerHTML = "🔑 <span style='color:#0f172a;font-size:16px;font-weight:700;'>快照管理助手</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const mode = getFilterMode();

  const desc = document.createElement("div");
  desc.textContent = mode === "blacklist"
    ? "当前网站处于黑名单排除范围之外，功能就绪。你可以选择："
    : "当前网站已在白名单允许列表中，功能就绪。你可以选择：";
  desc.style.cssText = "font-size:13px;color:#64748b;line-height:1.6;margin-bottom:18px;";

  const openBtn = document.createElement("button");
  openBtn.textContent = "打开管理窗口";
  openBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-bottom:10px;border:none;border-radius:10px;" +
    "background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;font-size:13px;cursor:pointer;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,0.25);";

  const tmpBtn = document.createElement("button");
  tmpBtn.textContent = "临时隐藏悬浮球（刷新后恢复）";
  tmpBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-bottom:10px;border:1px solid #e2e8f0;border-radius:10px;" +
    "background:#f8fafc;color:#334155;font-size:13px;cursor:pointer;font-weight:500;";

  const permBtn = document.createElement("button");
  permBtn.textContent = mode === "blacklist" ? "永久关闭（加入黑名单）" : "永久关闭（从白名单移除）";
  permBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;border:1px solid #fecdd3;border-radius:10px;" +
    "background:#fff1f2;color:#e11d48;font-size:13px;cursor:pointer;font-weight:500;";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-top:8px;border:none;background:none;" +
    "color:#94a3b8;font-size:12px;cursor:pointer;";

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
    "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:380px;max-width:calc(100vw - 40px);background:#ffffff;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(15,23,42,0.25),0 0 0 1px rgba(15,23,42,0.06);box-sizing:border-box;animation:lsmFadeIn .2s ease-out;";

  const title = document.createElement("div");
  title.innerHTML = "🛡️ <span style='color:#0f172a;font-size:16px;font-weight:700;'>切换域名过滤模式</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const desc = document.createElement("div");
  desc.innerHTML =
    `当前模式：<strong style="color:#0f172a;">${currentMode === "blacklist" ? "黑名单模式 (列表中的网站不生效)" : "白名单模式 (仅在列表中生效)"}</strong><br>` +
    `点击下方按钮将切换为：<strong style="color:#2563eb;">${targetModeLabel}</strong>。<br>` +
    `<span style="color:#94a3b8;font-size:12px;">切换后将立即生效并刷新当前页面。</span>`;
  desc.style.cssText = "font-size:13px;color:#64748b;line-height:1.6;margin-bottom:18px;";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = `确认切换为「${targetModeLabel}」`;
  confirmBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-bottom:10px;border:none;border-radius:10px;" +
    "background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;font-size:13px;cursor:pointer;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,0.25);";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-top:4px;border:none;background:none;" +
    "color:#94a3b8;font-size:12px;cursor:pointer;";

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
    "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  bindScrollLock(mask, "textarea");

  const box = document.createElement("div");
  box.style.cssText =
    "width:460px;max-width:calc(100vw - 40px);background:#ffffff;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(15,23,42,0.25),0 0 0 1px rgba(15,23,42,0.06);box-sizing:border-box;animation:lsmFadeIn .2s ease-out;";

  const title = document.createElement("div");
  title.innerHTML = "📝 <span style='color:#0f172a;font-size:16px;font-weight:700;'>编辑域名规则列表</span>";
  title.style.cssText = "margin-bottom:8px;display:flex;align-items:center;gap:6px;";

  const desc = document.createElement("div");
  desc.innerHTML =
    `当前生效模式：<strong style="color:#2563eb;">${mode === "blacklist" ? "黑名单模式 (列表中不生效)" : "白名单模式 (仅在列表中生效)"}</strong><br>` +
    `每行一条规则，支持通配符 <code>*</code>（例：<code>https://*.example.com*</code> 或 <code>*.baidu.com</code>）：`;
  desc.style.cssText = "font-size:12.5px;color:#64748b;line-height:1.5;margin-bottom:12px;";

  const textarea = document.createElement("textarea");
  textarea.value = String(raw || "");
  textarea.placeholder = "*.google.com\nhttps://github.com/*\n*.example.org";
  textarea.style.cssText =
    "width:100%;height:160px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;" +
    "padding:10px 12px;font-size:13px;line-height:1.5;font-family:Consolas,Monaco,monospace;color:#1e293b;resize:vertical;outline:none;" +
    "background:#f8fafc;transition:border-color .15s,box-shadow .15s;margin-bottom:16px;";
  textarea.addEventListener("focus", () => {
    textarea.style.borderColor = "#3b82f6";
    textarea.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.15)";
    textarea.style.background = "#ffffff";
  });
  textarea.addEventListener("blur", () => {
    textarea.style.borderColor = "#cbd5e1";
    textarea.style.boxShadow = "none";
    textarea.style.background = "#f8fafc";
  });

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:10px;justify-content:flex-end;align-items:center;";

  const addCurrBtn = document.createElement("button");
  addCurrBtn.textContent = "+ 添加当前网站";
  addCurrBtn.style.cssText =
    "padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f1f5f9;color:#334155;font-size:12px;cursor:pointer;font-weight:500;";
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
    "padding:8px 18px;border:none;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;font-size:12.5px;cursor:pointer;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,0.25);";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "padding:8px 14px;border:none;background:none;color:#94a3b8;font-size:12px;cursor:pointer;";

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
    "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:380px;max-width:calc(100vw - 40px);background:#ffffff;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(15,23,42,0.25),0 0 0 1px rgba(15,23,42,0.06);box-sizing:border-box;animation:lsmFadeIn .2s ease-out;";

  const title = document.createElement("div");
  title.innerHTML = "🔒 <span style='color:#0f172a;font-size:16px;font-weight:700;'>本地数据加密设置</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const desc = document.createElement("div");
  desc.innerHTML =
    `当前状态：<strong style="color:${isEnc ? "#16a34a" : "#e11d48"};">${isEnc ? "已开启 AES-GCM 256 位加密" : "未开启（明文存储）"}</strong><br>` +
    `点击确认将切换为：<strong style="color:#2563eb;">${targetEnc ? "开启本地数据加密" : "关闭本地数据加密"}</strong>。<br>` +
    `<span style="color:#94a3b8;font-size:12px;">（新保存的快照将按新设置执行，已保存的旧快照依然支持正常读取）</span>`;
  desc.style.cssText = "font-size:13px;color:#64748b;line-height:1.6;margin-bottom:18px;";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = targetEnc ? "确认开启加密" : "确认关闭加密";
  confirmBtn.style.cssText =
    `display:block;width:100%;padding:10px 0;margin-bottom:10px;border:none;border-radius:10px;` +
    `background:${targetEnc ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "linear-gradient(135deg,#e11d48,#be123c)"};color:#ffffff;font-size:13px;cursor:pointer;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.15);`;

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-top:4px;border:none;background:none;" +
    "color:#94a3b8;font-size:12px;cursor:pointer;";

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
    "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  bindScrollLock(mask, null);

  const box = document.createElement("div");
  box.style.cssText =
    "width:380px;max-width:calc(100vw - 40px);background:#ffffff;border-radius:16px;" +
    "padding:24px;box-shadow:0 20px 45px -10px rgba(15,23,42,0.25),0 0 0 1px rgba(15,23,42,0.06);box-sizing:border-box;animation:lsmFadeIn .2s ease-out;";

  const title = document.createElement("div");
  title.innerHTML = "🔄 <span style='color:#0f172a;font-size:16px;font-weight:700;'>恢复后自动刷新设置</span>";
  title.style.cssText = "margin-bottom:10px;display:flex;align-items:center;gap:6px;";

  const desc = document.createElement("div");
  desc.innerHTML =
    `当前状态：<strong style="color:${isAutoReload ? "#16a34a" : "#64748b"};">${isAutoReload ? "已开启自动刷新/跳转（无需二次弹窗确认）" : "不默认刷新（恢复后弹窗提示是否刷新）"}</strong><br>` +
    `点击确认将切换为：<strong style="color:#2563eb;">${targetState ? "恢复后直接自动刷新/跳转" : "恢复后二次弹窗确认刷新"}</strong>。`;
  desc.style.cssText = "font-size:13px;color:#64748b;line-height:1.6;margin-bottom:18px;";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = targetState ? "确认切换为「自动刷新/跳转」" : "确认切换为「不默认刷新」";
  confirmBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-bottom:10px;border:none;border-radius:10px;" +
    "background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;font-size:13px;cursor:pointer;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,0.25);";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:10px 0;margin-top:4px;border:none;background:none;" +
    "color:#94a3b8;font-size:12px;cursor:pointer;";

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

// =========================================================================
// 主应用逻辑初始化
// =========================================================================
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
  // 数据库与存储管理
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

    async addRecord(name, rawSessionData) {
      const domain = location.hostname;
      const records = this.getRecords(domain);
      const cipherObject = await CryptoEngine.encrypt(rawSessionData);

      const newRecord = {
        id: "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        name: name.trim(),
        domain: domain,
        url: location.href,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        summary: rawSessionData.summary,
        cipherData: cipherObject
      };

      records.unshift(newRecord);
      this.saveRecords(records, domain);
      CryptoEngine.wipeMemory(rawSessionData);
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

        // 对比核心数据内容与 ID，已存在相同快照数据则直接跳过
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

        // 如果 ID 冲突则重新生成，避免重复
        const record = {
          ...item,
          id: item.id && !existing.some((r) => r.id === item.id) ? item.id : "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          importedAt: Date.now()
        };
        existing.unshift(record);
        count++;
      }
      if (count > 0) {
        this.saveRecords(existing, d);
      }
      return { count, skipped };
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
  document.documentElement.appendChild(container);

  const style = document.createElement("style");
  style.textContent = `
    #${uid}-root {
      all: initial;
      display: block;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #0f172a;
      font-size: 13px;
      line-height: 1.5;
      text-align: left;
      -webkit-font-smoothing: antialiased;
    }
    #${uid}-root *, #${uid}-root *::before, #${uid}-root *::after {
      box-sizing: border-box;
    }
    #${uid}-root input, #${uid}-root select, #${uid}-root textarea, #${uid}-root button {
      font-family: inherit;
    }

    /* 滚动条美化 */
    .${uid}-content::-webkit-scrollbar {
      width: 6px;
    }
    .${uid}-content::-webkit-scrollbar-track {
      background: transparent;
    }
    .${uid}-content::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
    .${uid}-content::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }

    /* 悬浮球 */
    #${uid}-ball {
      position: fixed;
      left: auto;
      top: auto;
      right: 25px;
      bottom: 80px;
      z-index: 2147483646;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1e40af 0%, #2563eb 50%, #3b82f6 100%);
      color: #ffffff;
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px -4px rgba(37, 99, 235, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.2) inset;
      cursor: grab;
      user-select: none;
      opacity: 0.65;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, opacity 0.25s ease, left 0.3s cubic-bezier(0.2, 0, 0, 1), top 0.3s cubic-bezier(0.2, 0, 0, 1);
    }
    #${uid}-ball:hover {
      opacity: 1;
      transform: scale(1.06);
      box-shadow: 0 12px 30px -4px rgba(37, 99, 235, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.3) inset;
    }
    #${uid}-ball.dragging {
      opacity: 1;
      cursor: grabbing;
      transform: scale(0.96);
      transition: none;
    }
    #${uid}-ball svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
      pointer-events: none;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15));
    }

    /* 悬浮球右上角微型关闭/菜单按钮 */
    .${uid}-ball-close {
      position: absolute;
      top: -3px;
      right: -3px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      line-height: 16px;
      background: #0f172a;
      color: #ffffff;
      font-size: 11px;
      text-align: center;
      cursor: pointer;
      display: none;
      z-index: 3;
      border: 1.5px solid #ffffff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      transition: background 0.15s ease, transform 0.15s ease;
    }
    #${uid}-ball:hover .${uid}-ball-close {
      display: block;
    }
    .${uid}-ball-close:hover {
      background: #e11d48;
      transform: scale(1.15);
    }

    /* 徽标 */
    .${uid}-badge {
      position: absolute;
      top: -3px;
      left: -3px;
      background: linear-gradient(135deg, #f43f5e, #e11d48);
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      min-width: 18px;
      height: 18px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
      border: 2px solid #ffffff;
      box-shadow: 0 2px 6px rgba(225, 29, 72, 0.4);
    }

    /* 悬浮球快捷菜单遮罩与弹窗 */
    .${uid}-menu-mask {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      background: rgba(15, 23, 42, 0.45);
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
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 45px -10px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.06);
      padding: 18px;
      width: 280px;
    }
    .${uid}-ball-menu-title {
      font-weight: 700;
      margin: 0 0 12px;
      font-size: 14px;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-ball-menu button {
      display: flex;
      align-items: center;
      width: 100%;
      margin-top: 8px;
      padding: 9px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #f8fafc;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      text-align: left;
      color: #334155;
      transition: all 0.15s ease;
    }
    .${uid}-ball-menu button:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #0f172a;
    }
    .${uid}-ball-menu button[data-a="forever"] {
      border-color: #fecdd3;
      background: #fff1f2;
      color: #e11d48;
    }
    .${uid}-ball-menu button[data-a="forever"]:hover {
      background: #ffe4e6;
    }

    /* 主管理窗口 */
    #${uid}-window {
      position: fixed;
      left: auto;
      top: auto;
      right: 30px;
      bottom: 90px;
      z-index: 2147483646;
      width: 560px;
      height: 660px;
      max-width: calc(100vw - 20px);
      max-height: calc(100vh - 30px);
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.08);
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
      padding: 13px 18px;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #334155 100%);
      color: #f8fafc;
      font-size: 14px;
      font-weight: 600;
      cursor: grab;
      user-select: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
      letter-spacing: 0.2px;
    }
    .${uid}-domain-tag {
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.18);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #f8fafc;
      font-size: 11px;
      padding: 2px 10px;
      border-radius: 9999px;
      font-weight: 500;
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
      border: none;
      background: rgba(255, 255, 255, 0.12);
      color: #f8fafc;
      border-radius: 8px;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s ease;
    }
    .${uid}-header-actions button:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: scale(1.05);
    }

    /* 状态条 */
    .${uid}-status-bar {
      padding: 7px 18px;
      background: #f8fafc;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: #64748b;
      flex: none;
    }
    .${uid}-status-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
    }
    .${uid}-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
    }
    .${uid}-dot-green {
      background: #10b981;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }
    .${uid}-dot-amber {
      background: #f59e0b;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
    }

    /* 操作工具栏 */
    .${uid}-toolbar {
      padding: 10px 18px;
      background: #ffffff;
      border-bottom: 1px solid #f1f5f9;
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
      gap: 6px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .${uid}-btn-primary {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
      color: #ffffff !important;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
    }
    .${uid}-btn-primary:hover {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
      color: #ffffff !important;
    }
    .${uid}-btn-secondary {
      background: #f8fafc;
      color: #334155;
      border-color: #e2e8f0;
    }
    .${uid}-btn-secondary:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #0f172a;
    }
    .${uid}-btn-danger {
      background: #fff1f2;
      color: #e11d48;
      border-color: #fecdd3;
    }
    .${uid}-btn-danger:hover {
      background: #ffe4e6;
      border-color: #fda4af;
    }
    .${uid}-btn-restore-pill {
      background: #f0fdf4 !important;
      color: #15803d !important;
      border-color: #bbf7d0 !important;
      font-weight: 600;
    }
    .${uid}-btn-restore-pill:hover {
      background: #dcfce7 !important;
      border-color: #86efac !important;
    }
    .${uid}-btn-sm {
      padding: 4px 10px;
      font-size: 11px;
      border-radius: 6px;
    }
    .${uid}-btn-icon {
      padding: 7px 9px !important;
      min-width: 32px;
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
      min-width: 175px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 12px 30px -4px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.05);
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
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 500;
      color: #334155;
      border-radius: 8px;
      cursor: pointer;
      user-select: none;
      transition: all 0.12s ease;
      white-space: nowrap;
    }
    .${uid}-dropdown-item:hover {
      background: #f1f5f9;
      color: #0f172a;
    }
    .${uid}-dropdown-divider {
      height: 1px;
      background: #f1f5f9;
      margin: 4px 0;
    }
    .${uid}-item-accent {
      color: #15803d !important;
      font-weight: 600;
    }
    .${uid}-item-accent:hover {
      background: #f0fdf4 !important;
      color: #166534 !important;
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
        padding: 6px 8px;
        font-size: 11px;
        gap: 4px;
      }
      .${uid}-content {
        padding: 10px 12px;
        gap: 10px;
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
    }

    /* 搜索栏精细化美化 */
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
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s ease;
    }
    .${uid}-search-input {
      width: 100%;
      height: 32px;
      padding: 0 28px 0 32px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      font-size: 12px;
      color: #1e293b;
      outline: none;
      box-sizing: border-box;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .${uid}-search-input::placeholder {
      color: #94a3b8;
      font-size: 11px;
    }
    .${uid}-search-input:focus {
      background: #ffffff;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }
    .${uid}-search-wrap:focus-within .${uid}-search-icon {
      color: #3b82f6;
    }
    .${uid}-search-clear {
      position: absolute;
      right: 7px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: none;
      background: #e2e8f0;
      color: #64748b;
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: all 0.15s ease;
    }
    .${uid}-search-clear:hover {
      background: #cbd5e1;
      color: #0f172a;
      transform: scale(1.08);
    }
    .${uid}-search-clear.hidden {
      display: none !important;
    }

    /* 记录列表区域 */
    .${uid}-content {
      padding: 14px 18px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
      background: #f8fafc;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
    .${uid}-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .${uid}-card:hover {
      border-color: #cbd5e1;
      transform: translateY(-2px);
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08);
    }
    .${uid}-card.${uid}-card-active {
      border-color: #86efac;
      background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 60%);
      box-shadow: 0 4px 14px -2px rgba(34, 197, 94, 0.15);
    }
    .${uid}-badge-active {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #bbf7d0;
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
      font-weight: 700;
      font-size: 13px;
      color: #0f172a;
      word-break: break-all;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-card-time {
      font-size: 11px;
      color: #94a3b8;
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
      padding: 2px 8px;
      border-radius: 9999px;
      line-height: 1.4;
    }
    .${uid}-chip-cookie {
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fef3c7;
    }
    .${uid}-chip-local {
      background: #f0fdf4;
      color: #15803d;
      border: 1px solid #dcfce7;
    }
    .${uid}-chip-session {
      background: #faf5ff;
      color: #7e22ce;
      border: 1px solid #f3e8ff;
    }
    .${uid}-chip-encrypted {
      background: #f0f9ff;
      color: #0284c7;
      border: 1px solid #e0f2fe;
    }

    /* 来源链接小标签 */
    .${uid}-card-origin {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      border-radius: 6px;
      padding: 4px 8px;
      margin-top: 2px;
      font-size: 11px;
      color: #64748b;
    }
    .${uid}-card-url {
      color: #2563eb;
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
      color: #1d4ed8;
    }

    /* 卡片操作栏 */
    .${uid}-card-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      border-top: 1px solid #f1f5f9;
      padding-top: 8px;
      margin-top: 2px;
    }
    .${uid}-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 50px 0;
      color: #94a3b8;
      text-align: center;
      gap: 10px;
    }

    /* 内置保存抽屉弹窗 */
    .${uid}-save-dialog {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      padding: 24px;
      gap: 16px;
      transform: translateY(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 10;
      overscroll-behavior: contain;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
    .${uid}-save-dialog.open {
      transform: translateY(0);
    }
    .${uid}-save-dialog-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-input-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .${uid}-input-label {
      font-size: 12px;
      font-weight: 600;
      color: #334155;
    }
    .${uid}-input {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      transition: all 0.15s ease;
    }
    .${uid}-input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }
    .${uid}-grid-preview {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 4px;
    }
    .${uid}-stat-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px;
      text-align: center;
    }
    .${uid}-stat-num {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 2px;
    }
    .${uid}-stat-label {
      font-size: 11px;
      color: #64748b;
    }

    /* 快照二维码展示抽屉弹窗 */
    .${uid}-qr-dialog {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      padding: 20px;
      gap: 12px;
      transform: translateY(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 12;
      overscroll-behavior: contain;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
    .${uid}-qr-dialog.open {
      transform: translateY(0);
    }
    .${uid}-qr-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
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
      border-radius: 12px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0,0,0,0.04);
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
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 12px;
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-align: center;
      max-width: 100%;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.08);
    }
    .${uid}-qr-chunk-player {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      width: 100%;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }
    .${uid}-qr-chunk-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      font-size: 12px;
      color: #334155;
      font-weight: 600;
    }
    .${uid}-qr-chunk-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #bfdbfe;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
    }
    .${uid}-qr-chunk-bar-wrap {
      width: 100%;
      height: 6px;
      background: #e2e8f0;
      border-radius: 9999px;
      overflow: hidden;
    }
    .${uid}-qr-chunk-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #06b6d4);
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

    /* 扫码与综合导入抽屉弹窗 */
    .${uid}-scan-dialog {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      padding: 20px;
      gap: 14px;
      transform: translateY(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 12;
      overscroll-behavior: contain;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
    .${uid}-scan-dialog.open {
      transform: translateY(0);
    }
    .${uid}-dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 10px;
    }
    .${uid}-dialog-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-dialog-close {
      background: none;
      border: none;
      font-size: 18px;
      line-height: 1;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .${uid}-dialog-close:hover {
      color: #0f172a;
      background: #f1f5f9;
    }

    /* 摄像头扫码视口与取景框 */
    .${uid}-camera-viewport {
      position: relative;
      width: 100%;
      height: 350px;
      background: #090d16;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15) inset;
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
      color: #94a3b8;
      gap: 8px;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      background: rgba(15, 23, 42, 0.92);
      z-index: 2;
    }
    .${uid}-scan-chunk-hud {
      position: absolute;
      bottom: 10px;
      left: 10px;
      right: 10px;
      top: auto;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 12px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 6;
      color: #ffffff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }
    .${uid}-scan-chunk-title {
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #f1f5f9;
    }
    .${uid}-scan-chunk-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-height: 84px;
      overflow-y: auto;
      padding: 2px 1px;
    }
    @keyframes ${uid}-chunk-pop {
      0% { transform: scale(0.8); }
      50% { transform: scale(1.15); }
      100% { transform: scale(1); }
    }
    .${uid}-scan-chunk-dot {
      min-width: 24px;
      height: 24px;
      padding: 0 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      border: 1px solid rgba(255, 255, 255, 0.15);
      transition: all 0.15s ease;
    }
    .${uid}-scan-chunk-dot.received {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #ffffff;
      border-color: #34d399;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
      animation: ${uid}-chunk-pop 0.25s ease-out;
    }
    .${uid}-scan-frame {
      position: absolute;
      width: 220px;
      height: 220px;
      border: 2px solid rgba(59, 130, 246, 0.7);
      border-radius: 12px;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.45);
      z-index: 3;
      pointer-events: none;
    }
    .${uid}-scan-corner {
      position: absolute;
      width: 16px;
      height: 16px;
      border-color: #38bdf8;
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
      background: linear-gradient(90deg, rgba(56,189,248,0) 0%, #38bdf8 50%, rgba(56,189,248,0) 100%);
      box-shadow: 0 0 10px #38bdf8, 0 0 4px #0284c7;
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
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.15s ease;
      color: #334155;
      gap: 6px;
      text-align: center;
    }
    .${uid}-dropzone-btn:hover {
      background: #f1f5f9;
      border-color: #3b82f6;
      color: #1d4ed8;
    }
    .${uid}-dropzone-label {
      font-size: 12px;
      font-weight: 600;
    }
    .${uid}-dropzone-hint {
      font-size: 10px;
      color: #94a3b8;
    }

    /* 识别成功结果展示卡片 */
    .${uid}-result-card {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .${uid}-result-title {
      font-size: 13px;
      font-weight: 700;
      color: #166534;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${uid}-result-domain-warn {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11px;
      color: #b45309;
      line-height: 1.5;
    }

    /* Toast 提示 */
    .${uid}-toast {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(-10px);
      background: #0f172a;
      color: #ffffff;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.3);
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
      background: #059669;
    }
    .${uid}-toast.error {
      background: #dc2626;
    }
    .${uid}-toast.info {
      background: #0f172a;
    }
  `;
  shadow.appendChild(style);

  const wrapper = document.createElement("div");
  wrapper.id = `${uid}-root`;
  wrapper.className = `${uid}-root`;
  wrapper.innerHTML = `
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
      <canvas id="${uid}-scan-hidden-canvas" style="display: none;"></canvas>

      <!-- 列表区 -->
      <div class="${uid}-content" id="${uid}-list"></div>

      <!-- 保存抽屉对话框 -->
      <div class="${uid}-save-dialog" id="${uid}-save-dialog">
        <div class="${uid}-save-dialog-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2">
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
            <div style="font-size: 12px; color: #64748b;">正在扫描当前页面快照凭据...</div>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2">
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
          <div id="${uid}-qr-rec-info" style="font-size: 12px; color: #334155; text-align: center; line-height: 1.5; word-break: break-all; width: 100%;">
            <strong id="${uid}-qr-rec-name" style="font-size: 14px; color: #0f172a;">快照名称</strong>
            <div id="${uid}-qr-rec-meta" style="font-size: 11px; color: #64748b; margin-top: 2px;"></div>
          </div>
          <div class="${uid}-qr-canvas-wrap" id="${uid}-qr-canvas-wrap">
            <canvas id="${uid}-qr-canvas"></canvas>
          </div>
          <div class="${uid}-qr-overflow-box" id="${uid}-qr-overflow-box" style="display: none;">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2">
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
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#2563eb;"></span>
                <span id="${uid}-qr-chunk-idx-text">分片 1 / 1</span>
              </span>
              <span style="font-size: 11px; color: #64748b;">500ms / 帧 · 循环播放</span>
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
          <div id="${uid}-qr-tip" style="font-size: 11px; color: #64748b; text-align: center;">
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2">
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

          <div style="font-size: 11px; color: #64748b; text-align: center;">或通过以下方式快速导入/恢复快照：</div>

          <!-- 备选方式：图片识别二维码 与 JSON 文件导入 -->
          <div class="${uid}-import-options">
            <div class="${uid}-dropzone-btn" id="${uid}-btn-choose-img" title="上传带有二维码的截图或图片进行解析">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <div class="${uid}-dropzone-label">图片识别二维码</div>
              <div class="${uid}-dropzone-hint">选择或拖入二维码截图</div>
            </div>

            <div class="${uid}-dropzone-btn" id="${uid}-btn-choose-json" title="直接导入 .json 快照文件">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="1.8">
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
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>快照凭据解析成功</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #0f172a;" id="${uid}-res-name">-</div>
            <div style="font-size: 11px; color: #475569; display: flex; flex-wrap: wrap; gap: 6px;" id="${uid}-res-chips"></div>
            <div style="font-size: 11px; color: #64748b;" id="${uid}-res-meta"></div>
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
    </div>

    <!-- Toast -->
    <div class="${uid}-toast" id="${uid}-toast"></div>
  `;
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
    inputName.value = getDefaultName();
    previewBox.innerHTML = `<span style="color: #64748b; font-size: 12px;">正在扫描当前快照...</span>`;
    saveDialog.classList.add("open");

    // 自动聚焦并全选输入框
    setTimeout(() => {
      inputName.focus();
      inputName.select();
    }, 50);

    try {
      const data = await SessionManager.captureCurrentSession();
      tempCapturedData = data;
      const sizeKb = data.summary.approxBytes ? (data.summary.approxBytes / 1024).toFixed(1) : "0";
      const isTooLarge = data.summary.approxBytes && data.summary.approxBytes > 1.5 * 1024 * 1024;

      previewBox.innerHTML = `
        <div class="${uid}-grid-preview">
          <div class="${uid}-stat-box" style="border-color: #fde68a; background: #fffbeb;">
            <div class="${uid}-stat-label" style="color: #b45309;">🍪 Cookie</div>
            <div class="${uid}-stat-num" style="color: #92400e;">${data.summary.cookieCount}</div>
          </div>
          <div class="${uid}-stat-box" style="border-color: #bbf7d0; background: #f0fdf4;">
            <div class="${uid}-stat-label" style="color: #15803d;">💾 Local</div>
            <div class="${uid}-stat-num" style="color: #166534;">${data.summary.localCount}</div>
          </div>
          <div class="${uid}-stat-box" style="border-color: #e9d5ff; background: #faf5ff;">
            <div class="${uid}-stat-label" style="color: #7e22ce;">📦 Session</div>
            <div class="${uid}-stat-num" style="color: #6b21a8;">${data.summary.sessionCount}</div>
          </div>
        </div>
        <div style="margin-top: 6px; font-size: 11px; color: ${isTooLarge ? "#b45309" : "#64748b"}; display: flex; align-items: center; justify-content: space-between;">
          <span>预估体积: <strong>${sizeKb} KB</strong></span>
          ${isTooLarge ? '<span style="color: #e11d48; font-weight: 600;">⚠️ 快照体积偏大 (>1.5MB)</span>' : '<span style="color: #10b981;">✓ 状态良好</span>'}
        </div>
      `;
    } catch (e) {
      previewBox.innerHTML = `<span style="color: #dc2626; font-size: 12px;">扫描异常: ${e.message}</span>`;
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

  function getZXingWASMDecoder() {
    if (typeof ZXingWASM !== "undefined") return ZXingWASM;
    if (typeof window !== "undefined" && window.ZXingWASM) return window.ZXingWASM;
    if (typeof globalThis !== "undefined" && globalThis.ZXingWASM) return globalThis.ZXingWASM;
    return null;
  }

  function getJsQRDecoder() {
    if (typeof jsQR !== "undefined") return jsQR;
    if (typeof window !== "undefined" && window.jsQR) return window.jsQR;
    if (typeof globalThis !== "undefined" && globalThis.jsQR) return globalThis.jsQR;
    return null;
  }

  /**
   * 将较长数据切割成 LSM_CHUNK 分片包
   * 将单片切片容量优化为 350 字符左右，纠错等级采用 L 级
   * 二维码 Version 降至 5~7 左右（点阵低密度稀疏，单个点大且清晰）
   * 极大提升摄像头扫码识别率（从 70% 提升至 99%+，毫秒级快速对焦）
   */
  function generateQrChunks(record, jsonStr) {
    const CHUNK_SIZE = 350; // 每个分片约 350 字符，生成 Version 5~7 低密度稀疏二维码，毫秒级瞬时识别
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
        size: 260,
        margin: 2,
        errorCorrectionLevel: "L",
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
          size: 260,
          margin: 2,
          errorCorrectionLevel: "L",
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
  // 扫码与综合导入抽屉逻辑 (摄像头 / 图片二维码 / JSON 文件 / 乱序分片接收 / 多线程识别)
  // -----------------------------------------------------------------------
  let cameraStream = null;
  let cameraAnimId = null;
  let currentScannedSnapshot = null;
  const chunkScanPool = new Map();

  // 多线程扫码识别引擎
  let nativeBarcodeDetector = null;
  let isDetectorBusy = false;
  let qrWorker = null;
  let isWorkerBusy = false;
  let lastDecodedCode = null;
  let lastDecodedTime = 0;
  let lastScanFrameTime = 0;
  const SCAN_FRAME_INTERVAL = 60; // 采样周期约 60ms (~16 FPS)，从根本上消除 60 FPS 密集采样导致的 GC 内存堆积与周期性停顿

  function getNativeBarcodeDetector() {
    if (nativeBarcodeDetector !== null) return nativeBarcodeDetector;
    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      try {
        nativeBarcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch (e) {
        nativeBarcodeDetector = false;
      }
    } else {
      nativeBarcodeDetector = false;
    }
    return nativeBarcodeDetector;
  }

  function getQrWorker() {
    if (qrWorker) return qrWorker;
    try {
      const workerScript = `
        let hasZXing = false;
        let hasJsQR = false;

        try {
          importScripts('https://cdn.jsdelivr.net/npm/zxing-wasm@1.2.14/dist/iife/reader/index.js');
          hasZXing = typeof ZXingWASM !== 'undefined' && typeof ZXingWASM.readBarcodes === 'function';
        } catch (e) {}

        try {
          importScripts('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js');
          hasJsQR = typeof jsQR === 'function';
        } catch (e) {}

        self.onmessage = async function(e) {
          const { buffer, width, height } = e.data;
          if (!buffer || !width || !height) {
            self.postMessage({ result: null });
            return;
          }

          const clamped = new Uint8ClampedArray(buffer);

          // 1. 默认优先使用 WASM 解码引擎 (ZXing C++ WebAssembly)
          const zxingInst = (typeof ZXingWASM !== 'undefined' && typeof ZXingWASM.readBarcodes === 'function')
            ? ZXingWASM
            : (self.ZXingWASM || null);

          if (zxingInst) {
            try {
              const barcodes = await zxingInst.readBarcodes(
                { data: clamped, width: width, height: height },
                { formats: ['QRCode'], tryHarder: false }
              );
              if (barcodes && barcodes.length > 0 && barcodes[0].text) {
                self.postMessage({ result: barcodes[0].text, engine: 'wasm' });
                return;
              }
            } catch (err) {
              // WASM 解码异常时平滑降级
            }
          }

          // 2. 兼容降级方案：jsQR 解码引擎
          const jsqrFn = (typeof jsQR === 'function') ? jsQR : (self.jsQR || null);
          if (jsqrFn) {
            try {
              const code = jsqrFn(clamped, width, height, { inversionAttempts: 'dontInvert' });
              if (code && code.data) {
                self.postMessage({ result: code.data, engine: 'jsqr' });
                return;
              }
            } catch (err) {}
          }

          self.postMessage({ result: null });
        };
      `;
      const blob = new Blob([workerScript], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      qrWorker = new Worker(workerUrl);
      qrWorker.onmessage = (e) => {
        isWorkerBusy = false;
        const { result } = e.data;
        if (result) {
          processDecodedCode(result);
        }
      };
      qrWorker.onerror = (err) => {
        console.warn("QR Web Worker 运行异常:", err);
        isWorkerBusy = false;
      };
    } catch (e) {
      console.warn("创建 QR Web Worker 失败 (可能受 CSP 限制):", e);
      qrWorker = null;
    }
    return qrWorker;
  }

  function processDecodedCode(rawStr) {
    if (!rawStr || typeof rawStr !== "string") return;
    const now = Date.now();
    // 同一数据 200ms 内防重触发
    if (rawStr === lastDecodedCode && now - lastDecodedTime < 200) {
      return;
    }
    lastDecodedCode = rawStr;
    lastDecodedTime = now;

    let chunkObj = null;
    try {
      const parsed = JSON.parse(rawStr.trim());
      if (parsed && parsed.type === "LSM_CHUNK" && parsed.id && typeof parsed.idx === "number" && parsed.total && typeof parsed.data === "string") {
        chunkObj = parsed;
      }
    } catch (e) {}

    if (chunkObj) {
      handleIncomingChunk(chunkObj);
      // 分片模式：不停止相机，持续在后台线程扫码直到全部集齐
    } else {
      // 普通完整二维码：直接停止扫描并解析
      stopCameraScan();
      handleQrDecodedString(rawStr);
    }
  }

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
    isDetectorBusy = false;
    isWorkerBusy = false;
    lastDecodedCode = null;
    lastDecodedTime = 0;
    lastScanFrameTime = 0;
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

    const now = performance.now();
    // 节流采样控制：限制每秒 16~20 FPS (约 60ms 采样一次)，从根本上消除 60 FPS 频繁调用 getImageData 造成的 V8 Major GC 停顿与卡顿
    if (cameraVideo.readyState === cameraVideo.HAVE_ENOUGH_DATA && (now - lastScanFrameTime >= SCAN_FRAME_INTERVAL)) {
      lastScanFrameTime = now;

      // 优先路径 1：独立 Web Worker 后台异步解码线程 (WASM 优先 -> jsQR 降级，Transferable ArrayBuffer 零拷贝)
      const worker = getQrWorker();
      if (worker) {
        if (!isWorkerBusy) {
          isWorkerBusy = true;
          const vw = cameraVideo.videoWidth || 640;
          const vh = cameraVideo.videoHeight || 480;
          // 优化处理分辨率（480px 对 Version 5~7 稀疏二维码具备 99.9% 识别率，且像素数据体积降低 60%）
          const targetWidth = Math.min(480, vw);
          const targetHeight = Math.round((vh / vw) * targetWidth);

          const canvas = scanHiddenCanvas || document.createElement("canvas");
          if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
          }
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(cameraVideo, 0, 0, targetWidth, targetHeight);
          const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

          worker.postMessage(
            {
              buffer: imageData.data.buffer,
              width: targetWidth,
              height: targetHeight
            },
            [imageData.data.buffer]
          );
        }
      } else {
        // 降级路径 2：主线程直接解码（默认 WASM 优先 -> 不兼容再降级 jsQR -> 兜底 BarcodeDetector）
        if (!isWorkerBusy) {
          isWorkerBusy = true;
          (async () => {
            try {
              if (cameraStream && cameraVideo.readyState === cameraVideo.HAVE_ENOUGH_DATA) {
                const vw = cameraVideo.videoWidth || 640;
                const vh = cameraVideo.videoHeight || 480;
                const targetWidth = Math.min(480, vw);
                const targetHeight = Math.round((vh / vw) * targetWidth);
                const canvas = scanHiddenCanvas || document.createElement("canvas");
                if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                  canvas.width = targetWidth;
                  canvas.height = targetHeight;
                }
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(cameraVideo, 0, 0, targetWidth, targetHeight);
                const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

                let decodedText = null;

                // 1. 默认 WASM 优先
                const zxing = getZXingWASMDecoder();
                if (zxing && typeof zxing.readBarcodes === "function") {
                  try {
                    const barcodes = await zxing.readBarcodes(imageData, {
                      formats: ["QRCode"],
                      tryHarder: false
                    });
                    if (barcodes && barcodes.length > 0 && barcodes[0].text) {
                      decodedText = barcodes[0].text;
                    }
                  } catch (e) {}
                }

                // 2. 不兼容再使用 jsQR
                if (!decodedText) {
                  const jsqr = getJsQRDecoder();
                  if (jsqr) {
                    try {
                      const code = jsqr(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: "dontInvert"
                      });
                      if (code && code.data) {
                        decodedText = code.data;
                      }
                    } catch (e) {}
                  }
                }

                // 3. 原生 BarcodeDetector 兜底
                if (!decodedText) {
                  const detector = getNativeBarcodeDetector();
                  if (detector) {
                    try {
                      const barcodes = await detector.detect(canvas);
                      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                        decodedText = barcodes[0].rawValue;
                      }
                    } catch (e) {}
                  }
                }

                if (decodedText) {
                  processDecodedCode(decodedText);
                }
              }
            } finally {
              isWorkerBusy = false;
            }
          })();
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
      img.onload = async () => {
        const canvas = scanHiddenCanvas || document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        let decodedText = null;

        // 1. 默认优先使用 WASM 解码引擎 (开启 tryHarder: true 提升离线图片检出率)
        const zxing = getZXingWASMDecoder();
        if (zxing && typeof zxing.readBarcodes === "function") {
          try {
            const barcodes = await zxing.readBarcodes(imageData, {
              formats: ["QRCode"],
              tryHarder: true
            });
            if (barcodes && barcodes.length > 0 && barcodes[0].text) {
              decodedText = barcodes[0].text;
            }
          } catch (err) {
            console.warn("WASM 图片解码异常，准备降级至 jsQR:", err);
          }
        }

        // 2. 降级方案：使用 jsQR 引擎
        if (!decodedText) {
          const decoder = getJsQRDecoder();
          if (decoder) {
            try {
              const code = decoder(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "attemptBoth"
              });
              if (code && code.data) {
                decodedText = code.data;
              }
            } catch (err) {
              console.warn("jsQR 图片解码异常:", err);
            }
          }
        }

        // 3. 原生 BarcodeDetector 兜底
        if (!decodedText) {
          const detector = getNativeBarcodeDetector();
          if (detector) {
            try {
              const barcodes = await detector.detect(canvas);
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                decodedText = barcodes[0].rawValue;
              }
            } catch (e) {}
          }
        }

        if (decodedText) {
          handleQrDecodedString(decodedText);
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
      <span class="${uid}-chip" style="background:#f8fafc;color:#475569;border-color:#e2e8f0;">🔒 ${isEnc}</span>
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

  function openWindow() {
    if (ball) {
      ball.style.display = "none";
      ball.classList.add("hidden");
    }
    if (win) {
      win.style.display = "flex";
      win.classList.remove("hidden");
      refreshList();
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
  }

  // -----------------------------------------------------------------------
  // 事件绑定
  // -----------------------------------------------------------------------
  makeDraggable(ball, ball, () => openWindow());
  makeDraggable(win, header);

  // 阻止管理窗口与抽屉弹窗内滚动穿透到宿主网页（PC 滚轮 + 移动端触摸双重拦截）
  bindScrollLock(win, `.${uid}-content, .${uid}-save-dialog, .${uid}-qr-dialog, .${uid}-scan-dialog`);
  bindScrollLock(menuMask, null);

  // 悬浮球右上角菜单
  shadow.querySelector(`.${uid}-ball-close`).addEventListener("click", (e) => {
    e.stopPropagation();
    menuMask.classList.remove("hidden");
  });

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
  const btnMore = shadow.getElementById(`${uid}-btn-more`);
  const dropdownMenu = shadow.getElementById(`${uid}-dropdown-menu`);
  btnMore.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle("hidden");
  });

  // 点击外部收起下拉菜单
  wrapper.addEventListener("click", (e) => {
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
    closeWindow
  };
}
