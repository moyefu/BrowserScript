// ==UserScript==
// @name         ScriptCat Agent 悬浮聊天窗
// @namespace    https://docs.scriptcat.org/docs/dev/agent/
// @version      1.15.0
// @description  悬浮球式 AI 聊天窗口：可拖动、流式对话、消息复制/重发、模型切换、本地缓存
// @author       MOYEFU
// @match        http*://*/*
// @grant        CAT.agent.conversation
// @grant        CAT.agent.model
// @grant        CAT.agent.dom
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @tag          MYF
// @run-at       document-idle
// @icon         https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=25&letterSpacing=1&duration=500&pause=500&color=F7009F&background=00D7FF00&vCenter=true&random=true&width=28&height=28&lines=AI
// @noframes
// ==/UserScript==

/* ==UserConfig==
Config:
  show_host:
      title: 显示的主机 (多个用换行区分)
      description: 每行一条，支持通配符 * ，例：https://*.example.org*；不填写则所有网站默认不显示
      type: textarea
 ==/UserConfig== */
(async () => {
  "use strict";

  // ============================================================
  // 0. 用户配置：show_host（每行一条，支持 * 通配符）→ 默认所有网站不显示，
  //    仅匹配到列表中的网站才运行脚本
  // ============================================================
  function hostBlocked() {
    try {
      const raw = GM_getValue("Config.show_host", "");
      const lines = String(raw || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!lines.length) return true; // 未配置任何显示网站 → 默认全部不显示
      const candidates = [location.href, location.origin, location.protocol + "//" + location.host, location.host];
      const matched = lines.some((line) => {
        const re = new RegExp(
          "^" + line.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
          "i"
        );
        return candidates.some((c) => re.test(c));
      });
      return !matched;
    } catch {
      return true;
    }
  }
  // 始终注册菜单命令（ScriptCat/Tampermonkey 菜单），按当前状态分发弹窗：
  // 已禁用 → 临时显示 / 永久开启（加入显示列表）；正常 → 临时关闭 / 永久关闭（从显示列表移除）
  GM_registerMenuCommand("🤖 AI 助手（悬浮聊天窗）", () => {
    if (hostBlocked()) showBlockedDialog();
    else showMainDialog();
  });
  if (hostBlocked()) return;
  initApp();
})();

// 菜单命令弹窗共享的轻量弹窗容器（主 UI 未初始化，全部用内联样式避免受页面 CSS 影响）
// 打开聊天窗/隐藏球需操作 initApp 内部创建的 UI，通过 SCA_UI 暴露
let SCA_UI = null;

