// ==UserScript==
// @name         标签数量限制
// @namespace    https://docs.scriptcat.org/
// @version      0.5.1
// @description  配置每行一条：网页地址 标签上限 new/old；支持通配符 * ；new 保留最新 N 个，old 保留最旧 N 个；通过 BroadcastChannel + localStorage + GM 三重通道进行并发探活与批量定向关闭，彻底杜绝幽灵标签与多关漏关
// @author       MOYEFU
// @match        http*://*/*
// @grant        window.close
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @tag          MYF
// @run-at       document-start
// @noframes
// ==/UserScript==

/* ==UserConfig==
Config:
  tab_limit_list:
    title: 标签数量限制规则 (多个用换行区分)
    description: 每行一条，格式：网页地址通配符 标签上限 new/old；支持通配符 * ；new 保留最新的 N 个标签，old 保留最旧的 N 个标签，超出上限的标签自动关闭
    type: textarea
    default: |
      https://rewards.bing.com/dashboard 1 old
      https://*.bing.com/search* 5 new

==/UserConfig== */

(function() {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const DEFAULT_CONFIG = `https://rewards.bing.com/dashboard 1 old\nhttps://*.bing.com/search* 5 new`;

    // 1. 获取并解析配置规则
    let tabLimitRaw = GM_getValue('Config.tab_limit_list', DEFAULT_CONFIG);
    if (!tabLimitRaw) tabLimitRaw = DEFAULT_CONFIG;

    const RULE_REG = /^(.+?)\s+(\d+)\s+(new|old)\s*$/;
    let tabLimitRules = parseRules(tabLimitRaw);

    function parseRules(raw) {
        const rules = [];
        raw.split('\n').forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;
            const m = line.match(RULE_REG);
            if (m) {
                rules.push({
                    pattern: m[1],
                    limit: parseInt(m[2], 10),
                    mode: m[3]
                });
            }
        });
        return rules;
    }

    if (tabLimitRules.length === 0) return;

    const currentUrl = window.location.href;

    // 通配符 * 转为正则
    function wildcardToRegex(pattern) {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp('^' + escaped + '$');
    }

    // 匹配命中当前 URL 的规则（取最严格的 limit，首条的 mode）
    const matched = tabLimitRules.filter(rule => wildcardToRegex(rule.pattern).test(currentUrl));
    if (matched.length === 0) return;

    let effectiveLimit = Math.min(...matched.map(r => r.limit));
    let effectiveMode = matched[0].mode;
    const rulePattern = matched[0].pattern;

    // 2. 标签身份与时间戳持久化（支持刷新 F5 与同标签跳转保留年龄）
    const CHANNEL_BASE = 'tabLimit_' + encodeURIComponent(rulePattern);
    const SESSION_ID_KEY = CHANNEL_BASE + '_id';
    const SESSION_TS_KEY = CHANNEL_BASE + '_ts';

    let myTabId;
    let myBirthTs;

    try {
        myTabId = win.sessionStorage ? win.sessionStorage.getItem(SESSION_ID_KEY) : null;
        myBirthTs = win.sessionStorage ? parseInt(win.sessionStorage.getItem(SESSION_TS_KEY), 10) : null;
    } catch (e) {
        // 部分无痕模式或安全设置下 sessionStorage 可能受限
    }

    if (!myTabId || !Number.isFinite(myBirthTs)) {
        myTabId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        myBirthTs = Date.now();
        try {
            if (win.sessionStorage) {
                win.sessionStorage.setItem(SESSION_ID_KEY, myTabId);
                win.sessionStorage.setItem(SESSION_TS_KEY, String(myBirthTs));
            }
        } catch (e) {
            // ignore
        }
    }

    // 3. 三重实时通信总线（BroadcastChannel + localStorage storage事件 + GM跨域监听）
    const bcChannelName = CHANNEL_BASE;
    const storageEventKey = CHANNEL_BASE + '_ls_event';
    const gmChannelKey = CHANNEL_BASE + '_gm_event';

    let bc = null;
    let gmListenerId = null;
    let isClosing = false;
    let isProbeRunning = false;

    // 消息去重队列（防止多通道重复消费同一消息）
    const PROCESSED_MSG_MAX = 300;
    const processedMsgIds = new Set();
    const processedMsgOrder = [];

    function markMsgProcessed(msgId) {
        if (!msgId) return false;
        if (processedMsgIds.has(msgId)) return true;
        processedMsgIds.add(msgId);
        processedMsgOrder.push(msgId);
        if (processedMsgOrder.length > PROCESSED_MSG_MAX) {
            const oldest = processedMsgOrder.shift();
            processedMsgIds.delete(oldest);
        }
        return false;
    }

    // 广播消息
    function broadcast(type, data) {
        const msg = {
            msgId: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            senderId: myTabId,
            type: type,
            data: data || {}
        };
        markMsgProcessed(msg.msgId);

        const serialized = JSON.stringify(msg);

        // 通道 1: 页面级原生 BroadcastChannel（同源微秒级，免沙箱隔离）
        if (bc) {
            try {
                bc.postMessage(msg);
            } catch (e) {
                // ignore
            }
        }

        // 通道 2: 页面级 localStorage storage 事件（同源绝对可靠兜底）
        try {
            if (win.localStorage) {
                win.localStorage.setItem(storageEventKey, serialized);
            }
        } catch (e) {
            // ignore
        }

        // 通道 3: GM 扩展级存储监听（跨子域/跨域通配）
        try {
            GM_setValue(gmChannelKey, serialized);
        } catch (e) {
            // ignore
        }
    }

    // 探活探测表：probeId -> Map(tabId => { tabId, birthTs })
    const activeProbes = new Map();

    // 接收并处理消息
    function handleMessage(msg) {
        if (!msg || !msg.msgId || !msg.type) return;
        if (msg.senderId === myTabId) return; // 忽略自己发出的消息
        if (markMsgProcessed(msg.msgId)) return; // 忽略已消费过的重复消息

        switch (msg.type) {
            case 'PING': {
                // 有其他标签发起探活：若当前标签未在关闭流程中，立即回送 PONG
                if (isClosing) return;
                broadcast('PONG', {
                    targetProbeId: msg.data && msg.data.probeId,
                    tabId: myTabId,
                    birthTs: myBirthTs
                });
                break;
            }

            case 'PONG': {
                // 收到其他活跃标签的探活响应
                const targetProbeId = msg.data && msg.data.targetProbeId;
                if (!targetProbeId) return;
                const probeCollector = activeProbes.get(targetProbeId);
                if (probeCollector && msg.data.tabId && Number.isFinite(msg.data.birthTs)) {
                    probeCollector.set(msg.data.tabId, {
                        tabId: msg.data.tabId,
                        birthTs: msg.data.birthTs
                    });
                }
                break;
            }

            case 'KILL': {
                // 收到定向关闭指令（支持单个 targetTabId 或批量 targetTabIds）
                const targets = (msg.data && msg.data.targetTabIds) || (msg.data && msg.data.targetTabId ? [msg.data.targetTabId] : []);
                if (targets.includes(myTabId)) {
                    closeSelf();
                }
                break;
            }

            case 'BYE': {
                // 某标签正常退出，从当前所有活跃探活收集中剔除
                const leavingTabId = msg.data && msg.data.tabId;
                if (leavingTabId) {
                    for (const collector of activeProbes.values()) {
                        collector.delete(leavingTabId);
                    }
                }
                break;
            }
        }
    }

    // 初始化页面级 BroadcastChannel
    try {
        if (typeof win.BroadcastChannel !== 'undefined') {
            bc = new win.BroadcastChannel(bcChannelName);
            bc.onmessage = evt => {
                if (evt && evt.data) handleMessage(evt.data);
            };
        }
    } catch (e) {
        console.warn('[TabLimit] BroadcastChannel 初始化受限:', e);
    }

    // 初始化 localStorage storage 事件监听
    try {
        win.addEventListener('storage', evt => {
            if (evt.key === storageEventKey && evt.newValue) {
                try {
                    const parsed = JSON.parse(evt.newValue);
                    handleMessage(parsed);
                } catch (err) {
                    // ignore
                }
            }
        });
    } catch (e) {
        // ignore
    }

    // 初始化 GM 监听器（用于跨域通配）
    try {
        if (typeof GM_addValueChangeListener === 'function') {
            gmListenerId = GM_addValueChangeListener(gmChannelKey, (name, oldValue, newValue, remote) => {
                if (!remote || !newValue) return;
                try {
                    const parsed = typeof newValue === 'string' ? JSON.parse(newValue) : newValue;
                    handleMessage(parsed);
                } catch (err) {
                    // ignore
                }
            });
        }
    } catch (e) {
        console.warn('[TabLimit] GM_addValueChangeListener 注册失败:', e);
    }

    // 监听脚本设置配置动态变更
    try {
        if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener('Config.tab_limit_list', (name, oldValue, newValue) => {
                if (!newValue) return;
                const newRules = parseRules(newValue);
                const newMatched = newRules.filter(r => wildcardToRegex(r.pattern).test(currentUrl));
                if (newMatched.length > 0) {
                    effectiveLimit = Math.min(...newMatched.map(r => r.limit));
                    effectiveMode = newMatched[0].mode;
                    triggerProbe();
                }
            });
        }
    } catch (e) {
        // ignore
    }

    // 4. 探活发起与批量精准关闭决策
    const PROBE_COLLECT_MS = 180;

    function triggerProbe() {
        if (isClosing || isProbeRunning) return;
        isProbeRunning = true;

        const probeId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const collectedTabs = new Map();
        // 先把自己加进活跃列表
        collectedTabs.set(myTabId, { tabId: myTabId, birthTs: myBirthTs });
        activeProbes.set(probeId, collectedTabs);

        // 广播探活请求
        broadcast('PING', { probeId: probeId, birthTs: myBirthTs });

        // 收集存活标签的 PONG 响应
        setTimeout(() => {
            activeProbes.delete(probeId);
            isProbeRunning = false;
            if (isClosing) return;

            evaluateAndAct(Array.from(collectedTabs.values()));
        }, PROBE_COLLECT_MS);
    }

    function evaluateAndAct(tabs) {
        if (isClosing) return;

        // 全序排序：时间戳升序；若时间戳完全相同，按 tabId 字典序比较确保确定性
        tabs.sort((a, b) => {
            if (a.birthTs !== b.birthTs) return a.birthTs - b.birthTs;
            return a.tabId.localeCompare(b.tabId);
        });

        const total = tabs.length;
        if (total <= effectiveLimit) {
            // 未达到数量限制，无需操作
            return;
        }

        // 计算保留集与淘汰集
        let survivors;
        let toKill;

        if (effectiveMode === 'new') {
            // 保留最新的 effectiveLimit 个
            survivors = tabs.slice(-effectiveLimit);
            toKill = tabs.slice(0, total - effectiveLimit);
        } else {
            // old 模式：保留最旧的 effectiveLimit 个
            survivors = tabs.slice(0, effectiveLimit);
            toKill = tabs.slice(effectiveLimit);
        }

        const survivorIds = new Set(survivors.map(t => t.tabId));

        // 判定自己是否需要关闭
        if (!survivorIds.has(myTabId)) {
            // 自己不在保留集中（如 old 模式新打开的超额标签），立即极速关闭自己
            closeSelf();
            return;
        }

        // 自己在保留集中：收集需要淘汰的目标标签 ID 数组，以【单个批量广播】一次性下发
        const targetTabIds = toKill.filter(v => v.tabId !== myTabId).map(v => v.tabId);
        if (targetTabIds.length > 0) {
            broadcast('KILL', { targetTabIds: targetTabIds });
        }
    }

    // 5. 关闭执行与浏览器权限受限降级拦截 UI
    function closeSelf() {
        if (isClosing) return;
        isClosing = true;

        // 立即广播告知自身退出，并销毁监听（不再响应 PONG 占位）
        broadcast('BYE', { tabId: myTabId });
        destroyResources();

        try {
            window.close();
        } catch (e) {
            console.warn('[TabLimit] window.close 异常:', e);
        }

        // 浏览器关闭窗口是异步 IPC 过程，必须留足充分的销毁缓冲时间（1200ms）。
        // 若超过 1200ms 窗口仍未关闭（window.closed === false），才证明确实受浏览器安全限制拦截，再降级展示提示屏。
        setTimeout(() => {
            if (!window.closed) {
                renderBlockScreen();
            }
        }, 1200);
    }

    function renderBlockScreen() {
        try {
            if (window.stop) window.stop();
        } catch (e) {}

        const showNotice = () => {
            try {
                if (window.closed) return;
                if (document.getElementById('tablimit-blocked-container')) return;

                const container = document.createElement('div');
                container.id = 'tablimit-blocked-container';
                container.style.cssText = `
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    background: #18181b !important;
                    color: #f4f4f5 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    z-index: 2147483647 !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                `;

                const safePattern = String(rulePattern).replace(/[&<>"']/g, s => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
                }[s]));

                container.innerHTML = `
                    <div style="background: #27272a; padding: 36px 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: center; max-width: 460px; width: 88%; border: 1px solid #3f3f46;">
                        <div style="font-size: 44px; margin-bottom: 14px;">🛑</div>
                        <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 600; color: #fff;">标签页数量已超上限</h2>
                        <p style="margin: 0 0 20px; font-size: 14px; color: #a1a1aa; line-height: 1.6;">
                            当前页面匹配规则 <code>${safePattern}</code><br>
                            限制上限为 <strong>${effectiveLimit}</strong> 个（保留 <strong>${effectiveMode === 'new' ? '最新' : '最旧'}</strong> 标签）。<br>
                            受浏览器安全策略限制，无法自动关闭此标签，<strong>请手动关闭当前标签页</strong>。
                        </p>
                        <button id="tablimit-close-btn" style="background: #ef4444; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.2s;">
                            关闭此标签页
                        </button>
                    </div>
                `;

                if (document.body) {
                    document.body.appendChild(container);
                } else {
                    document.documentElement.appendChild(container);
                }

                const btn = document.getElementById('tablimit-close-btn');
                if (btn) {
                    btn.onclick = () => window.close();
                }
            } catch (err) {
                console.error('[TabLimit] 渲染拦截提示失败:', err);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showNotice, { once: true });
        } else {
            showNotice();
        }
    }

    function destroyResources() {
        if (bc) {
            try { bc.close(); } catch (e) {}
            bc = null;
        }
        if (gmListenerId !== null && typeof GM_removeValueChangeListener === 'function') {
            try { GM_removeValueChangeListener(gmListenerId); } catch (e) {}
            gmListenerId = null;
        }
        if (safetyTicker) {
            clearInterval(safetyTicker);
            safetyTicker = null;
        }
    }

    // 页面卸载事件清理
    window.addEventListener('pagehide', () => {
        if (!isClosing) {
            broadcast('BYE', { tabId: myTabId });
            destroyResources();
        }
    });

    window.addEventListener('beforeunload', () => {
        if (!isClosing) {
            broadcast('BYE', { tabId: myTabId });
            destroyResources();
        }
    });

    // 6. 生命周期触发：启动探测、页面唤醒探测与低频兜底
    // A. 页面加载初期（document-start）立即发起探活
    triggerProbe();

    // B. 当标签页从后台切换到前台（休眠唤醒）时快速复核一次
    document.addEventListener('visibilitychange', () => {
        if (!isClosing && document.visibilityState === 'visible') {
            triggerProbe();
        }
    });

    // C. 30 秒低频兜底巡检（开销极低，仅在无操作长驻留时防止边缘状态失同步）
    let safetyTicker = setInterval(() => {
        if (!isClosing) {
            triggerProbe();
        }
    }, 30000);

})();
