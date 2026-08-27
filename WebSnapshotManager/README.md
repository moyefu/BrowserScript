<div align="center">
  <img src="./logo.gif" width="128" height="128" alt="Web Snapshot Manager Logo" />
  <h1>网站快照存储与恢复助手</h1>
  <p><strong>Web Snapshot Manager</strong></p>
  <p>一款专为 <strong>ScriptCat（脚本猫）</strong> 与 <strong>Tampermonkey（油猴）</strong> 开发的现代化网页快照凭证（Cookie / LocalStorage / SessionStorage）一键捕获、高强度对称加密存储、多账号切换管理与跨环境导入导出工具。</p>
</div>

---

## 🌟 核心特性

### 1. 🔐 全维度快照捕获与恢复
- **Cookie 全量与并发加速**：优先调用 `GM_cookie` API 获取全量（含 `HttpOnly`、`SameSite`、子域名及 Path 限制）Cookie，并在无权限时自动平滑降级为 `document.cookie`；读写与清空采用 `Promise.all` 批量并发处理，秒级极速还原。
- **Storage 完整还原**：同步捕获当前站点的 `localStorage` 与 `sessionStorage` 完整键值对。
- **原子化数据切换**：在恢复目标快照前，会自动彻底清空旧凭据的所有 Cookie 与 Storage，避免不同快照互相污染导致串号或异常。
- **智能跳转回保存页**：保存快照时自动记录来源页面 URL（`location.href`），恢复成功后可智能跳转或刷新回保存时的页面。

### 2. 🛡️ 硬件级加密安全与跨端流转
- **Web Crypto API 对称加密**：采用现代密码学标准 **AES-GCM (256-bit)** + **PBKDF2** 密钥派生算法。
- **高兼容跨端解密体系**：采用解耦客户端环境的稳定密钥派生体系，不仅彻底解决跨设备、跨浏览器导入备份无法解密的问题，同时内置旧版本快照平滑向下兼容。
- **内存安全擦除**：在完成加解密后立即调用 `wipeMemory` 擦除内存中残留的明文凭据对象。

### 3. 🎨 结构化 JSON 主题系统与自定义导入/导出
- **解耦式 JSON 主题架构 (`ThemeEngine`)**：
  - 将全部色彩、材质、边框、圆角及字体规范解耦封装为标准化 `LSM_THEME` JSON 格式，全面使用 Shadow DOM CSS 变量（`--lsm-*`）驱动；
  - **默认初始配置**：默认采用 **Yohaku (余白)** 风格（梅红 `#c56473` + 日式米白纸张 `#faf9f5`），同时内置 5 款精美官方预设（🌸 余白 / 🔷 经典科技蓝 / 🌑 曜石暗夜 / 🌸 春櫻粉紫 / 🍵 宇治抹茶）；
  - **0 延迟实时换肤**：切换主题瞬间动态注入 CSS 变量，无需刷新页面，0 闪烁立即生效。
- **自定义主题导入/导出与微调**：
  - **📤 导出主题 (JSON)**：一键将当前主题打包导出为 `.json` 配置文件或复制 JSON 到剪贴板；
  - **📥 导入主题 (JSON)**：支持选择本地 `.json` 文件或粘贴 JSON 代码导入，自动校验 Schema、容错补全缺失字段并即时生效；
  - **✏️ 配色微调与新建**：支持在抽屉内可视化调色（主强调色、纸张底色、顶栏底色），一键保存为新主题；
  - **🔄 一键恢复默认**：任何时候一键切回 Yohaku 初始默认主题。
- **全端自适应与滚动防穿透**：
  - **Shadow DOM 样式隔离**：与目标网页 CSS 100% 互不干扰；
  - **悬浮球边缘吸附与呼吸感**：松手自动平滑吸附到最近屏幕边缘，空闲时呼吸半透明；
  - **移动端与小屏响应式适配**：手机与平板端流式排版，按钮自动紧凑排布不折行；
  - **双重滚动防穿透**：CSS `overscroll-behavior: contain` + 精确 JS 触摸/滚轮拦截。