// 把当前站点（origin）加入 show_host 显示列表（永久开启）
function addHostToShowList() {
  try {
    const raw = GM_getValue("Config.show_host", "");
    const lines = String(raw || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const entry = location.origin; // 如 https://example.com
    if (!lines.some((l) => l === entry)) {
      lines.push(entry);
      GM_setValue("Config.show_host", lines.join("\n"));
      console.log("[SCA] 已将该网站加入显示列表:", entry);
    }
  } catch (e) {
    console.error("[SCA] 写入配置失败:", e);
  }
}

// 本站在 show_host 之外被禁用时的处理：
// 注册菜单命令 → 弹窗让用户选择「临时显示」或「永久开启」
// （此函数须在 initApp 之前声明，故提取到 IIFE 之外）
function removeHostFromShowList() {
  try {
    const raw = GM_getValue("Config.show_host", "");
    const lines = String(raw || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return;
    const candidates = [location.href, location.origin, location.protocol + "//" + location.host, location.host];
    const kept = lines.filter((line) => {
      const re = new RegExp(
        "^" + line.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
        "i"
      );
      return !candidates.some((c) => re.test(c));
    });
    GM_setValue("Config.show_host", kept.join("\n"));
  } catch (e) {
    console.error("[SCA] 移除显示配置失败:", e);
  }
}

// 独立轻量弹窗（主 UI 未初始化，全部用内联样式避免受页面 CSS 影响）
function showBlockedDialog() {
  if (document.querySelector(".scab-dlg")) return;
  const mask = document.createElement("div");
  mask.className = "scab-dlg";
  mask.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);" +
    "display:flex;align-items:center;justify-content:center;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;";
  const box = document.createElement("div");
  box.style.cssText =
    "width:340px;max-width:calc(100vw - 40px);background:#fff;border-radius:12px;" +
    "padding:22px;box-shadow:0 10px 40px rgba(0,0,0,.25);box-sizing:border-box;";
  const title = document.createElement("div");
  title.textContent = "🤖 AI 助手在本站已被禁用";
  title.style.cssText =
    "font-size:15px;font-weight:700;color:#1f2937;margin-bottom:8px;";
  const desc = document.createElement("div");
  desc.textContent = "该域名不在「显示的主机」配置中。你可以选择：";
  desc.style.cssText = "font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:16px;";
  const tempBtn = document.createElement("button");
  tempBtn.textContent = "临时显示（仅本次）";
  tempBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;margin-bottom:8px;border:none;border-radius:8px;" +
    "background:#7c3aed;color:#fff;font-size:13px;cursor:pointer;";
  const permBtn = document.createElement("button");
  permBtn.textContent = "永久开启（加入显示列表）";
  permBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;border:none;border-radius:8px;" +
    "background:#fff;color:#dc2626;font-size:13px;cursor:pointer;border:1px solid #fca5a5;";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:8px 0;margin-top:6px;border:none;background:none;" +
    "color:#9ca3af;font-size:12px;cursor:pointer;";
  const close = () => mask.remove();
  tempBtn.addEventListener("click", () => {
    close();
    initApp(); // 不修改配置，本次页面显示
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

// 脚本正常运行时的菜单弹窗：打开聊天窗 / 临时关闭 / 永久关闭（实时写入配置）
function showMainDialog() {
  if (document.querySelector(".scab-dlg")) return;
  const mask = document.createElement("div");
  mask.className = "scab-dlg";
  mask.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);" +
    "display:flex;align-items:center;justify-content:center;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;";
  const box = document.createElement("div");
  box.style.cssText =
    "width:340px;max-width:calc(100vw - 40px);background:#fff;border-radius:12px;" +
    "padding:22px;box-shadow:0 10px 40px rgba(0,0,0,.25);box-sizing:border-box;";
  const title = document.createElement("div");
  title.textContent = "🤖 AI 助手";
  title.style.cssText = "font-size:15px;font-weight:700;color:#1f2937;margin-bottom:8px;";
  const desc = document.createElement("div");
  desc.textContent = "该网站已加入「显示的主机」，可正常使用。你可以选择：";
  desc.style.cssText = "font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:16px;";
  const openBtn = document.createElement("button");
  openBtn.textContent = "打开聊天窗";
  openBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;margin-bottom:8px;border:none;border-radius:8px;" +
    "background:#7c3aed;color:#fff;font-size:13px;cursor:pointer;";
  const tmpBtn = document.createElement("button");
  tmpBtn.textContent = "临时关闭（刷新后恢复）";
  tmpBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;margin-bottom:8px;border:none;border-radius:8px;" +
    "background:#fff;color:#374151;font-size:13px;cursor:pointer;border:1px solid #d1d5db;";
  const permBtn = document.createElement("button");
  permBtn.textContent = "永久关闭（从显示列表移除）";
  permBtn.style.cssText =
    "display:block;width:100%;padding:9px 0;border:none;border-radius:8px;" +
    "background:#fff;color:#dc2626;font-size:13px;cursor:pointer;border:1px solid #fca5a5;";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText =
    "display:block;width:100%;padding:8px 0;margin-top:6px;border:none;background:none;" +
    "color:#9ca3af;font-size:12px;cursor:pointer;";
  const close = () => mask.remove();
  const hideBall = () => {
    if (SCA_UI && SCA_UI.ball) SCA_UI.ball.style.display = "none";
  };
  openBtn.addEventListener("click", () => {
    close();
    if (SCA_UI && SCA_UI.ball) {
      SCA_UI.ball.style.display = "";
      SCA_UI.win?.classList?.add("hidden");
    } else {
      alert("AI 助手尚未初始化，请刷新页面后重试。");
    }
  });
  tmpBtn.addEventListener("click", () => {
    close();
    hideBall();
  });
  permBtn.addEventListener("click", () => {
    close();
    removeHostFromShowList(); // 从显示列表移除，本站不再显示
    hideBall();
  });
  cancelBtn.addEventListener("click", close);
  mask.addEventListener("click", (e) => {
    if (e.target === mask) close();
  });
  box.append(title, desc, openBtn, tmpBtn, permBtn, cancelBtn);
  mask.appendChild(box);
  document.documentElement.appendChild(mask);
}

async function initApp() {
  // ============================================================
  // 0. 跨域缓存（GM 存储）：按站点隔离会话与聊天记录
  //    结构: { hosts: { [host]: { convId, messages, modelId } } }
  // ============================================================
  const LS_KEY = "sca.agent.chat.v2";

  // 旧版单会话缓存 → 多会话结构
  // 每条会话：{ key, id, title, messages, createdAt }
  function migrateHost(h) {
    if (!h) return { modelId: "", activeId: null, convs: [], win: null, ball: null };
    if (Array.isArray(h.convs)) {
      // 补 UI 位置字段（旧缓存可能没有）
      if (h.win === undefined) h.win = null;
      if (h.ball === undefined) h.ball = null;
      return h;
    }
    const hasMsg = (h.messages && h.messages.length) || h.convId;
    return {
      modelId: h.modelId || "",
      activeId: hasMsg ? "c_legacy" : null,
      convs: hasMsg
        ? [{ key: "c_legacy", id: h.convId || null, title: "", messages: h.messages || [], createdAt: Date.now() }]
        : [],
    };
  }

  function loadCache() {
    try {
      const raw = GM_getValue(LS_KEY, "");
      const data = raw ? JSON.parse(raw) : { hosts: {} };
      // 兼容 v1 全局结构 { convId, messages, modelId } → 迁移到当前站点
      if (data && !data.hosts && (data.convId || data.messages)) {
        data.hosts = { [location.host]: migrateHost(data) };
      }
      // 兼容 v2 单会话结构（host 下 { convId, messages, modelId }）→ 多会话
      if (data.hosts) {
        Object.keys(data.hosts).forEach((h) => {
          data.hosts[h] = migrateHost(data.hosts[h]);
        });
      }
      if (!data.hosts) data.hosts = {};
      return data;
    } catch {
      return { hosts: {} };
    }
  }
  function saveCache() {
    try {
      GM_setValue(LS_KEY, JSON.stringify(cache));
    } catch (e) {
      console.error("[SCA] 缓存保存失败:", e);
    }
  }
  const cache = loadCache();

  // 当前站点（host）的会话缓存：{ modelId, activeId, convs: [...] }
  function hostCache() {
    const host = location.host;
    if (!cache.hosts[host])
      cache.hosts[host] = { modelId: "", activeId: null, convs: [], win: null, ball: null };
    return cache.hosts[host];
  }
  const hc = hostCache();

  // 当前活动会话记录（按 key 匹配；activeId 存的是会话 key）
  function activeConvObj() {
    if (!hc.convs || !hc.convs.length) return null;
    return hc.convs.find((c) => c.key === hc.activeId) || null;
  }
  // 会话标题：未开始对话统一显示"新会话"；已对话优先自定义名/后台自动名，
  // 其次首条用户消息，兜底"新会话"
  function convTitle(c) {
    if (!c) return "新会话";
    if (!c.messages || !c.messages.length) return "新会话";
    if (c.customTitle && c.title) return c.title;
    if (c.title) return c.title;
    const u = c.messages.find((m) => m.role === "user");
    if (u) return String(u.content || "").slice(0, 18) + "…";
    return "新会话";
  }

  // ============================================================
  // 1. 查询已配置模型 + 会话工厂（工具沿用原 demo 的两个）
  // ============================================================
  // 页面快照：用户在发送消息的那一刻捕获，之后 AI 读取的一律是这份快照，
  // 即使切换到其它标签页，AI 也只会看到发起对话时的页面内容（锁定标签页）
  let pageSnapshot = null;

  const SYSTEM_PROMPT =
    "你是一个网页智能助手。你可以通过提供的工具【读取】和【操作】用户发起对话时的那个页面（不是其它标签页）。\n" +
    "读取页面信息时【必须】使用 get_page_info 工具，它会返回用户发起这条消息时页面内容的快照。\n" +
    "需要点击/填写/滚动/截图/执行脚本时，使用对应的 DOM 工具（click_element / fill_input / scroll_page / read_page_content / execute_script / take_screenshot 等）。\n" +
    "执行脚本优先用 ISOLATED 环境；调用页面 JS 函数才用 MAIN。\n" +
    "当需要询问用户意见、让用户做选择或输入信息时，【必须】使用 ask_user_local 工具（它是自定义的，会在聊天窗口弹出问题）。绝对不要使用内置的 ask_user 工具。\n" +
    "操作有风险的动作（如点击可能触发提交、导航）前，先向用户说明。回答请简洁。";

  // 发起对话时的标签页 ID（用于锁定 DOM 操作对象，避免切到其它标签页后操作错页面）
  let currentTabId = null;
  async function resolveCurrentTab() {
    if (currentTabId) return;
    try {
      const tabs = await CAT.agent.dom.listTabs();
      const t = tabs.find((x) => x.url === location.href) || tabs.find((x) => x.active);
      if (t) currentTabId = t.tabId;
    } catch (e) {
      console.warn("[SCA] 解析标签页失败，DOM 操作将作用于活动标签页:", e);
    }
  }

  // DOM 操作工具：全部指定 tabId，锁定在发起对话的标签页
  const DOM_TOOLS = [
    {
      name: "click_element",
      description: "点击页面中的元素。selector 为 CSS 选择器；trusted 设为 true 时发送真实鼠标事件（部分网站需要，默认 false）",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器，如 #submit、button[type=submit]" },
          trusted: { type: "boolean", description: "是否用真实鼠标事件" },
        },
        required: ["selector"],
      },
      handler: async (args) =>
        CAT.agent.dom.click(args.selector, { tabId: currentTabId, trusted: !!args.trusted }),
    },
    {
      name: "fill_input",
      description: "填写表单输入框。selector 为 CSS 选择器，value 为要填入的内容",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器，如 input[name=username]" },
          value: { type: "string", description: "要填入的内容" },
        },
        required: ["selector", "value"],
      },
      handler: async (args) =>
        CAT.agent.dom.fill(args.selector, args.value, { tabId: currentTabId }),
    },
    {
      name: "scroll_page",
      description: "滚动页面或指定容器。direction 取值 up / down / top / bottom",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
          selector: { type: "string", description: "可选，指定滚动容器选择器" },
        },
        required: ["direction"],
      },
      handler: async (args) =>
        CAT.agent.dom.scroll(args.direction, { tabId: currentTabId, selector: args.selector }),
    },
    {
      name: "wait_for_element",
      description: "等待某个元素出现。selector 为 CSS 选择器；timeout 为最长等待毫秒数（默认 10000）",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          timeout: { type: "number" },
        },
        required: ["selector"],
      },
      handler: async (args) =>
        CAT.agent.dom.waitFor(args.selector, { tabId: currentTabId, timeout: args.timeout }),
    },
    {
      name: "read_page_content",
      description: "读取页面转换后的文本内容（自动去掉 script/style 等）。selector 可选，只读取匹配元素区域；maxLength 可选限制长度",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "可选 CSS 选择器" },
          maxLength: { type: "number", description: "可选，限制返回字符数" },
        },
      },
      handler: async (args) =>
        CAT.agent.dom.readPage({ tabId: currentTabId, selector: args.selector, maxLength: args.maxLength }),
    },
    {
      name: "execute_script",
      description: "在页面执行一段 JavaScript 并返回结果。code 为 JS 代码（支持 return）；world 可选 MAIN 或 ISOLATED，默认 ISOLATED",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "要执行的 JS 代码，如 return document.querySelector('h1')?.textContent" },
          world: { type: "string", enum: ["MAIN", "ISOLATED"] },
        },
        required: ["code"],
      },
      handler: async (args) =>
        CAT.agent.dom.executeScript(args.code, { tabId: currentTabId, world: args.world || "ISOLATED" }),
    },
    {
      name: "take_screenshot",
      description: "截取页面截图。fullPage 设为 true 截整页；selector 可选只截该元素区域。返回 dataURL（可能被截断显示）",
      parameters: {
        type: "object",
        properties: {
          fullPage: { type: "boolean" },
          selector: { type: "string" },
        },
      },
      handler: async (args) => {
        const shot = await CAT.agent.dom.screenshot({
          tabId: currentTabId,
          fullPage: !!args.fullPage,
          selector: args.selector,
        });
        return {
          ok: !!shot.dataUrl,
          dataUrlPreview: shot.dataUrl ? shot.dataUrl.slice(0, 60) + "…" : "",
          size: shot.size || null,
          note: "dataURL 已截断，图片数据不会完整放入对话",
        };
      },
    },
  ];

  const TOOLS = [
    {
      name: "get_page_info",
      description:
        "获取用户发起对话时页面的快照信息（标题、URL 和选中的文本）。" +
        "这个快照在用户发送消息时捕获，不会随标签页切换而改变。",
      parameters: {
        type: "object",
        properties: {
          include_selection: { type: "boolean", description: "是否包含用户当时选中的文本" },
        },
      },
      handler: async (args) => {
        // 优先返回发送时捕获的快照，确保 AI 看到的是发起对话时的页面
        if (pageSnapshot) return pageSnapshot;
        // 没有快照（例如恢复的历史对话）时兜底读取当前页面
        const info = { title: document.title, url: location.href };
        if (args.include_selection) {
          info.selection = window.getSelection()?.toString() || "";
        }
        return info;
      },
    },
    {
      name: "count_words",
      description: "统计给定文本的字数（中文按字符计，英文按单词计）",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "要统计的文本" } },
        required: ["text"],
      },
      handler: async (args) => {
        const text = args.text || "";
        const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const en = (text.replace(/[\u4e00-\u9fa5]/g, " ").match(/\b\w+\b/g) || []).length;
        return { chinese: cn, english: en, total: cn + en };
      },
    },
    {
      // 自定义提问工具：取代内置 ask_user（扩展的内置弹窗在部分环境失效会卡死对话）。
      // 由脚本渲染聊天卡片等待用户回答，答案作为工具结果同步返回，时间线正确。
      name: "ask_user_local",
      description:
        "向用户提问并等待回答。当需要用户做决定、选择或输入信息时使用。" +
        "问题会显示在聊天窗口，用户点击选项或输入文字后返回其回答。",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "要问用户的问题" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "可选项（可选），用户可点击选择",
          },
        },
        required: ["question"],
      },
      handler: async (args) => {
        const answer = await askUserInteractive(args.question || "", args.options || []);
        return answer === null ? { answer: null, reason: "timeout" } : { answer };
      },
    },
    ...DOM_TOOLS,
  ];

  // 已配置的模型列表（API Key 不会暴露给脚本）
  let models = [];
  try {
    models = await CAT.agent.model.list();
  } catch (e) {
    console.warn("[SCA] 查询模型列表失败:", e);
  }
  const defaultModelId = await CAT.agent.model.getDefault().catch(() => null);

  async function createConv(modelId) {
    return CAT.agent.conversation.create({
      skills: "auto",             // 自动加载所有 Skill
      model: modelId || undefined,
      system: SYSTEM_PROMPT,
      maxIterations: 10,
      cache: true,
      tools: TOOLS,
    });
  }

  // 会话对象：页面加载时不创建/不恢复，延迟到首次发送时才处理
  let conv = null;

  // ============================================================
  // 2. 注入样式与 UI
  // ============================================================
  const uid = "sca";
  const style = document.createElement("style");
  style.textContent = `
/* === CSS 隔离重置：不受宿主页面样式影响，也不影响页面 === */
#${uid}-root {
  all: initial; display: block; box-sizing: border-box;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #1f2937; font-size: 14px; line-height: 1.5; text-align: left;
}
#${uid}-root *, #${uid}-root *::before, #${uid}-root *::after { box-sizing: border-box; }
/* 阻断宿主页面对内部元素的 transition/animation 污染（如页面 *{transition:height .3s}）
   我们自身需要的动画/过渡在下方用 !important 单独恢复 */
#${uid}-root *, #${uid}-root *::before, #${uid}-root *::after {
  transition: none !important;
  animation: none !important;
}
/* 控件基础尺寸重置：防页面 input/select/textarea/button 全局样式（如 height:40px）破坏布局
   用类前缀（specificity 低于 #sca-* 自身规则），确保我们自己的控件样式优先 */
.${uid}-root input, .${uid}-root select, .${uid}-root textarea, .${uid}-root button {
  height: auto; width: auto; min-width: 0; max-width: none;
}
.${uid}-root button, .${uid}-root input, .${uid}-root textarea, .${uid}-root select {
  font-family: inherit; font-size: inherit; color: inherit; line-height: inherit;
}
.${uid}-root a { color: inherit; text-decoration: inherit; }
#${uid}-ball {
  position: fixed; left: auto; top: auto; z-index: 2147483646;
  width: 52px; height: 52px; border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; font-weight: 700; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(99, 102, 241, .5);
  cursor: grab; user-select: none;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  transition: transform .15s ease !important;
}
#${uid}-ball:hover { transform: scale(1.08); }
#${uid}-ball.dragging { cursor: grabbing; transition: none !important; }
/* 球右上角关闭按钮 */
.${uid}-ball-close {
  position: absolute; top: -5px; right: -5px;
  width: 20px; height: 20px; border-radius: 50%; line-height: 20px;
  background: rgba(0, 0, 0, .55); color: #fff;
  font-size: 13px; text-align: center; cursor: pointer;
  display: none; z-index: 3; font-family: inherit;
}
#${uid}-ball:hover .${uid}-ball-close { display: block; }
.${uid}-ball-close:hover { background: rgba(220, 38, 38, .9); }
/* 关闭菜单遮罩 */
.${uid}-menu-mask {
  position: fixed; inset: 0; z-index: 2147483646;
  background: rgba(0, 0, 0, .25);
}
.${uid}-menu-mask.hidden { display: none; }
.${uid}-ball-menu {
  position: fixed; left: 50%; top: 42%; transform: translate(-50%, -50%);
  z-index: 2147483647; background: #fff; border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, .28); padding: 14px; width: 250px;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #333; font-size: 13px;
}
.${uid}-ball-menu-title { font-weight: 600; margin: 0 0 8px; font-size: 14px; }
.${uid}-ball-menu button {
  display: block; width: 100%; margin-top: 6px; padding: 8px 10px;
  border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;
  cursor: pointer; font-size: 13px; text-align: left; color: inherit;
}
.${uid}-ball-menu button:hover { background: #f3f4f6; }
.${uid}-ball-menu button[data-a="forever"] { border-color: #fca5a5; color: #b91c1c; }

#${uid}-window {
  position: fixed; left: auto; top: auto; z-index: 2147483646;
  width: 520px; height: 540px; max-height: calc(100vh - 40px);
  background: #fff; border-radius: 14px; overflow: hidden;
  display: flex; flex-direction: row;
  box-shadow: 0 8px 32px rgba(0, 0, 0, .18);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
#${uid}-window.hidden, #${uid}-ball.hidden { display: none !important; }

/* 左侧会话列表 */
#${uid}-sidebar {
  flex: none; width: 148px; display: flex; flex-direction: column;
  background: #f0f1f7; border-right: 1px solid #e2e4ee;
  min-height: 0;
}
#${uid}-new {
  margin: 8px; padding: 7px 0; border: 1px dashed #b6bad9; border-radius: 8px;
  background: #fff; color: #6366f1; font-size: 12px; cursor: pointer;
  flex: none;
}
#${uid}-new:hover { background: #eef2ff; border-color: #6366f1; }
#${uid}-conv-list {
  flex: 1; overflow-y: auto; padding: 0 6px 8px;
  display: flex; flex-direction: column; gap: 4px;
}
.${uid}-conv-item {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 8px; border-radius: 8px; cursor: pointer;
  font-size: 12px; color: #4b5563; line-height: 1.35;
  user-select: none; position: relative;
}
.${uid}-conv-item:hover { background: #e6e8f4; }
.${uid}-conv-item.active { background: #6366f1; color: #fff; font-weight: 600; }
.${uid}-conv-item .${uid}-conv-name {
  flex: 1; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
/* 编辑/删除按钮：悬浮于条目右侧，只做高亮，不参与布局也不位移 */
.${uid}-conv-actions {
  position: absolute; top: 50%; right: 4px;
  transform: translateY(-50%);
  display: flex; gap: 2px;
  opacity: 0;
}
.${uid}-conv-item:hover .${uid}-conv-name { padding-right: 40px; }
.${uid}-conv-item:hover .${uid}-conv-actions { opacity: 1; }
.${uid}-conv-actions button {
  border: none; background: transparent; color: inherit;
  font-size: 13px; line-height: 1; padding: 2px 5px; cursor: pointer;
  border-radius: 4px;
}
.${uid}-conv-actions button:hover { background: rgba(255, 255, 255, .25); }

/* 右侧主区域 */
#${uid}-main {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
}

#${uid}-header {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; font-size: 14px; font-weight: 600;
  cursor: grab; user-select: none;
}
#${uid}-header.dragging { cursor: grabbing; }
#${uid}-title { flex: 0 1 auto; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${uid}-model {
  flex: 1; min-width: 0;
  background: rgba(255, 255, 255, .18); color: #fff;
  border: none; border-radius: 6px; padding: 3px 6px;
  font-size: 12px; outline: none; cursor: pointer;
}
#${uid}-model option { color: #333; background: #fff; }
#${uid}-clear, #${uid}-min {
  border: none; background: rgba(255, 255, 255, .18); color: #fff;
  border-radius: 6px; cursor: pointer; padding: 3px 8px; font-size: 12px;
}
#${uid}-clear:hover, #${uid}-min:hover { background: rgba(255, 255, 255, .32); }

#${uid}-messages {
  flex: 1; overflow-y: auto; padding: 12px;
  background: #f5f6fa;
}
/* 空会话欢迎界面（类似各大 AI 厂商 web 端） */
.${uid}-welcome {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 14px; text-align: center; padding: 20px;
}
.${uid}-welcome-logo {
  width: 56px; height: 56px; border-radius: 16px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; font-size: 22px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 18px rgba(99, 102, 241, .35);
}
.${uid}-welcome-title { font-size: 18px; font-weight: 600; color: #1f2937; }
.${uid}-welcome-sub { font-size: 12px; color: #9ca3af; }
.${uid}-welcome-sugs {
  display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
  margin-top: 6px;
}
.${uid}-welcome-sug {
  border: 1px solid #e5e7eb; background: #fff; border-radius: 999px;
  padding: 6px 14px; font-size: 12px; color: #6b7280; cursor: pointer;
}
.${uid}-welcome-sug:hover { border-color: #6366f1; color: #6366f1; background: #eef2ff; }
.${uid}-msg {
  margin-bottom: 18px; display: flex; flex-direction: column;
  position: relative;
}
.${uid}-msg.user { align-items: flex-end; }
.${uid}-msg.assistant, .${uid}-msg.error { align-items: flex-start; }
.${uid}-actions {
  display: none; position: absolute; bottom: -16px;
  flex-direction: row; gap: 4px; z-index: 1;
}
.${uid}-msg.user .${uid}-actions { right: 0; }
.${uid}-msg.assistant .${uid}-actions, .${uid}-msg.error .${uid}-actions { left: 0; }
.${uid}-msg:hover .${uid}-actions { display: flex; }
.${uid}-actions button {
  border: 1px solid #d1d5db; background: #fff; color: #555;
  border-radius: 6px; font-size: 11px; padding: 2px 6px; cursor: pointer; white-space: nowrap;
}
.${uid}-actions button:hover { background: #f3f4f6; color: #111; }
@keyframes ${uid}-dot {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.3; }
  40% { transform: scale(1); opacity: 1; }
}
.${uid}-loading { display: inline-flex; gap: 5px; padding: 4px 2px; }
#${uid}-root .${uid}-loading i {
  width: 7px; height: 7px; border-radius: 50%; background: #9ca3af;
  display: inline-block; animation: ${uid}-dot 1.2s infinite ease-in-out both !important;
}
#${uid}-root .${uid}-loading i:nth-child(1) { animation-delay: 0s !important; }
#${uid}-root .${uid}-loading i:nth-child(2) { animation-delay: 0.1s !important; }
#${uid}-root .${uid}-loading i:nth-child(3) { animation-delay: 0.2s !important; }
#${uid}-root .${uid}-loading i:nth-child(4) { animation-delay: 0.3s !important; }
#${uid}-root .${uid}-loading i:nth-child(5) { animation-delay: 0.4s !important; }
#${uid}-root .${uid}-loading i:nth-child(6) { animation-delay: 0.5s !important; }
.${uid}-meta { font-size: 10px; color: #9ca3af; margin-top: 3px; padding: 0 4px; }
.${uid}-meta.generating { color: #6366f1; }
/* 工具调用标识卡片 */
.${uid}-tool {
  align-self: flex-start; display: flex; flex-direction: column; gap: 2px;
  max-width: 90%; margin: 0 0 12px;
  background: #eef2ff; border: 1px solid #e0e7ff; border-radius: 8px;
  padding: 6px 10px; font-size: 12px; color: #4338ca;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.${uid}-tool .${uid}-tool-name { font-weight: 600; }
.${uid}-tool .${uid}-tool-args {
  color: #6b7280; font-size: 11px; word-break: break-all;
  font-family: "Cascadia Code", Consolas, monospace;
  max-height: 60px; overflow: hidden;
}
/* 工具卡片头部：箭头展开/收起 */
.${uid}-tool-head {
  display: flex; align-items: center; gap: 5px; cursor: pointer;
  user-select: none;
}
.${uid}-tool-arrow {
  display: inline-block; font-size: 10px; line-height: 1;
  transition: transform 0.15s; color: #818cf8;
}
.${uid}-tool.expanded .${uid}-tool-arrow { transform: rotate(90deg); }
.${uid}-tool-args-wrap {
  display: none; margin-top: 4px; padding-top: 4px;
  border-top: 1px dashed #c7d2fe;
}
.${uid}-tool.expanded .${uid}-tool-args-wrap { display: block; }
.${uid}-tool-args-wrap .${uid}-tool-args { max-height: 140px; overflow: auto; white-space: pre-wrap; }
/* ask_user 交互卡片（AI 主动提问） */
.${uid}-ask {
  align-self: flex-start; display: flex; flex-direction: column; gap: 6px;
  max-width: 92%; margin: 0 0 12px; padding: 10px 12px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
  font-size: 13px; color: #92400e;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.${uid}-ask-title { font-weight: 700; color: #b45309; }
.${uid}-ask-question { line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.${uid}-ask-answer { margin-top: 6px; font-weight: 600; color: #92400e; word-break: break-word; }
.${uid}-ask-opts { display: flex; flex-direction: column; gap: 6px; }
.${uid}-ask-opt {
  text-align: left; background: #fff; border: 1px solid #fcd34d;
  border-radius: 8px; padding: 7px 10px; font-size: 12px; color: #78350f;
  cursor: pointer; transition: background 0.15s;
}
.${uid}-ask-opt:hover { background: #fef3c7; }
.${uid}-ask-input-row { display: flex; gap: 6px; }
.${uid}-ask-input {
  flex: 1; padding: 7px 10px; border: 1px solid #fcd34d; border-radius: 8px;
  font-size: 12px; outline: none; background: #fff; color: #78350f;
}
.${uid}-ask-input:focus { border-color: #f59e0b; }
.${uid}-ask-send {
  padding: 7px 14px; border: none; border-radius: 8px; background: #f59e0b;
  color: #fff; font-size: 12px; cursor: pointer;
}
.${uid}-ask-send:hover { background: #d97706; }
.${uid}-ask-tip { font-size: 11px; color: #b45309; opacity: 0.85; line-height: 1.4; }
.${uid}-ask.answered { opacity: 0.9; }
.${uid}-bubble h1, .${uid}-bubble h2, .${uid}-bubble h3 { margin: 6px 0 4px; line-height: 1.4; }
.${uid}-bubble h1 { font-size: 16px; }
.${uid}-bubble h2 { font-size: 15px; }
.${uid}-bubble h3 { font-size: 14px; }
.${uid}-bubble ul, .${uid}-bubble ol { margin: 4px 0; padding-left: 18px; }
.${uid}-bubble li { margin: 2px 0; }
.${uid}-bubble strong { font-weight: 600; }
.${uid}-bubble a { color: #6366f1; text-decoration: underline; }
.${uid}-bubble pre.${uid}-code {
  background: rgba(0,0,0,.06); padding: 8px 10px; border-radius: 6px;
  overflow-x: auto; margin: 6px 0; font-size: 12px; line-height: 1.4;
}
.${uid}-bubble .${uid}-ic {
  background: rgba(0,0,0,.06); padding: 1px 4px; border-radius: 3px; font-size: 12px;
  font-family: "Cascadia Code", "Consolas", monospace;
}
.${uid}-bubble.user pre.${uid}-code, .${uid}-bubble.user .${uid}-ic { background: rgba(255,255,255,.2); }
.${uid}-bubble.user a { color: #fff; }
.${uid}-bubble {
  max-width: 85%; padding: 8px 12px; border-radius: 12px;
  font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
}
.${uid}-msg.user .${uid}-bubble {
  background: #6366f1; color: #fff; border-bottom-right-radius: 4px;
}
.${uid}-msg.assistant .${uid}-bubble {
  background: #fff; color: #333; border: 1px solid #e5e7eb;
  border-bottom-left-radius: 4px;
}
.${uid}-msg.error .${uid}-bubble { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }

#${uid}-input-bar {
  flex: none; position: relative;
  padding: 10px; border-top: 1px solid #eee; background: #fff;
}
#${uid}-input {
  display: block; width: 100%; resize: none;
  border: 1px solid #d1d5db; border-radius: 8px;
  padding: 10px 58px 10px 12px; font-size: 14px; line-height: 1.5; outline: none;
  min-height: 48px; max-height: 240px; font-family: inherit; overflow-y: auto;
}
#${uid}-input:focus { border-color: #6366f1; }
#${uid}-send {
  position: absolute; right: 14px; bottom: 16px;
  border: none; border-radius: 16px; padding: 0 14px; height: 32px;
  background: #6366f1; color: #fff; font-size: 13px; cursor: pointer;
}
#${uid}-send:hover { background: #4f46e5; }
#${uid}-send:disabled { opacity: .5; cursor: not-allowed; }

/* AI 工作状态栏：显示在输入框上方 */
#${uid}-status {
  display: none; align-items: center; gap: 4px;
  padding: 4px 12px; font-size: 12px; color: #6366f1;
  background: #eef2ff; border-top: 1px solid #e0e7ff;
}
#${uid}-status.show { display: flex; }
#${uid}-status .${uid}-status-dot {
  width: 4px; height: 4px; border-radius: 50%; background: #6366f1;
  animation: ${uid}-blink 1.2s infinite !important;
}
#${uid}-status .${uid}-status-dot:nth-child(3) { animation-delay: 0.15s !important; }
#${uid}-status .${uid}-status-dot:nth-child(4) { animation-delay: 0.3s !important; }
@keyframes ${uid}-blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }

/* 四角 + 四边缩放手柄 */
.${uid}-rs {
  position: absolute; width: 14px; height: 14px; z-index: 3;
}
.${uid}-rs[data-dir="nw"] { left: 0; top: 0; cursor: nwse-resize; }
.${uid}-rs[data-dir="ne"] { right: 0; top: 0; cursor: nesw-resize; }
.${uid}-rs[data-dir="sw"] { left: 0; bottom: 0; cursor: nesw-resize; }
.${uid}-rs[data-dir="se"] { right: 0; bottom: 0; cursor: nwse-resize; }
.${uid}-rs[data-dir="n"] { top: 0; left: 50%; transform: translateX(-50%); width: 36px; height: 8px; cursor: ns-resize; }
.${uid}-rs[data-dir="s"] { bottom: 0; left: 50%; transform: translateX(-50%); width: 36px; height: 8px; cursor: ns-resize; }
.${uid}-rs[data-dir="w"] { left: 0; top: 50%; transform: translateY(-50%); width: 8px; height: 36px; cursor: ew-resize; }
.${uid}-rs[data-dir="e"] { right: 0; top: 50%; transform: translateY(-50%); width: 8px; height: 36px; cursor: ew-resize; }
.${uid}-rs[data-dir="se"]::after {
  content: ""; position: absolute; right: 3px; bottom: 3px;
  width: 6px; height: 6px;
  border-right: 2px solid #c4c7d5; border-bottom: 2px solid #c4c7d5;
  border-radius: 0 0 3px 0;
}

/* Markdown 增强样式 */
.${uid}-bubble table { border-collapse: collapse; margin: 6px 0; font-size: 12px; width: 100%; }
.${uid}-bubble th, .${uid}-bubble td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; }
.${uid}-bubble th { background: rgba(0,0,0,.04); font-weight: 600; }
.${uid}-bubble blockquote {
  margin: 6px 0; padding: 2px 10px; border-left: 3px solid #c7c9d4;
  color: #6b7280; background: rgba(0,0,0,.02); border-radius: 0 6px 6px 0;
}
.${uid}-bubble hr { border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }
.${uid}-bubble del { color: #9ca3af; }
.${uid}-bubble ol { margin: 4px 0; padding-left: 18px; }
`;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = `${uid}-root`;
  root.className = `${uid}-root`;
  root.innerHTML = `
    <div id="${uid}-ball" title="打开 AI 助手">AI<span class="${uid}-ball-close" title="关闭悬浮聊天窗">×</span></div>
    <div id="${uid}-window" class="hidden">
      <div id="${uid}-sidebar">
        <button id="${uid}-new" title="新建会话">＋ 新会话</button>
        <div id="${uid}-conv-list"></div>
      </div>
      <div id="${uid}-main">
        <div id="${uid}-header">
          <span id="${uid}-title">AI 助手</span>
          <select id="${uid}-model" title="切换模型"></select>
          <button id="${uid}-clear">清空</button>
          <button id="${uid}-min">—</button>
        </div>
        <div id="${uid}-messages"></div>
        <div id="${uid}-status">
          <span id="${uid}-status-text">回答中</span>
          <span class="${uid}-status-dot"></span>
          <span class="${uid}-status-dot"></span>
          <span class="${uid}-status-dot"></span>
        </div>
        <div id="${uid}-input-bar">
          <textarea id="${uid}-input" placeholder="输入消息，Enter 发送"></textarea>
          <button id="${uid}-send">发送</button>
        </div>
      </div>
      <div class="${uid}-rs" data-dir="nw"></div>
      <div class="${uid}-rs" data-dir="ne"></div>
      <div class="${uid}-rs" data-dir="sw"></div>
      <div class="${uid}-rs" data-dir="se"></div>
      <div class="${uid}-rs" data-dir="n"></div>
      <div class="${uid}-rs" data-dir="s"></div>
      <div class="${uid}-rs" data-dir="w"></div>
      <div class="${uid}-rs" data-dir="e"></div>
    </div>`;
  document.body.appendChild(root);

  const ball = root.querySelector(`#${uid}-ball`);
  const win = root.querySelector(`#${uid}-window`);
  // 暴露给菜单命令弹窗，用于打开/隐藏悬浮球
  SCA_UI = { ball, win };

  // 恢复本站点保存的窗口/球位置与大小（每站独立，刷新不重置；越界自动钳制回视口）
  if (hc.win && hc.win.w > 0 && hc.win.h > 0) {
    const w = Math.min(hc.win.w, window.innerWidth - 10);
    const h = Math.min(hc.win.h, window.innerHeight - 10);
    const x = Math.max(0, Math.min(hc.win.x, window.innerWidth - w));
    const y = Math.max(0, Math.min(hc.win.y, window.innerHeight - h));
    win.style.left = x + "px";
    win.style.top = y + "px";
    win.style.right = "auto";
    win.style.bottom = "auto";
    win.style.width = w + "px";
    win.style.height = h + "px";
  }
  // 忽略损坏缓存（0 值），避免球被恢复到左上角
  if (hc.ball && (hc.ball.x !== 0 || hc.ball.y !== 0)) {
    const bx = Math.max(0, Math.min(hc.ball.x, window.innerWidth - 60));
    const by = Math.max(0, Math.min(hc.ball.y, window.innerHeight - 60));
    ball.style.left = bx + "px";
    ball.style.top = by + "px";
    ball.style.right = "auto";
    ball.style.bottom = "auto";
  }

  const msgBox = root.querySelector(`#${uid}-messages`);
  const input = root.querySelector(`#${uid}-input`);
  const sendBtn = root.querySelector(`#${uid}-send`);
  const clearBtn = root.querySelector(`#${uid}-clear`);
  const minBtn = root.querySelector(`#${uid}-min`);
  const modelSel = root.querySelector(`#${uid}-model`);
  const rsHandles = root.querySelectorAll(`.${uid}-rs`);
  const statusBar = root.querySelector(`#${uid}-status`);
  const statusText = root.querySelector(`#${uid}-status-text`);
  const convList = root.querySelector(`#${uid}-conv-list`);
  const newBtn = root.querySelector(`#${uid}-new`);
  let sending = false;

  // AI 工作状态栏控制
  const setStatus = (text) => {
    statusText.textContent = text;
    statusBar.classList.add("show");
  };
  const hideStatus = () => statusBar.classList.remove("show");

  // ---------- 会话列表（多会话） ----------
  function renderConvList() {
    convList.innerHTML = "";
    if (!hc.convs.length) {
      const empty = document.createElement("div");
      empty.textContent = "暂无会话";
      empty.style.cssText = "color:#9ca3af;font-size:11px;text-align:center;padding:12px 0;";
      convList.appendChild(empty);
      return;
    }
    hc.convs.forEach((c) => {
      const item = document.createElement("div");
      item.className = `${uid}-conv-item`;
      if (c.key === hc.activeId) item.classList.add("active");
      const name = document.createElement("span");
      name.className = `${uid}-conv-name`;
      name.textContent = convTitle(c);
      name.title = name.textContent;
      // 双击名称进入重命名
      name.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        renameConv(c);
      });
      item.appendChild(name);
      const actions = document.createElement("div");
      actions.className = `${uid}-conv-actions`;
      const edit = document.createElement("button");
      edit.textContent = "✎";
      edit.title = "重命名会话";
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        renameConv(c);
      });
      const del = document.createElement("button");
      del.textContent = "×";
      del.title = "删除会话";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteConv(c.key);
      });
      actions.append(edit, del);
      item.appendChild(actions);
      item.addEventListener("click", () => switchConv(c.key));
      convList.appendChild(item);
    });
  }

  // 重命名会话：弹窗询问。后台 title 只读（扩展自动生成），无法写回，
  // 因此用户命名存本地并标记 customTitle，显示时优先本地名，避免被后台自动名覆盖
  function renameConv(c) {
    if (sending) return;
    const cur = c.customTitle ? c.title : convTitle(c);
    const v = prompt("重命名会话：", cur || "");
    if (v === null) return; // 取消
    const t = v.trim();
    if (t) {
      c.title = t;
      c.customTitle = true;
    } else {
      // 清空自定义名 → 回退后台自动名/首条消息自动命名
      delete c.customTitle;
      c.title = "";
    }
    saveCache();
    renderConvList();
  }

  // 渲染当前活动会话的消息记录；空会话显示欢迎界面（类似各大 AI 厂商 web 端）
  function renderMessages() {
    msgBox.innerHTML = "";
    const act = activeConvObj();
    if (!act || !act.messages.length) {
      showWelcome();
      return;
    }
    act.messages.forEach((m) => {
      if (m.role === "tool") {
        if (m.ask) appendAskUserCard(m.question, m.options, true, null, m.answer);
        else appendToolCall(m.name, m.args, BUILTIN_TOOLS.has(m.name));
      } else {
        appendMsg(m.role, m.content, false, { time: m.time, duration: m.duration });
      }
    });
  }

  // 空会话欢迎界面：居中 logo + 文案 + 快捷提示，点击提示直接填入并发送
  function showWelcome() {
    const w = document.createElement("div");
    w.className = `${uid}-welcome`;
    const logo = document.createElement("div");
    logo.className = `${uid}-welcome-logo`;
    logo.textContent = "AI";
    const title = document.createElement("div");
    title.className = `${uid}-welcome-title`;
    title.textContent = "我能帮你什么？";
    const sub = document.createElement("div");
    sub.className = `${uid}-welcome-sub`;
    sub.textContent = "页面问答 · 翻译 · 网页操作";
    const sugs = document.createElement("div");
    sugs.className = `${uid}-welcome-sugs`;
    ["总结当前页面", "翻译选中文本", "帮我操作页面上的元素"].forEach((t) => {
      const b = document.createElement("button");
      b.className = `${uid}-welcome-sug`;
      b.textContent = t;
      b.addEventListener("click", () => {
        input.value = t;
        send();
      });
      sugs.appendChild(b);
    });
    w.append(logo, title, sub, sugs);
    msgBox.appendChild(w);
  }

  // 切换会话：保存当前后端会话 → 恢复目标会话 → 渲染界面
  async function switchConv(key) {
    if (key === hc.activeId) return;
    if (sending) return;
    if (conv) {
      try { await conv.save(); } catch (e) { console.warn("[SCA] 保存会话失败:", e); }
    }
    conv = null;
    hc.activeId = key;
    saveCache();
    const act = activeConvObj();
    if (act && act.id) {
      try {
        conv = await CAT.agent.conversation.get(act.id);
        if (conv) {
          // 后台 title 只读：仅在用户未自定义命名时同步
          if (!act.customTitle && conv.title) act.title = conv.title;
          console.log(`[SCA] 切换会话: ${conv.id}（模型: ${conv.modelId}）`);
        }
      } catch (e) {
        console.warn("[SCA] 恢复会话失败:", e);
      }
    }
    // 同步模型下拉框
    if (conv && conv.modelId) {
      fillModelOptions(conv.modelId);
    } else if (hc.modelId) {
      fillModelOptions(hc.modelId);
    }
    renderConvList();
    renderMessages();
    requestAnimationFrame(() => scrollBottom());
  }

  // 新建会话：当前已是空会话时点击无效；存在其它空会话则跳转过去，
  // 否则才真正新建（避免堆积大量空会话）
  function newConv() {
    if (sending) return;
    const cur = activeConvObj();
    if (cur && !cur.messages.length) return; // 当前就是未开始对话的空会话
    const empty = hc.convs.find((x) => x.key !== hc.activeId && !x.messages.length);
    if (empty) {
      switchConv(empty.key);
      return;
    }
    const key = "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    hc.convs.push({ key, id: null, title: "", messages: [], createdAt: Date.now() });
    hc.activeId = key;
    saveCache();
    if (conv) { conv = null; } // 新会话对象延迟到首次发送
    renderConvList();
    renderMessages();
    input.focus();
  }

  // 删除会话（含后端会话，如已创建）
  async function deleteConv(key) {
    if (sending) return;
    const c = hc.convs.find((x) => x.key === key);
    if (!c) return;
    if (!confirm(`确定删除会话「${convTitle(c)}」？该操作不可恢复。`)) return;
    if (c.id) {
      try { await CAT.agent.conversation.get(c.id).then((cv) => cv && cv.clear()); } catch (e) { console.warn("[SCA] 删除后端会话失败:", e); }
    }
    hc.convs = hc.convs.filter((x) => x.key !== key);
    if (hc.activeId === key) {
      conv = null;
      hc.activeId = hc.convs.length ? hc.convs[hc.convs.length - 1].key : null;
      if (hc.activeId) {
        const act = activeConvObj();
        if (act && act.id) {
          try { conv = await CAT.agent.conversation.get(act.id); } catch (e) { console.warn("[SCA] 恢复会话失败:", e); }
        }
      }
    }
    saveCache();
    renderConvList();
    renderMessages();
  }

  newBtn.addEventListener("click", newConv);

  // 填充模型下拉框，当前会话模型不在列表里也保留一项
  function fillModelOptions(selectedId) {
    modelSel.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      modelSel.appendChild(opt);
    });
    if (!models.some((m) => m.id === selectedId)) {
      const opt = document.createElement("option");
      opt.value = selectedId || "";
      opt.textContent = selectedId || "默认模型";
      modelSel.appendChild(opt);
    }
    modelSel.value = selectedId || (models.length ? models[0].id : "");
  }
  fillModelOptions(hc.modelId || defaultModelId || "");

  // ============================================================
  // Markdown 渲染：优先使用 CDN 加载的 marked 组件，失败回退手写渲染
  // （MARKED_CDNS 必须先于 loadMarked() 初始化，否则触发 TDZ 错误）
  // ============================================================
  const MARKED_CDNS = [
    "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
    "https://unpkg.com/marked@12.0.2/marked.min.js",
    "https://fastly.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
  ];

  // 后台预加载 marked（不阻塞初始化）
  loadMarked().then((ok) => {
    if (ok) console.log("[SCA] marked 渲染组件已加载");
    else console.warn("[SCA] marked CDN 加载失败，使用内置渲染");
  });

  // ============================================================
  // 3. 渲染与交互
  // ============================================================
  function scrollBottom() {
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  function makeBtn(label, onClick) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", () => onClick(btn));
    return btn;
  }

  function flash(btn, label) {
    const old = btn.textContent;
    btn.textContent = label;
    setTimeout(() => (btn.textContent = old), 900);
  }

  async function copyText(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 旧浏览器降级方案
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  function loadingHtml() {
    return `<span class="${uid}-loading"><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
  }

  // ============================================================
  // Markdown 渲染（loadMarked）
  // ============================================================
  // 动态加载 marked（异步，不阻塞脚本初始化）
  function loadMarked() {
    return new Promise((resolve) => {
      if (window.marked && typeof window.marked.parse === "function") return resolve(true);
      let i = 0;
      const tryLoad = () => {
        if (i >= MARKED_CDNS.length) return resolve(false);
        const s = document.createElement("script");
        s.src = MARKED_CDNS[i++];
        s.onload = () => resolve(!!(window.marked && typeof window.marked.parse === "function"));
        s.onerror = tryLoad;
        document.head.appendChild(s);
      };
      tryLoad();
    });
  }

  // 对 marked 输出的 HTML 做消毒，防 XSS
  function sanitizeHtml(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    d.querySelectorAll("script, style, iframe, object, embed, form, link, meta").forEach((el) => el.remove());
    const clean = (el) => {
      [...el.attributes].forEach((a) => {
        if (a.name.toLowerCase().startsWith("on")) el.removeAttribute(a.name);
      });
      if (el.tagName === "A") {
        const href = (el.getAttribute("href") || "").trim().toLowerCase();
        if (!/^(https?:|mailto:|tel:)/.test(href)) el.removeAttribute("href");
      }
      if (el.tagName === "IMG") {
        const src = (el.getAttribute("src") || "").trim().toLowerCase();
        if (!/^(https?:|data:image\/)/.test(src)) el.removeAttribute("src");
      }
      el.querySelectorAll("*").forEach(clean);
    };
    clean(d);
    return d.innerHTML;
  }

  // 轻量 Markdown 渲染：优先 marked（CDN），未就绪时用内置手写实现兜底
  function renderMarkdown(text) {
    if (!text) return "";
    if (window.marked && typeof window.marked.parse === "function") {
      try {
        const html = window.marked.parse(text, { gfm: true, breaks: true });
        return sanitizeHtml(html);
      } catch (e) {
        console.warn("[SCA] marked 渲染失败，回退内置渲染:", e);
      }
    }
    return renderMarkdownFallback(text);
  }

  // 内置手写渲染（备用）
  function renderMarkdownFallback(text) {
    if (!text) return "";
    let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // 提取代码块保护起来，避免被后续规则破坏
    const codeBlocks = [];
    s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push(code.replace(/\n$/, ""));
      return `\x00CB${codeBlocks.length - 1}\x00`;
    });
    // 提取行内代码
    const inlineCodes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, code) => {
      inlineCodes.push(code);
      return `\x00IC${inlineCodes.length - 1}\x00`;
    });
    // 表格：| a | b | / | --- | --- | / | 1 | 2 |
    s = s.replace(/(^\|.*\|[ \t]*\n?)+/gm, (block) => {
      const lines = block.trim().split("\n").filter(Boolean);
      if (lines.length < 2) return block;
      const cells = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      let header = null, bodyLines = lines;
      if (/^\|?[\s:|-]+\|?$/.test(lines[1]) && lines[1].includes("-")) {
        header = cells(lines[0]);
        bodyLines = lines.slice(2);
      }
      const rowsHtml = (rows) =>
        rows.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
      let html = "<table>";
      if (header) html += `<thead><tr>${header.map((c) => `<th>${c}</th>`).join("")}</tr></thead>`;
      html += `<tbody>${rowsHtml(bodyLines)}</tbody></table>`;
      return html;
    });
    // 无序列表：连续行分组
    s = s.replace(/((?:^[-*] .*\n?)+)/gm, (block) => {
      const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("");
      return `<ul>${items}</ul>`;
    });
    // 有序列表：连续行分组
    s = s.replace(/((?:^\d+\.\s+.*\n?)+)/gm, (block) => {
      const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\.\s+/, "")}</li>`).join("");
      return `<ol>${items}</ol>`;
    });
    // 块引用（> 已被转义为 &gt;）
    s = s.replace(/((?:^&gt;.*\n?)+)/gm, (block) => {
      const inner = block.trim().split("\n").map((l) => l.replace(/^&gt;\s?/, "")).join("<br>");
      return `<blockquote>${inner}</blockquote>`;
    });
    // 水平线
    s = s.replace(/^---\s*$/gm, "<hr>");
    // 标题
    s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>")
         .replace(/^## (.+)$/gm, "<h2>$1</h2>")
         .replace(/^# (.+)$/gm, "<h1>$1</h1>");
    // 粗体、斜体、删除线、链接
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
         .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
         .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
         .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // 换行
    s = s.replace(/\n/g, "<br>");
    // 清理块级元素周围的多余 <br>
    s = s.replace(/<br>(<\/?(?:ul|ol|li|h[1-3]|blockquote|table|thead|tbody|tr|td|th|hr))/g, "$1")
         .replace(/(<\/(?:ul|ol|li|h[1-3]|blockquote|table|thead|tbody|tr|td|th|hr)>)<br>/g, "$1")
         .replace(/<br>(\x00CB)/g, "$1")
         .replace(/(\x00CB\d+\x00)<br>/g, "$1");
    // 还原代码块和行内代码
    s = s.replace(/\x00CB(\d+)\x00/g, (_, i) =>
      `<pre class="${uid}-code"><code>${codeBlocks[+i]}</code></pre>`);
    s = s.replace(/\x00IC(\d+)\x00/g, (_, i) =>
      `<code class="${uid}-ic">${inlineCodes[+i]}</code>`);
    return s;
  }

  function appendMsg(role, text, isError, opts = {}) {
    const row = document.createElement("div");
    row.className = `${uid}-msg ${role}${isError ? " error" : ""}`;

    // 悬浮操作按钮：复制（所有消息）+ 重发（仅用户消息）
    const actions = document.createElement("div");
    actions.className = `${uid}-actions`;
    const copyBtn = makeBtn("复制", async (btn) => {
      await copyText(text || "");
      flash(btn, "已复制");
    });
    actions.appendChild(copyBtn);
    if (role === "user") {
      const retryBtn = makeBtn("重发", () => sendText(text));
      actions.appendChild(retryBtn);
    }

    const bubble = document.createElement("div");
    bubble.className = `${uid}-bubble`;
    if (opts.loading) {
      bubble.innerHTML = loadingHtml();
    } else if (role === "assistant") {
      bubble.innerHTML = renderMarkdown(text || "");
    } else {
      bubble.textContent = text || "";
    }

    // 时间 + 耗时标签
    const meta = document.createElement("div");
    meta.className = `${uid}-meta`;
    const ts = opts.time || Date.now();
    let metaText = formatTime(ts);
    if (opts.duration != null) metaText += ` · ${formatDuration(opts.duration)}`;
    meta.textContent = metaText;

    row.append(actions, bubble, meta);
    msgBox.appendChild(row);
    scrollBottom();
    return { bubble, meta };
  }

  // 扩展内置工具名列表（用于卡片标记"内置"，ask_user 走交互卡片）
  const BUILTIN_TOOLS = new Set([
    "web_fetch", "web_search", "get_tab_content", "list_tabs", "open_tab",
    "close_tab", "activate_tab", "opfs_write", "opfs_read", "opfs_list",
    "opfs_delete", "ask_user", "execute_script", "agent", "create_task",
    "get_task", "update_task", "list_tasks", "delete_task",
  ]);
  let askingUser = false;   // AI 是否正在等待用户回答（ask_user）
  let pendingAnswer = null; // 用户在 ask_user 卡片上的回答（流结束后自动投递）

  // 工具调用标识行：头部可点击展开/收起，展开才显示参数详情
  function appendToolCall(name, argsText, isBuiltin) {
    const row = document.createElement("div");
    row.className = `${uid}-tool`;
    const head = document.createElement("div");
    head.className = `${uid}-tool-head`;
    head.title = "点击展开/收起参数详情";
    const arrow = document.createElement("span");
    arrow.className = `${uid}-tool-arrow`;
    arrow.textContent = "▶";
    const nameEl = document.createElement("span");
    nameEl.className = `${uid}-tool-name`;
    nameEl.textContent = isBuiltin
      ? `内置工具：${name}`
      : `自定义工具：${name}`;
    head.append(arrow, nameEl);
    row.appendChild(head);
    const wrap = document.createElement("div");
    wrap.className = `${uid}-tool-args-wrap`;
    const argsEl = document.createElement("div");
    argsEl.className = `${uid}-tool-args`;
    argsEl.textContent = (argsText && argsText.trim())
      ? argsText
      : "（无参数）";
    wrap.appendChild(argsEl);
    row.appendChild(wrap);
    head.addEventListener("click", () => row.classList.toggle("expanded"));
    msgBox.appendChild(row);
    scrollBottom();
    return row;
  }

  // ask_user 交互卡片：问题 + 选项按钮 + 自由输入。
  // onAnswer 为可选回调：自定义工具 ask_user_local 用它同步返回答案；内置 ask_user 兜底时为空（走 pendingAnswer 延迟投递）
  // answer 为已保存的回答（历史记录渲染时传入），显示在问题下方
  function appendAskUserCard(question, options, readonly, onAnswer, answer) {
    const card = document.createElement("div");
    card.className = `${uid}-ask`;
    const title = document.createElement("div");
    title.className = `${uid}-ask-title`;
    title.textContent = readonly ? "💬 AI 向你提问（历史记录）" : "💬 AI 在等你回答";
    card.appendChild(title);
    if (question) {
      const q = document.createElement("div");
      q.className = `${uid}-ask-question`;
      q.textContent = question;
      card.appendChild(q);
    }
    // 回答统一显示在问题下方，避免与标题错位
    if (answer) {
      const a = document.createElement("div");
      a.className = `${uid}-ask-answer`;
      a.textContent = `💬 你的回答：${answer}`;
      card.appendChild(a);
    }
    if (readonly) {
      const tip = document.createElement("div");
      tip.className = `${uid}-ask-tip`;
      tip.textContent = "（此问题已回答，仅作记录）";
      card.appendChild(tip);
      card.classList.add("answered");
      msgBox.appendChild(card);
      scrollBottom();
      return card;
    }
    if (options && options.length) {
      const optsWrap = document.createElement("div");
      optsWrap.className = `${uid}-ask-opts`;
      options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.className = `${uid}-ask-opt`;
        btn.textContent = opt;
        btn.addEventListener("click", () => answerAsk(opt, card, onAnswer));
        optsWrap.appendChild(btn);
      });
      card.appendChild(optsWrap);
    }
    const inputRow = document.createElement("div");
    inputRow.className = `${uid}-ask-input-row`;
    const inp = document.createElement("input");
    inp.className = `${uid}-ask-input`;
    inp.placeholder = "或在此输入你的回答…";
    const send = document.createElement("button");
    send.className = `${uid}-ask-send`;
    send.textContent = "回答";
    const submit = () => {
      const v = inp.value.trim();
      if (v) answerAsk(v, card, onAnswer);
    };
    send.addEventListener("click", submit);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    inputRow.append(inp, send);
    card.appendChild(inputRow);
    const tip = document.createElement("div");
    tip.className = `${uid}-ask-tip`;
    tip.textContent = onAnswer
      ? "回答后 AI 会立即收到你的选择。"
      : "若扩展询问弹窗未出现，可直接在此回答，AI 会在本轮结束后收到你的答案。";
    card.appendChild(tip);
    msgBox.appendChild(card);
    scrollBottom();
    // 长时间无响应提示
    setTimeout(() => {
      if (card.isConnected && !card.classList.contains("answered")) {
        tip.textContent = "长时间无响应。请选择或输入答案；若仍卡住可刷新页面重试。";
      }
    }, 90000);
    return card;
  }

  // 自定义工具 ask_user_local 使用的提问函数：渲染卡片并等待用户回答（Promise）
  function askUserInteractive(question, options) {
    return new Promise((resolve) => {
      let answered = false;
      const card = appendAskUserCard(question, options, false, (ans) => {
        answered = true;
        resolve(ans);
      });
      // 与内置 ask_user 一致：5 分钟未回答视为超时
      setTimeout(() => {
        if (!answered && card.isConnected) {
          card.classList.add("answered");
          const t = card.querySelector(`.${uid}-ask-title`);
          if (t) t.textContent = "💬 等待超时（5 分钟未回答）";
          resolve(null);
        }
      }, 5 * 60 * 1000);
    });
  }

  // 提交 ask_user 的答案
  function answerAsk(answer, card, onAnswer) {
    card.classList.add("answered");
    // 回答追加在问题下方（标题与问题保持在顶部，顺序自然）
    const t = card.querySelector(`.${uid}-ask-title`);
    if (t) t.textContent = "💬 AI 向你提问";
    card.querySelector(`.${uid}-ask-opts`)?.remove();
    card.querySelector(`.${uid}-ask-input-row`)?.remove();
    card.querySelector(`.${uid}-ask-tip`)?.remove();
    if (!card.querySelector(`.${uid}-ask-answer`)) {
      const a = document.createElement("div");
      a.className = `${uid}-ask-answer`;
      a.textContent = `💬 你的回答：${answer}`;
      card.appendChild(a);
    }
    // 记录回答到消息缓存，刷新后可恢复显示
    const act = activeConvObj();
    if (act && act.messages.length) {
      const last = act.messages[act.messages.length - 1];
      if (last && last.ask) last.answer = answer;
      saveCache();
    }
    // 自定义工具路径：回调即同步投递，时间线正确
    if (typeof onAnswer === "function") {
      onAnswer(answer);
      return;
    }
    // 内置 ask_user 兜底路径：流进行中则存答案，结束后自动投递
    askingUser = false;
    if (sending) {
      pendingAnswer = answer;
      const tip = document.createElement("div");
      tip.className = `${uid}-ask-tip`;
      tip.textContent = "AI 仍在处理中，你的回答将在本轮结束后自动发送。";
      card.appendChild(tip);
    } else {
      sendText(`（回答 AI 的问题）${answer}`);
    }
  }

  // 稳健解析 ask_user / ask_user_local 的参数：
  // 支持对象、JSON 字符串，以及 JSON.parse 失败时的文本提取兜底
  function parseAskArgs(rawArgs) {
    let question = "", options = [];
    try {
      let parsed = null;
      if (typeof rawArgs === "string") {
        try { parsed = JSON.parse(rawArgs); } catch (e) { parsed = null; }
        if (!parsed) {
          const qm = rawArgs.match(/"question"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (qm) question = qm[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
          const om = rawArgs.match(/"options"\s*:\s*\[(.*?)\]/s);
          if (om) {
            options = [...om[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
              .map((m) => m[1].replace(/\\"/g, '"'));
          }
        }
      } else if (rawArgs && typeof rawArgs === "object") {
        parsed = rawArgs;
      }
      if (parsed) {
        question = typeof parsed.question === "string" ? parsed.question : "";
        options = Array.isArray(parsed.options)
          ? parsed.options.filter((x) => typeof x === "string")
          : [];
      }
    } catch (e) { /* 解析失败保持空值 */ }
    return { question, options };
  }

  // 初始化：渲染会话列表 + 当前会话消息记录
  renderConvList();
  renderMessages();

  // 设置初始位置（右下角）
  function setInitPos(el) {
    el.style.right = "20px";
    el.style.bottom = "20px";
  }
  setInitPos(ball);
  setInitPos(win);

  // 通用拖动函数：区分「点击」和「拖动」（移动 >3px 视为拖动）
  const header = root.querySelector(`#${uid}-header`);
  // 保存本站点悬浮窗/球的位置与大小（按 host 独立存储）
  function saveUIPos() {
    try {
      // 元素隐藏（display:none）时 rect 为 0，跳过保存，避免把 0 值写进缓存
      const br = ball.getBoundingClientRect();
      if (br.width > 0 && br.height > 0) {
        hc.ball = { x: Math.round(br.left), y: Math.round(br.top) };
      }
      const wr = win.getBoundingClientRect();
      if (wr.width > 0 && wr.height > 0) {
        hc.win = { x: Math.round(wr.left), y: Math.round(wr.top), w: Math.round(wr.width), h: Math.round(wr.height) };
      }
      saveCache();
    } catch { /* 忽略 */ }
  }

  function makeDraggable(el, handle, onClick) {
    let dragging = false, moved = false, sx, sy, sLeft, sTop;
    handle.addEventListener("mousedown", (e) => {
      const tag = e.target.tagName;
      if (["BUTTON", "SELECT", "TEXTAREA", "INPUT"].includes(tag)) return;
      // 落在缩放手柄上时只缩放、不拖动（角手柄与 header 有重叠区域）
      if (e.target.closest && e.target.closest(`.${uid}-rs`)) return;
      // 球的关闭按钮：不触发拖动
      if (e.target.closest && e.target.closest(`.${uid}-ball-close`)) return;
      dragging = true; moved = false;
      const rect = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sLeft = rect.left; sTop = rect.top;
      handle.classList.add("dragging");
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      let nl = Math.max(0, Math.min(sLeft + dx, window.innerWidth - el.offsetWidth));
      let nt = Math.max(0, Math.min(sTop + dy, window.innerHeight - el.offsetHeight));
      el.style.left = nl + "px";
      el.style.top = nt + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      if (moved) saveUIPos(); // 拖动结束保存位置
      if (!moved && onClick) onClick();
    });
  }

  // 八方向缩放：dir ∈ n/nw/ne/e/se/s/sw/w，限制最小尺寸与视口边界
  const MIN_W = 430, MIN_H = 380;
  function makeResizable(el, handle, dir) {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 先转为 left/top 定位，保证缩放锚点正确
      const r = el.getBoundingClientRect();
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.maxHeight = "none";
      const sx = e.clientX, sy = e.clientY;
      const sw = r.width, sh = r.height;
      const onMove = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        let left = r.left, top = r.top, w = sw, h = sh;
        // 水平：含 e 右边缘动；含 w 左边缘动；都不含则宽度不变
        if (dir.includes("e")) w = sw + dx;
        else if (dir.includes("w")) { left = r.left + dx; w = sw - dx; }
        // 垂直：含 s 下边缘动；含 n 上边缘动；都不含则高度不变
        if (dir.includes("s")) h = sh + dy;
        else if (dir.includes("n")) { top = r.top + dy; h = sh - dy; }
        // 最小尺寸（含反向修正：缩小时 west/north 边缘要让位）
        if (w < MIN_W) {
          if (dir.includes("e")) w = MIN_W;
          else if (dir.includes("w")) { left = r.left + sw - MIN_W; w = MIN_W; }
        }
        if (h < MIN_H) {
          if (dir.includes("s")) h = MIN_H;
          else if (dir.includes("n")) { top = r.top + sh - MIN_H; h = MIN_H; }
        }
        // 最大尺寸（视口边界）
        const maxW = window.innerWidth - 10, maxH = window.innerHeight - 10;
        if (w > maxW) {
          if (dir.includes("e")) w = maxW;
          else if (dir.includes("w")) { left = r.left + sw - maxW; w = maxW; }
        }
        if (h > maxH) {
          if (dir.includes("s")) h = maxH;
          else if (dir.includes("n")) { top = r.top + sh - maxH; h = maxH; }
        }
        // 窗口整体不能移出视口
        left = Math.max(0, Math.min(left, window.innerWidth - w));
        top = Math.max(0, Math.min(top, window.innerHeight - h));
        el.style.left = left + "px";
        el.style.top = top + "px";
        el.style.width = w + "px";
        el.style.height = h + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveUIPos(); // 缩放结束保存位置与大小
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
  rsHandles.forEach((h) => makeResizable(win, h, h.dataset.dir));

  // 球：拖动 + 点击展开
  makeDraggable(ball, ball, () => {
    ball.classList.add("hidden");
    win.classList.remove("hidden");
    // 展开后立即滚动到最新消息（初始化/恢复历史时窗口隐藏，滚动曾失效）
    requestAnimationFrame(() => scrollBottom());
    input.focus();
  });
  // 窗口：通过 header 拖动
  makeDraggable(win, header);

  // 球右上角关闭按钮：临时关闭 / 永久关闭（从显示列表移除）
  const ballClose = root.querySelector(`.${uid}-ball-close`);
  ballClose.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const mask = document.createElement("div");
    mask.className = `${uid}-menu-mask`;
    const menu = document.createElement("div");
    menu.className = `${uid}-ball-menu`;
    menu.innerHTML = `
      <div class="${uid}-ball-menu-title">关闭悬浮聊天窗？</div>
      <button data-a="tmp">临时关闭（刷新后恢复）</button>
      <button data-a="forever">永久关闭（当前网站不再显示）</button>
      <button data-a="cancel">取消</button>`;
    const closeMenu = () => {
      mask.remove();
      menu.remove();
    };
    menu.querySelector('[data-a="tmp"]').addEventListener("click", () => {
      ball.style.display = "none";
      closeMenu();
    });
    menu.querySelector('[data-a="forever"]').addEventListener("click", () => {
      removeHostFromShowList(); // 从显示列表移除，本站不再显示
      ball.style.display = "none";
      closeMenu();
    });
    menu.querySelector('[data-a="cancel"]').addEventListener("click", closeMenu);
    mask.addEventListener("click", closeMenu);
    document.body.append(mask, menu);
  });

  minBtn.addEventListener("click", () => {
    win.classList.add("hidden");
    ball.classList.remove("hidden");
  });

  clearBtn.addEventListener("click", async () => {
    const act = activeConvObj();
    if (act) act.messages = [];
    saveCache();
    msgBox.innerHTML = "";
    if (conv) {
      try {
        await conv.clear();
        console.log("[SCA] 会话已清空");
      } catch (e) {
        console.warn("[SCA] 清空会话失败:", e);
      }
    }
  });

  async function sendText(text) {
    const content = (text || "").trim();
    if (!content || sending) return;
    // 首次发送时：先尝试恢复活动会话，失败再新建（懒创建，避免后台堆积空会话）
    if (!conv) {
      const act = activeConvObj();
      if (act && act.id) {
        try {
          conv = await CAT.agent.conversation.get(act.id);
          if (conv) console.log(`[SCA] 恢复会话: ${conv.id}（模型: ${conv.modelId}）`);
        } catch (e) {
          console.warn("[SCA] 恢复会话失败:", e);
        }
      }
      if (!conv) {
        const mid = modelSel.value || hc.modelId || defaultModelId || undefined;
        conv = await createConv(mid);
        // 新会话：记录到当前活动的会话槽（若该槽尚无 id）
        const slot = activeConvObj();
        if (slot) {
          slot.id = conv.id;
          slot.title = conv.title || "";
        } else {
          hc.convs.push({ key: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8), id: conv.id, title: "", messages: [], createdAt: Date.now() });
          hc.activeId = hc.convs[hc.convs.length - 1].key;
        }
        hc.modelId = conv.modelId || mid || "";
        saveCache();
        renderConvList(); // 会话槽已绑定新 id，立即刷新左侧列表
        console.log(`[SCA] 新建会话: ${conv.id}（模型: ${conv.modelId}）`);
      }
    }
    // 解析发起对话的标签页 ID，供 DOM 工具锁定操作对象
    await resolveCurrentTab();

    // 捕获当前页面快照：锁定 AI 读取的页面，避免切到其它标签页后读到别的内容
    pageSnapshot = {
      title: document.title,
      url: location.href,
      selection: window.getSelection()?.toString() || "",
      capturedAt: new Date().toLocaleTimeString(),
    };

    sending = true;
    sendBtn.disabled = true;

    // 用户消息
    const userTime = Date.now();
    // 消息写入当前活动会话记录
    const pushMsg = (m) => { const a = activeConvObj(); if (a) a.messages.push(m); };
    // 发送后进入正常对话流：移除欢迎界面
    msgBox.querySelector(`.${uid}-welcome`)?.remove();
    appendMsg("user", content, false, { time: userTime });
    pushMsg({ role: "user", content, time: userTime });
    saveCache();

    // AI 流式回复：分段显示。每次文本段（相邻 content_delta）一个气泡，
    // 工具调用单独一张标识卡片，流式期间 meta 显示"生成中"状态。
    const startTime = Date.now();
    let curBubble = null, curMeta = null, segText = "", segStart = null;

    // 提交当前文本段：渲染 Markdown + 更新耗时 + 写入缓存
    const finalizeText = () => {
      if (!curBubble) return;
      const isErr = curBubble.parentElement.classList.contains("error");
      const text = segText || "…";
      if (isErr) curBubble.textContent = text;
      else curBubble.innerHTML = renderMarkdown(text);
      const t0 = segStart || startTime;
      const d = Date.now() - t0;
      curMeta.textContent = `${formatTime(t0)} · ${formatDuration(d)}`;
      curMeta.classList.remove("generating");
      pushMsg({ role: "assistant", content: text, time: t0, duration: d });
      // 读取扩展自动更新的会话标题（只读同步，用户自定义命名优先）
      if (conv && conv.title) {
        const a = activeConvObj();
        if (a && !a.customTitle && a.title !== conv.title) {
          a.title = conv.title;
          renderConvList();
        }
      }
      curBubble = null; curMeta = null; segText = ""; segStart = null;
    };

    // 追加流式增量：无当前段则新建气泡，meta 标识"生成中"
    const pushDelta = (t) => {
      if (!curBubble) {
        const r = appendMsg("assistant", "", false, { loading: true, time: Date.now() });
        curBubble = r.bubble; curMeta = r.meta; segStart = Date.now();
        curMeta.textContent = `${formatTime(segStart)} 生成中…`;
        curMeta.classList.add("generating");
      }
      setStatus("回答中");
      segText += t;
      curBubble.textContent = segText;
      scrollBottom();
    };

    // 工具调用：先提交当前文本段，再插入工具标识卡片。
    // ask_user 走交互卡片（问题+选项+输入框），其余走工具卡片（内置工具加标记）
    const pushTool = (name, rawArgs) => {
      finalizeText();
      const argsStr =
        typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs ?? "");
      const isBuiltin = BUILTIN_TOOLS.has(name);
      if (name === "ask_user_local") {
        // 自定义提问工具：交互卡片由工具 handler 渲染（同步等待用户回答），
        // 这里只更新状态并缓存记录，恢复历史时显示只读卡片
        const { question, options } = parseAskArgs(rawArgs);
        setStatus("等待你的回答");
        pushMsg({
          role: "tool", name, args: argsStr, time: Date.now(),
          ask: true, question, options,
        });
      } else if (isBuiltin && name === "ask_user") {
        // 内置 ask_user 兜底：扩展弹窗可能失效，用聊天卡片承接（答案延迟投递）
        const { question, options } = parseAskArgs(rawArgs);
        appendAskUserCard(question, options);
        askingUser = true;
        setStatus("等待你的回答");
        pushMsg({
          role: "tool", name, args: argsStr, time: Date.now(),
          ask: true, question, options,
        });
      } else {
        appendToolCall(name, argsStr, isBuiltin);
        setStatus("调用工具：" + name);
        pushMsg({ role: "tool", name, args: argsStr, time: Date.now() });
      }
      saveCache();
    };

    // 错误段：若当前没有气泡则新建一个
    const ensureErrorBubble = () => {
      if (curBubble) return;
      const r = appendMsg("assistant", "", true, {});
      curBubble = r.bubble; curMeta = r.meta; segStart = Date.now();
      segText = "";
    };

    try {
      setStatus("思考中");
      const stream = await conv.chatStream(content);
      for await (const chunk of stream) {
        if (chunk.type === "content_delta") {
          pushDelta(chunk.content);
        } else if (chunk.type === "tool_call") {
          pushTool(chunk.toolCall.name, chunk.toolCall.args);
        } else if (chunk.type === "error") {
          ensureErrorBubble();
          segText += `\n[错误 ${chunk.errorCode || ""}] ${chunk.error}`;
          curBubble.textContent = segText;
          curBubble.parentElement.classList.add("error");
          scrollBottom();
        }
      }
    } catch (e) {
      // 打印完整堆栈便于定位：可能是扩展内部错误或我们代码的问题
      console.error("[SCA] 对话流异常:", e);
      setStatus("出错了");
      ensureErrorBubble();
      segText = `[异常] ${e.message || e}`;
      curBubble.textContent = segText;
      curBubble.parentElement.classList.add("error");
      scrollBottom();
    }
    finalizeText();
    saveCache();
    hideStatus();

    // ask_user 的答案在流结束后投递（发送时 sending 已被重置为 false）
    if (pendingAnswer) {
      const a = pendingAnswer;
      pendingAnswer = null;
      setTimeout(() => sendText(`（回答 AI 的问题）${a}`), 60);
    }

    sending = false;
    sendBtn.disabled = false;
    input.focus();
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    // 发送后重置输入框高度为最小高度
    input.style.height = "auto";
    sendText(text);
  }

  // 切换模型：新建会话但保留聊天记录
  modelSel.addEventListener("change", async () => {
    const mid = modelSel.value;
    if (!mid || sending) return;
    // 会话还没创建：只记录用户选择的模型，等首次发送时用
    if (!conv) {
      hc.modelId = mid;
      saveCache();
      const label = modelSel.selectedOptions[0]?.textContent || mid;
      console.log(`[SCA] 预选模型: ${label}（会话将在首次发送时创建）`);
      return;
    }
    if (mid === conv.modelId) return;
    try {
      await conv.save();
    } catch (e) {
      console.warn("[SCA] 保存旧会话失败:", e);
    }
    conv = await createConv(mid);
    // 当前会话槽换绑到新后端会话（聊天记录保留在本地）
    const slot = activeConvObj();
    if (slot) slot.id = conv.id;
    hc.modelId = conv.modelId || mid;
    saveCache();
    const label = modelSel.selectedOptions[0]?.textContent || mid;
    const now = Date.now();
    appendMsg("assistant", `已切换模型：${label}。`, false, { time: now });
    const slot2 = activeConvObj();
    if (slot2) slot2.messages.push({ role: "assistant", content: `已切换模型：${label}。`, time: now });
    saveCache();
    console.log(`[SCA] 已切换到模型: ${conv.modelId}`);
  });

  sendBtn.addEventListener("click", send);
  // 输入框随内容自动增高（最高约 10 行，超过则内部滚动）
  const INPUT_MAX_H = 240;
  const autoGrow = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, INPUT_MAX_H) + "px";
  };
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", (e) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  console.log("[SCA] 悬浮聊天窗已就绪，点击右下角 AI 球打开。");
};
