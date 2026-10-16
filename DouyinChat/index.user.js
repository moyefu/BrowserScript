// ==UserScript==
// @name         DouyinChat - 抖音聊天消息推送通知
// @namespace    http://tampermonkey.net/
// @author       MOYEFU
// @version      1.5.0
// @description  抖音聊天页未读消息桌面通知推送；时间标签「刚刚」识别新消息；私密模式防窥屏；网页标题未读数同步
// @match        https://www.douyin.com/chat
// @tag          MOYEFU
// @run-at       document-start
// @icon         https://www.douyin.com/favicon.ico
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        window.focus
// ==/UserScript==

/* ==UserConfig==
    Config:
        privacyMode:
            title: 消息私密模式
            description: 开启后桌面通知不再展示消息内容，仅显示发件人和未读数量
            type: checkbox
            default: true
        consoleLog:
            title: 打印控制台日志
            description: 开启后在控制台输出日志，方便调试
            type: checkbox
            default: false
==/UserConfig== */
// 使用 IIFE 立即执行函数包裹，避免全局作用域污染
(function () {
    // 开启严格模式：禁止隐式全局变量、保留字赋值、八进制字面量等不安全的操作
    'use strict';

    // 读取用户配置中的「打印控制台日志」开关，默认关闭
    // GM_getValue 是 ScriptCat/Tampermonkey 提供的 API，用于读取用户自定义配置
    const consoleLog = GM_getValue('Config.consoleLog', false);

    // 当开启日志开关时，输出启动日志
    consoleLog && console.log('抖音消息监听脚本启动');

    // 判断当前标签页是否处于前台聚焦状态
    // document.visibilityState === 'visible' 表示页面可见
    // document.hasFocus() 表示页面获得焦点
    function isTabFocused() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    // 防抖定时器变量：DOM 变化高频触发时，只会在最后一次触发后 300ms 才执行检测
    let debounceTimer = null;
    // 防抖延迟毫秒数：300ms 平衡响应速度与 CPU 开销
    const DEBOUNCE_MS = 300;

    // 核心检测函数：检测未读消息并触发通知
    // 调用时机：1) MutationObserver 回调 2) 焦点/可见性事件 3) 启动时立即执行一次
    function checkUnread() {
        try {
            // 查询所有未读角标元素，抖音聊天页的未读数量容器类名
            const unreadBadges = document.querySelectorAll('.ConversationItemUnReadCountdigitsNumberPop');
            // 累加所有未读数，用于网页标题展示
            let totalUnread = 0;
            // 遍历每个未读角标，累加到总未读数
            unreadBadges.forEach(badge => {
                const num = parseInt(badge.textContent.trim());
                // 仅累加有效数字（排除 NaN）
                if (!isNaN(num)) totalUnread += num;
            });

            // ========== 网页标题：[未读数量]抖音聊天，不区分聚焦状态 ==========
            // 有未读时标题显示 [N]抖音聊天，无未读时显示 抖音聊天
            if (totalUnread > 0) {
                document.title = `[${totalUnread}]抖音聊天`;
            } else {
                document.title = '抖音聊天';
            }

            // 若页面没有任何未读角标，直接返回，无需后续检测
            if (!unreadBadges.length) return;

            // 取第一条带未读标记的角标（DOM 中第一个，通常对应最新或置顶会话）
            const firstUnreadBadge = unreadBadges[0];
            // 向上查找该角标所属的会话项顶层容器（data-index 仅出现在会话项最外层 div，比 class 子串匹配更精确）
            const conversationItem = firstUnreadBadge.closest('[data-index]');
            // 找不到会话项时直接返回
            if (!conversationItem) return;

            // 提取会话项内的标题元素（发件人名称）
            const titleEl = conversationItem.querySelector('.conversationConversationItemtitle');
            // 提取会话项内的提示文本（最近一条消息预览）
            const hintEl = conversationItem.querySelector('.ConversationItemHinttextBox');
            // 提取会话项内的时间标签，抖音会话项右侧的时间文本（如"刚刚"、"1分钟前"、"昨天"等）
            const timeStrEl = conversationItem.querySelector('.ConversationItemTagNextToTitletimeStr');
            // 提取当前会话项内的头像图片（统一选择器，兼容群聊与私聊）
            // 群聊：.conversationConversationItemrowArea1 img 直接命中
            // 私聊：.conversationConversationItemrowArea1 .commonIMAvataravatarContainer img 命中
            const avatarImgEl = conversationItem.querySelector('.conversationConversationItemrowArea1 img');

            // 发件人名称（trim 去除首尾空白，兜底为空字符串）
            const senderName = titleEl?.textContent?.trim() || '';
            // 当前会话未读数量文本
            const unreadNumText = firstUnreadBadge.textContent.trim();
            // 最近一条消息预览内容
            const msgPreview = hintEl?.textContent?.trim() || '';
            // 会话项时间标签文本（"刚刚"/"1分钟前"/"昨天"等）
            const timeStr = timeStrEl?.textContent?.trim() || '';
            // 头像图片 URL，私密模式下会被置空
            let avatarSrc = avatarImgEl?.src || '';

            // ✅ 判断依据：仅当会话项时间标签为"刚刚"时，才视为新消息
            // 非"刚刚"（如"1分钟前"、"昨天"）的未读属于历史消息，不触发通知
            // 同人多发消息时，每条消息都会让时间标签变回"刚刚"，从而持续触发提醒
            if (timeStr !== '刚刚') return;

            // 时间标签为"刚刚"时，用 人名 + 未读数量 拼接作为新消息 key
            // 用 "|" 分隔拼接，避免重名+同数量误判为"无变化"
            const key = `${senderName}|${unreadNumText}`;
            // 读取上一次保存的 key，用于判断是否有新消息
            const lastKey = GM_getValue('lastMsgKey', '');
            // 获取当前标签页聚焦状态
            const tabFocused = isTabFocused();
            // 输出调试日志：聚焦状态、时间标签、当前 key、总未读数
            consoleLog && console.log('检测消息 | 聚焦状态：', tabFocused, '时间标签：', timeStr, 'key:', key, '总未读：', totalUnread);

            // 触发通知条件：1) key 与上次不同（有新消息） 2) 标签页不在前台（避免用户正在看时弹窗）
            if (key !== lastKey && !tabFocused) {
                // 读取用户配置中的「消息私密模式」开关，默认关闭
                const privacyMode = GM_getValue('Config.privacyMode', false);
                // 通知正文变量，根据私密模式决定内容
                let notificationText;
                if (privacyMode) {
                    // 私密模式：正文显示"一条新的消息"，头像置空，隐藏消息预览
                    notificationText = '一条新的消息';
                    avatarSrc = '';
                } else {
                    // 非私密模式：正文显示"发件人: 消息预览"，保留头像
                    notificationText = senderName + ': ' + msgPreview;
                }
                // 调用 GM_notification 弹系统级桌面通知
                GM_notification({
                    // 通知标题：抖音新消息【N条】
                    title: `抖音新消息【${unreadNumText}条】`,
                    // 通知正文
                    text: notificationText,
                    // 通知图标 URL（抖音 favicon）
                    iconUrl: 'https://www.douyin.com/favicon.ico',
                    // 高亮显示通知（Windows 任务栏弹窗）
                    highlight: true,
                    // 通知右上角头像图（私密模式下为空字符串）
                    image: avatarSrc,
                    // 点击通知回调：阻止默认行为并聚焦浏览器窗口
                    onclick: (event) => {
                        event.preventDefault();
                        // 输出调试日志
                        consoleLog && console.log('点击通知，尝试聚焦窗口');
                        // 聚焦浏览器窗口（需要用户手动点击通知，浏览器安全限制）
                        window.focus();
                    }
                });
                // 保存当前 key，下次检测时用于比较是否变化
                GM_setValue('lastMsgKey', key);
            }
        } catch (err) {
            // 任何 DOM 操作异常都捕获，避免脚本崩溃
            // 仅在开启日志开关时输出警告
            consoleLog && console.warn('检测消息异常：', err);
        }
    }

    // DOM 变动回调函数（带防抖）
    // 每次调用先清除上一个定时器，延迟 300ms 后才真正执行 checkUnread
    // 避免高频 DOM 变化（如页面渲染）导致重复检测
    function onDomChange() {
        // 清除上一次的防抖定时器
        clearTimeout(debounceTimer);
        // 设置新的定时器，300ms 后执行 checkUnread
        debounceTimer = setTimeout(() => {
            checkUnread();
        }, DEBOUNCE_MS);
    }

    // 创建 MutationObserver 实例，回调函数为 onDomChange
    const observer = new MutationObserver(onDomChange);

    // 启动 DOM 监听
    function startObserve() {
        // 监听 document.body，配置项说明：
        // childList: true      - 监听子节点增删（未读角标出现/消失）
        // subtree: true        - 递归监听所有后代节点
        // attributes: true     - 监听属性变化（类名、样式等）
        // characterData: true  - 监听文本内容变化（未读数更新仅改文本节点）
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });
        // 输出调试日志
        consoleLog && console.log('✅ MutationObserver已启动，监听DOM文本+节点+属性变化');
        // 启动时立即执行一次检测，避免首次延迟
        checkUnread();
    }

    // ========== 【保留原版 componentsRightPanelwrapper 逻辑，防止切后台自动读消息】 ==========
    // 右侧聊天面板元素：当标签页在后台时隐藏该面板，
    // 防止抖音前端逻辑因"面板可见"而自动将未读消息标记为已读
    let reload_timeout = null;
    // 面板状态更新函数：根据聚焦状态显示/隐藏右侧面板
    function updatePanelStatus() {
        // 获取当前标签页聚焦状态
        const focused = isTabFocused();
        // 输出调试日志
        consoleLog && console.log('标签是否聚焦：', focused);
        if (focused) {
            // 标签回到前台：立即显示右侧面板
            // 先清除后台隐藏定时器（防止刚回前台就触发隐藏）
            clearTimeout(reload_timeout);
            // 查找右侧面板元素
            const panel = document.querySelector('.componentsRightPanelwrapper');
            // 元素存在时设为 block 显示
            if(panel) panel.style.display = 'block';
        } else {
            // 标签切后台：延时 1s 后隐藏右侧面板
            // 先清除之前可能存在的定时器，避免重复触发
            clearTimeout(reload_timeout);
            // 设置定时器，1000ms 后执行隐藏
            reload_timeout = setTimeout(() => {
                // 查找右侧面板元素
                const panel = document.querySelector('.componentsRightPanelwrapper');
                // 元素存在时设为 none 隐藏，阻止自动已读
                if(panel) panel.style.display = 'none';
            }, 1000);
        }
        // 同时触发 DOM 检测（面板状态变化会影响未读数）
        onDomChange();
    }

    // 焦点/页面可见性事件监听：
    // visibilitychange - 浏览器标签页切换/窗口最小化
    // focus - 窗口获得焦点
    // blur - 窗口失去焦点
    // 三个事件都绑定 updatePanelStatus，确保面板显示隐藏 + 消息检测及时响应
    document.addEventListener('visibilitychange', updatePanelStatus);
    window.addEventListener('focus', updatePanelStatus);
    window.addEventListener('blur', updatePanelStatus);

    // 等待页面 DOM 挂载后再启动监听（延迟 1200ms）
    // 抖音是 SPA，首屏 DOM 渲染需要时间，过早启动会导致 querySelector 找不到元素
    setTimeout(() => {
        // 启动 MutationObserver 监听 DOM 变化
        startObserve();
        // 初始化面板状态（根据当前聚焦状态显示/隐藏）
        updatePanelStatus();
    }, 1200);

    // 页面关闭前清理资源
    // 避免页面卸载后 MutationObserver/定时器仍在运行导致内存泄漏
    window.addEventListener('beforeunload', () => {
        // 停止 MutationObserver 监听
        observer.disconnect();
        // 清除防抖定时器
        clearTimeout(debounceTimer);
        // 清除面板隐藏定时器
        clearTimeout(reload_timeout);
    })
})();