- **高性能与高兼容底层**：
  - **PBKDF2 派生密钥内存池**：避免高频操作下的 CPU 阻塞，加解密毫秒级响应。
  - **全属性 Cookie 同步**：完整支持 `SameSite`（`None` / `Lax` / `Strict`）与 `Secure` 属性回写。
  - **SPA 单页路由感知**：动态捕获 Vue/React 等单页应用的无刷新 URL 路径。
  - **快照体积预估**：保存时计算总大小并在超大时给出预警。

### 4. 📷 二维码生成/扫码流转与全场景快照导入
- **快照转二维码展示与低密度分片轮播播放**：
  - 快照卡片新增「二维码」按钮，点击滑出专属二维码抽屉弹窗。
  - 基于纯原生 Canvas + `qrcode-generator` 动态渲染快照离线二维码，支持一键「下载图片 (PNG)」与「复制数据 (JSON)」，方便跨设备扫码传递快照凭据。
  - **低密度高识读率分片轮播（500ms 一张）**：当快照数据体积超出单张二维码容量时，自动切片为 350 字符低密度稀疏二维码（Version 5~7，纠错等级 L），点阵清晰稀疏，识别成功率达 99%+，配合 500ms 循环轮播播放器流畅流转。
- **WASM 极速多线程扫码与大屏视口 HUD 接收**：
  - 工具栏与下拉菜单新增「扫码/导入」入口。
  - 具备 **350px 大尺寸高广角扫码视口** 与 **220px 激光取景框**，全幅取景更清晰。
  - **WASM 极速解码引擎 + 平滑降级机制**：默认优先使用基于 ZXing-C++ 编译的 **`zxing-wasm` WebAssembly 解码引擎**；若运行环境不支持 WASM 则自动无缝降级至 `jsQR` 与 `BarcodeDetector`，兼具顶级性能与 100% 兼容兜底。
  - **GC 内存抖动消除与多线程零阻塞**：在 Web Worker 独立工作线程中执行计算并通过 Transferable ArrayBuffer 零拷贝传递数据；加入 16~20 FPS 智能节流采样，彻底解决连续扫码时频繁创建 `ImageData` 引发的 V8 垃圾回收周期性卡顿。
  - **分片实时接收 HUD 矩阵**：识别到分片时自动保持镜头开启持续扫描，支持任意乱序捕捉；底部独立毛玻璃 HUD 矩阵实时点亮已接收分片 Chip（带 Pop 动效与翠绿光晕），全部分片齐全后自动拼接重组为完整快照。
  - 严格管理摄像头流生命周期（识别成功、关闭抽屉、ESC 退出时自动释放设备轨道）。
- **图片二维码与 JSON 文件识别**：
  - 扫码抽屉提供「图片识别二维码」和「JSON 文件导入」两种备选渠道，支持文件选择与拖拽（Drag & Drop）直接解析。
- **解析结果双向操作**：
  - 识别成功后清晰展示快照名称、来源域名、凭据指标统计及跨域名安全警告。
  - 支持 **「🚀 立即解密并恢复当前页面」**（直接应用快照并跳转/刷新）与 **「📥 导入并保存到快照列表」**（持久化至本地存储库）。

### 5. � 灵活的数据导入/导出与剪贴板极速流转
- **剪贴板免文件快速流转**：支持单条快照一键复制至剪贴板，以及通过「从剪贴板恢复(免文件)」实现秒级跨浏览器/跨设备恢复。
- **智能去重导入**：导入快照时自动比对加密数据指纹，已存在的重复记录自动跳过，提供清晰的状态反馈。
- **批量导出/导入**：一键将当前站点的所有快照档案导出为结构化 JSON 文件或批量追加导入。
- **单条记录导出**：可导出单条快照文件，便于与他人共享或跨浏览器迁移。
- **从文件恢复（不导入）**：支持直接选取外部 JSON 文件立即还原快照并生效，无需将数据写入本地持久化存储。
- **跨站点智能提示**：当导入或恢复非本网站的快照备份时，会自动提示来源站点并供用户二次确认。

---

## ⚙️ 脚本配置项 (Script Settings)

