// =========================================================================
// 🚀 脚本主调度中心与生命周期入口 (main.js)
// 包含域名白名单/黑名单过滤、菜单命令注册、设置弹窗与非目标站点零开销静默
// =========================================================================

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

// 移动端/全平台弹窗滚动穿透防护助手
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
      const deltaY = currentY - startY;
      const { scrollTop, scrollHeight, clientHeight } = scrollable;

      if (scrollHeight <= clientHeight) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (deltaY > 0 && scrollTop <= 0) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      } else if (deltaY < 0 && scrollTop + clientHeight >= scrollHeight - 1) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      } else {
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

function showToggleEncryptionDialog() {
  if (document.querySelector(".lsm-dlg-mask")) return;
  ensureHostAnimationStyle();

  const isEnc = GM_getValue("Config.enable_encryption", false);
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

// 菜单命令注册
function registerAllMenuCommands() {
  GM_registerMenuCommand("🎨 主题设置 (切换/导出/导入)", async () => {
    if (!LSM_UI) {
      await initApp();
    }
    if (LSM_UI) {
      if (typeof LSM_UI.openWindow === "function") LSM_UI.openWindow();
      if (typeof LSM_UI.openThemeDialog === "function") LSM_UI.openThemeDialog();
    }
  });

  GM_registerMenuCommand("🔑 快照管理助手", () => {
    if (hostBlocked()) {
      showBlockedDialog();
    } else {
      showMainDialog();
    }
  });

  const currentMode = getFilterMode();
  const modeText = currentMode === "blacklist" ? "🛡️ 当前为【黑名单】模式 (点击切换为白名单)" : "🛡️ 当前为【白名单】模式 (点击切换为黑名单)";
  GM_registerMenuCommand(modeText, () => {
    showSwitchFilterModeDialog();
  });

  GM_registerMenuCommand("📝 编辑域名规则列表 (黑/白名单)", () => {
    showEditHostListDialog();
  });

  const isEnc = GM_getValue("Config.enable_encryption", false);
  const encText = isEnc ? "🔒 本地数据【已加密】 (点击切换/关闭)" : "🔓 本地数据【未加密】 (点击切换/开启)";
  GM_registerMenuCommand(encText, () => {
    showToggleEncryptionDialog();
  });

  const isAutoReload = GM_getValue("Config.auto_reload_after_restore", false);
  const reloadText = isAutoReload ? "🔄 恢复后【自动刷新/跳转】 (点击切换为不刷新)" : "⏸️ 恢复后【不默认刷新】 (点击切换为自动刷新)";
  GM_registerMenuCommand(reloadText, () => {
    showToggleAutoReloadDialog();
  });

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

// 应用启动挂载
async function initApp() {
  if (document.getElementById("lsm-session-manager-root")) {
    if (LSM_UI && LSM_UI.ball) {
      LSM_UI.ball.style.display = "";
      LSM_UI.ball.classList.remove("hidden");
    }
    return;
  }

  // 仅在脚本激活时才挂载 innerHTML 劫持与初始化 UI
  patchInnerHTMLSetter();
  initAppUI();
}

// 入口自执行
(async () => {
  "use strict";

  registerAllMenuCommands();

  // 🌟 性能核心：非目标网站极致静默短路，不污染任何全局对象
  if (hostBlocked()) return;

  initApp();
})();
