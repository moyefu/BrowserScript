# 更新日志 (Changelog)

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/) 语义化版本规范。

---

## [1.5.0] - 2026-10-16

### 👥 群聊与私聊头像统一提取
- **会话项顶层容器定位优化**：`closest('[class*="conversationConversationItem"]')` 改为 `closest('[data-index]')`，精准命中会话项最外层 div，避免 class 子串匹配误命中 `rowArea` 等中间层导致子元素查询失效；
- **头像选择器统一**：从 `document.querySelector('.commonIMAvataravatarContainer img')`（全局取第一个，仅命中私聊）改为 `conversationItem.querySelector('.conversationConversationItemrowArea1 img')`，后代选择器同时兼容群聊（`rowArea1 > img`）与私聊（`rowArea1 > div > span > img`）两种 DOM 结构。

---

## [1.4.0] - 2026-10-15

### 🏷️ 项目正式收录
- 将脚本从 `test/` 目录迁移至独立子项目 `DouyinChat/`，赋予专属 `README.md` 与 `UPDATE.md`；
- 优化 `@name` 为 `DouyinChat - 抖音聊天消息推送通知`，`@description` 精简为四段式核心功能速览；
- 新增时间标签「刚刚」识别机制：会话项时间标签非「刚刚」时直接跳过，历史未读消息不再误触发通知；
- 调试日志中补充时间标签输出，便于排查识别结果。

---

## [1.3.0] - 2026-09-01

### ✨ 功能增强
- **私密模式**：新增 `Config.privacyMode` 配置项，开启后桌面通知仅显示「一条新的消息」，隐藏消息预览与头像，保护个人隐私；
- **网页标题同步**：未读总数实时写入标签页标题 `[N]抖音聊天`，后台也能通过任务栏未读数掌握消息状态；
- **右侧面板隐藏防自动已读**：标签页切后台时自动隐藏 `.componentsRightPanelwrapper`，阻止抖音前端将未读标记为已读；回到前台 1s 内自动恢复；
- **防抖优化**：DOM 变动回调加 300ms 防抖，过滤高频渲染触发。

---

## [1.0.0] - 2026-08-15

### 🎉 初始版本发布
- **DOM 监听未读消息**：基于 `MutationObserver` 监听子节点增删、属性变化与文本内容变化，精准捕获未读角标更新；
- **新消息判定**：以「人名 + 未读数量」组合为 key，同人多发消息时数量变化即可触发提醒；
- **系统级桌面通知**：基于 `GM_notification` 弹出桌面通知，标题含未读条数，正文含发件人与消息预览；
- **点击通知聚焦窗口**：支持 `window.focus()` 将浏览器窗口拉回前台；
- **控制台日志开关**：`Config.consoleLog` 可选开启调试日志输出。