在 ScriptCat / 油猴脚本的「配置」或设置面板中，可自定义以下选项：

| 配置参数名 | 中文标签 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `Config.filter_mode` | 域名过滤模式 | 下拉单选 (`select`) | `whitelist` | 支持 **白名单模式** (`whitelist`，仅对列表中的网站生效) 与 **黑名单模式** (`blacklist`，对除列表中之外的所有网站生效)。 |
| `Config.host_list` | 域名列表 (每行一条) | 多行文本 (`textarea`) | `""` (空) | 匹配的域名与 URL 规则列表。支持完整 URL、域名或带 `*` 的通配符（如 `*.example.com` 或 `https://*.baidu.com*`）。每行一条。 |
| `Config.enable_encryption` | 本地数据加密 | 布尔开关 (`checkbox`) | `true` | 启用 AES-GCM 256 位本地数据加密存储。 |
| `Config.auto_reload_after_restore`| 恢复后直接刷新/跳转 | 布尔开关 (`checkbox`) | `false` | 恢复快照成功后直接刷新或跳转至来源页面（不再弹窗确认）。 |

---

## 🚀 界面与交互指南

### 1. 悬浮球 (Floating Ball)
- **点击**：快速展开「快照管理」主窗口。
- **拖拽**：在页面任意位置按住拖动，松手后会自动持久化记忆当前站点的位置。
- **右上角 `×` 菜单**：悬浮在悬浮球上会出现微型操作按钮，点击可弹出快捷操作：
  - 打开快照管理窗口
  - 一键加密保存当前快照
  - 临时隐藏悬浮球（本次会话隐藏，刷新后恢复）
  - 永久关闭（从显示白名单中移除当前站点）

### 2. 管理窗口工具栏
- **一键保存**：弹出抽屉面板，实时扫描当前页面的 Cookie 与 Storage 数量，输入名称后即可加密保存（支持回车确认与自动聚焦）。
- **扫码/导入**：调起多功能导入抽屉，支持摄像头扫码、图片二维码识别与 JSON 快照文件解析。
- **清空数据**：一键清空当前站点的所有 Cookie 及 Local/SessionStorage，快速回到干净未登录状态。
- **刷新**：快速刷新当前页面。
- **搜索过滤框**：即时检索快照名称、创建时间或来源 URL。
- **`⋮` 更多操作下拉菜单**：
  - **扫码/文件导入**：快捷打开扫码与文件导入面板。
  - **批量导出记录**：将当前站点所有记录打包导出为 `.json` 文件。
  - **批量导入记录**：选择 JSON 文件批量追加到当前站点（智能去重）。
  - **从文件恢复(不导入)**：选择 JSON 文件立即恢复到浏览器并刷新，不写入脚本管理器存储。
  - **从剪贴板恢复(免文件)**：读取剪贴板快照 JSON 文本立即解密并恢复，跨端无缝流转。
  - **全局 Ctrl+V / Paste**：在快照管理窗口打开时直接按 `Ctrl+V` 粘贴快照数据，脚本会自动识别并弹出快速恢复确认（避免日常网页浏览误拦截）。

### 3. 凭据记录卡片
- **一键恢复**：彻底清理旧数据后载入该记录的凭据，标记为当前生效，并自动刷新或跳转至保存时的页面。
- **二维码**：动态生成该快照的专属二维码，支持手机扫码直接还原或下载 PNG 备份。
- **复制**：一键复制加密快照至剪贴板，方便跨设备/跨浏览器直接恢复。
- **导出**：导出当前单条快照为独立的 `.json` 文件。
- **重命名**：修改记录名称。
- **删除**：移除单条记录。

### 4. 扩展菜单集成 (GM Menu)
点击浏览器扩展栏的 ScriptCat / 油猴图标，支持以下 **5 大快捷菜单指令**，特别方便 Tampermonkey 等不支持后台动态表单配置的环境：

1. **🔑 快照管理助手**：
   - **若当前站点未激活（被黑/白名单规则拦截）**：可选择「临时显示（仅本次生效）」或「永久开启（白名单加入/黑名单移出）」。
   - **若当前站点已激活**：可直接调出管理窗口，或进行临时隐藏悬浮球、永久关闭（白名单移除/黑名单加入）。
