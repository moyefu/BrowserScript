<div align="center">
  <h1>标签数量限制</h1>
  <p><strong>TabLimit - Browser Tab Quantity Limiter</strong></p>
  <p>按规则维护标签数量，支持保留最新 N 个或最旧 N 个标签，超出上限毫秒级极速关闭。</p>
</div>

---

## 🌟 核心特性

### 1. 🎯 按规则维度的标签数量限制
- **URL 通配符匹配**：支持全局通配符 `*`，可精确匹配特定域名、路径或带参数的完整 URL。
- **跨域/跨子域互通**：同一规则下所有命中的 URL（支持如 `*.bing.com` 跨子域）共享通信通道。
- **多条规则共存**：同一 URL 可命中多条规则，脚本取最严格的 `limit` 与首条的 `mode`。

### 2. ⏱️ 双模式保留策略
- **new 模式**：保留**最新**的 N 个标签，超出部分自动关闭最旧标签（适合搜索会话流，防止旧标签无限堆积）。
- **old 模式**：保留**最旧**的 N 个标签，超出部分自动关闭新打开标签（适合主标签常驻场景，自动关闭误点开的重复页）。

### 3. 📡 Ping-Pong 实时探活（彻底根治「关多」误杀）
- 弃用传统的静态共享存储与不可靠的 `beforeunload` 清理机制。
- 新标签打开时（`document-start`）广播 `PING`，仅真实存活的标签响应 `PONG`。
- 150ms 极速探活，已崩溃、被杀进程或已关闭的“幽灵标签”因无法响应而自动被剔除，绝无幽灵标签残留导致的误杀。

### 4. ⚡ 双通道通信与精准定向关闭（彻底根治「关少」漏关）
- **双通道总线**：优先使用原生 `BroadcastChannel` 毫秒级极速通信；跨子域规则自动结合 `GM_addValueChangeListener` 跨域广播兜底。
- **定向下发指令**：新标签汇总存活标签后，精准向超额的目标标签下发 `KILL` 指令；即使旧标签在后台休眠，也能被事件总线瞬间唤醒并极速关闭。
- **极速响应**：判定超限后 0~100ms 极速 `window.close()`，避免页面加载耗费 CPU/流量与视觉闪烁。

### 5. 🔄 刷新与同标签跳转记忆
- 通过 `sessionStorage` 固化当前标签的唯一 `tabId` 和初始创建时间戳 `ts`。
- 用户按 F5 刷新或在当前标签内点击相同规则的链接时，保持其原始标签年龄，避免刷新导致年龄重置或意外关闭。

### 6. 🛑 浏览器安全限制优雅拦截
- 若标签因浏览器安全策略限制（如直接在地址栏输入或书签打开的标签）导致 `window.close()` 无法静默关闭；
- 脚本自动停止后续页面加载，并渲染全屏美化拦截屏（附带手动关闭按钮）；
- 该标签立即永久退出探活通道，不再占用名额。

---

## ⚙️ 脚本配置项 (Script Settings)

在 ScriptCat / 油猴脚本设置面板中可配置以下参数：

| 配置参数名 | 中文标签 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `Config.tab_limit_list` | 标签数量限制规则 (多个用换行区分) | 多行文本 (`textarea`) | 见下文示例 | 标签限制规则列表。每行一条：`URL 通配符 上限数 new/old`。 |

### 规则语法与示例

```text
# 1. 保留最旧 2 个 dashboard 标签（适合主标签常驻场景）
https://rewards.bing.com/dashboard 2 old

# 2. 保留最新 5 个 bing 搜索标签（适合搜索会话保留场景）
https://*.bing.com/search* 5 new

# 3. 通配符匹配所有子域下的特定路径
https://*.example.com/dashboard/* 3 old

# 4. 含查询参数的 URL 通配
https://example.com/page?id=* 1 new
```

### 保留策略说明

| 模式 | 行为 | 适用场景 |
| :--- | :--- | :--- |
| `new` | 保留**最新** N 个标签，关闭最旧的标签 | 搜索历史、会话保留，避免大量旧标签堆积 |
| `old` | 保留**最旧** N 个标签，关闭新开的标签 | 主标签常驻，自动关新开的重复标签 |

> 同一 URL 多条规则时：`limit` 取最小值（最严格），`mode` 取首条规则的值。

---

## 📋 脚本权限说明 (UserScript Metadata)

```javascript
// @grant        window.close                  // 调用浏览器关闭标签页 API
// @grant        GM_getValue                   // 读取标签限制规则
// @grant        GM_setValue                   // 跨域事件广播与配置存储
// @grant        GM_addValueChangeListener     // 跨子域实时事件监听
// @grant        GM_removeValueChangeListener  // 资源注销与清理
// @grant        unsafeWindow                  // 访问页面原生 BroadcastChannel 与 localStorage
// @match        http*://*/*                   // 全局匹配
// @run-at       document-start                // 最早时机介入，减少加载开销
// @noframes                                   // 禁止在 iframe 子框架内重复触发
```

---

## 📄 开源协议 (License)

本项目基于 [MIT License](https://opensource.org/licenses/MIT) 开源。
