<div align="center">
  <h1>抖音聊天消息推送通知</h1>
  <p><strong>DouyinChat - Douyin Chat Message Push Notification</strong></p>
  <p>基于 DOM 监听与时间标签识别的抖音聊天页未读消息桌面通知推送，支持私密模式防窥屏与网页标题未读数同步。</p>
</div>

---

## 🌟 核心特性

### 1. 🔔 精准未读消息桌面通知
- **时间标签识别新消息**：仅当会话项时间标签为「刚刚」时，才判定为新消息并触发通知，历史未读（如「1分钟前」「昨天」）不会误报。
- **人名 + 未读数量双重 key**：同人连续发多条消息时，每次时间标签刷新为「刚刚」且未读数量递增，key 持续变化，确保每条消息都能独立触发提醒。
- **系统级桌面通知**：基于 `GM_notification` 弹出操作系统级通知，标题含未读条数，正文含发件人与消息预览，支持点击聚焦浏览器窗口。

### 2. 🔒 私密模式防窥屏
- 开启后桌面通知正文仅显示「一条新的消息」，不再泄露消息预览与头像，适合多人在同一电脑前办公的隐私保护场景。
- 私密模式通过脚本猫 `UserConfig` 面板勾选，无需修改源码。

### 3. 📌 网页标题未读数同步
- 所有未读角标总数实时同步到浏览器标签页标题，格式为 `[N]抖音聊天`。
- 即使页面在后台，仍可通过任务栏/标签栏未读数一眼掌握消息状态。

### 4. 🛡️ 右侧面板隐藏防自动已读
- 标签页切后台时，自动隐藏抖音右侧聊天面板（`.componentsRightPanelwrapper`），阻止前端逻辑将未读消息自动标记为已读。
- 回到前台时立即恢复面板显示，保证正常阅读体验。

### 5. ⚡ 高性能 DOM 监听
- `MutationObserver` 监听子节点增删、属性变化与文本节点内容变化，精准捕获未读角标更新。
- 300ms 防抖机制过滤高频 DOM 变动，避免重复检测浪费 CPU。
- 1200ms 启动延迟，等待抖音 SPA 首屏 DOM 渲染完成后再挂载监听，确保 `querySelector` 命中。

### 6. 🧪 可选控制台调试日志
- 开启 `consoleLog` 配置后，在浏览器 F12 控制台输出聚焦状态、时间标签、key 值、总未读数等调试信息，便于排查误判问题。

---

## ⚙️ 脚本配置项 (Script Settings)

在 ScriptCat / 油猴脚本设置面板中可配置以下参数：

| 配置参数名 | 中文标签 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `Config.privacyMode` | 消息私密模式 | 勾选框 (`checkbox`) | `true` | 开启后桌面通知正文仅显示「一条新的消息」，隐藏消息预览与头像 |
| `Config.consoleLog` | 打印控制台日志 | 勾选框 (`checkbox`) | `false` | 开启后在浏览器 F12 控制台输出调试日志 |

---

## 📋 脚本权限说明 (UserScript Metadata)

```javascript
// @grant        GM_notification   // 弹出系统级桌面通知
// @grant        GM_setValue       // 持久化存储 lastMsgKey 与用户配置
// @grant        GM_getValue       // 读取 lastMsgKey 与用户配置
// @grant        window.focus      // 点击通知时聚焦浏览器窗口
// @match        https://www.douyin.com/chat   // 仅匹配抖音聊天页
// @run-at       document-start   // 最早时机介入，减少 DOM 渲染延迟
```

---

## 📄 开源协议 (License)

本项目基于 [MIT License](https://opensource.org/licenses/MIT) 开源。