2. **🛡️ 切换黑/白名单模式**：
   - 动态展示当前是「白名单」还是「黑名单」模式，点击弹出确认窗一键无缝切换模式并刷新应用。
3. **📝 编辑域名规则列表 (黑/白名单)**：
   - 弹出大号编辑文本框，自由增删修改规则，支持通配符 `*`，并内置「+ 添加当前网站」快捷键。
4. **🔒 本地数据加密设置**：
   - 动态感知当前是「已加密」还是「未加密」，点击弹出提示窗一键开启或关闭 AES-GCM 256 位加密存储。
5. **🔄 恢复后自动刷新设置**：
   - 动态感知当前是「自动刷新/跳转」还是「不默认刷新」，点击弹出提示窗一键切换刷新行为。

---

## 🔒 备份数据格式 (JSON 结构规范)

### 单条记录结构 (Single Record)
```json
{
  "type": "LSM_SINGLE_EXPORT",
  "version": "1.0",
  "domain": "example.com",
  "exportTime": 1771747200000,
  "record": {
    "id": "lsm_1771747200000_abc123",
    "name": "测试快照1",
    "createdAt": 1771747200000,
    "domain": "example.com",
    "url": "https://example.com/user/center",
    "summary": {
      "cookieCount": 8,
      "localCount": 15,
      "sessionCount": 2
    },
    "cipherData": {
      "encrypted": true,
      "iv": "base64...",
      "salt": "base64...",
      "ciphertext": "base64..."
    }
  }
}
```

### 批量记录结构 (Batch Records)
```json
{
  "type": "LSM_BATCH_EXPORT",
  "version": "1.0",
  "domain": "example.com",
  "exportTime": 1771747200000,
  "count": 2,
  "records": [ ... ]
}
```

### 🎨 主题配置 JSON 结构 (Theme Package)
```json
{
  "type": "LSM_THEME",
  "version": "1.0.0",
  "id": "custom_theme_id",
  "name": "自定义主题名称",
  "description": "主题简要描述",
  "tokens": {
    "accent": "#c56473",
    "accentBg": "rgba(197, 100, 115, 0.08)",
    "accentBorder": "rgba(197, 100, 115, 0.3)",
    "accentHoverBg": "rgba(197, 100, 115, 0.14)",
    "accentGlow": "rgba(197, 100, 115, 0.12)",
    "bgPaper": "#faf9f5",
    "bgHeader": "#f0efeb",
    "bgCard": "#ffffff",
    "bgList": "#f9f8f5",
    "bgHover": "#f0efeb",
    "borderLight": "#e3e1db",
    "borderHover": "#d0cec6",
    "textPrimary": "#24231f",
    "textSecondary": "#5c5a55",
    "textMuted": "#787670",
    "textPlaceholder": "#a8a69f",
    "colorSuccess": "#5e9f7e",
    "colorWarning": "#a87a3d",
    "colorInfo": "#3d6896",
    "colorDanger": "#a64953",
    "fontFamily": "system-ui, -apple-system, sans-serif",
    "radiusWindow": "16px",
    "radiusCard": "12px",
    "radiusBtn": "8px"
  }
}
```

---

## 📋 脚本权限说明 (UserScript Metadata)

```javascript
// @grant        GM_setValue           // 持久化存储记录与配置
// @grant        GM_getValue           // 读取记录与配置
// @grant        GM_deleteValue        // 清除旧存储数据
// @grant        GM_listValues         // 获取存储键列表
// @grant        GM_registerMenuCommand// 注册扩展插件菜单
// @grant        GM_cookie             // 获取/设置全量 Cookie（包括 HttpOnly）
// @grant        GM_setClipboard       // 剪贴板操作
// @require      https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js // 二维码生成
// @require      https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js         // 二维码解码
// @license      MIT                   // 开源许可证
// @run-at       document-idle         // 在页面空闲时启动
```

---

## 📄 开源协议 (License)

本项目基于 [MIT License](https://opensource.org/licenses/MIT) 开源。
