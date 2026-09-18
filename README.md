<div align="center">
  <h1>🐱 ScriptCat & Tampermonkey 用户脚本合集</h1>
  <p><strong>精选高效、现代化、注重体验的浏览器用户脚本套件</strong></p>
  <p>
    <img src="https://img.shields.io/badge/ScriptCat-Supported-orange?style=flat-square&logo=javascript" alt="ScriptCat" />
    <img src="https://img.shields.io/badge/Tampermonkey-Supported-green?style=flat-square&logo=tampermonkey" alt="Tampermonkey" />
    <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License" />
  </p>
</div>

---

## 📖 项目简介 (Overview)

本项目收录了一系列面向 **ScriptCat（脚本猫）** 与 **Tampermonkey（油猴）** 开发的高质量用户脚本，涵盖网站快照与多账号凭证管理、AI 悬浮助手、OAuth 凭据转换导出、防沉迷网址拦截等实用场景。

每个子项目均采用独立模块化架构，配备专属的脚本源码、详尽使用文档（`README.md`）与语义化更新日志（`UPDATE.md`）。

---

## 📦 脚本列表与速览 (Scripts Directory)

| 目录 / 脚本名称 | 当前版本 | 适用环境 | 核心功能速览 | 详细文档 |
| :--- | :--- | :--- | :--- | :--- |
| [**WebSnapshotManager**](./WebSnapshotManager) <br> **网站快照存储与恢复助手** | `v1.5.0` | 通用全站 | Cookie（全量/HttpOnly/标准化消除带点差异）、LocalStorage、SessionStorage 一键捕获与精准还原；动态合成 URL 彻底清空与可选范围抽屉；原生 CompressionStream 透明无损压缩（体积直降 90%）；AES-GCM 硬件级加密与 Trusted Types 严格 CSP 兼容；GitHub Gist 高容错容灾云同步与防打扰空闲自动同步；二维码分片轮播与扫码识别；非目标站点 0 开销静默运行。 | [查看文档](./WebSnapshotManager/README.md) |
| [**AiAgent**](./AiAgent) <br> **ScriptCat Agent 悬浮聊天窗** | `v1.15.0` | **ScriptCat Beta** *(必须)* | 悬浮球式可拖拽 AI 聊天窗；ScriptCat 原生 Agent API 驱动（需 Beta 版）；流式对话、模型切换、多会话管理与白名单站点控制。 | [查看文档](./AiAgent/README.md) |
| [**CpaToGrok2Api**](./CpaToGrok2Api) <br> **Grok CPA 转 Grok2Api Json** | `v0.1.0` | CPA 站点 | 自动感知 CPA 登录状态；实时并发检测 xAI 账号额度；纯前端原生解析 JWT Payload；一键转换并批量导出标准 Grok2Api JSON。 | [查看文档](./CpaToGrok2Api/README.md) |
| [**BlockWebsites**](./BlockWebsites) <br> **禁止打开的网页 (防沉迷)** | `v0.4.0` | 通用全站 | 灵活的网址通配符匹配；支持 `(HH-HH)`、`(HH:MM-HH:MM)`、`(HH:MM:SS-HH:MM:SS)` 多精度时间段限制；秒级自动关闭网页与降级拦截屏。 | [查看文档](./BlockWebsites/README.md) |
| [**TabLimit**](./TabLimit) <br> **标签数量限制** | `v0.2.0` | 通用全站 | 按规则维护标签登记表；支持 `new` / `old` 双模式保留策略；`new` 模式 `setInterval` 持续监听，`old` 模式打开时一次判定；超出上限的标签自动关闭。 | [查看文档](./TabLimit/README.md) |

---

## 🚀 安装与使用 (Installation)

### 1. 准备环境
确保你的浏览器已安装以下扩展管理器：
- [ScriptCat (脚本猫) 官方主页](https://scriptcat.org/)
- **[ScriptCat Beta (脚本猫测试版)](https://docs.scriptcat.org/docs/use/use/)** *(⚠️ **AiAgent 脚本必须使用 Beta 版**，其他脚本兼容稳定版)*：
  - [Chrome Beta 商店](https://chromewebstore.google.com/detail/%E8%84%9A%E6%9C%AC%E7%8C%AB-beta/jaehimmlecjmebpekkipmpmbpfhdacom?authuser=0&hl=zh-CN)
  - [Edge Beta 商店](https://microsoftedge.microsoft.com/addons/detail/scriptcat-beta/nimmbghgpcjmeniofmpdfkofcedcjpfi)
  - [Firefox Beta 商店](https://addons.mozilla.org/zh-CN/firefox/addon/scriptcat-pre/)
- [Tampermonkey (油猴)](https://www.tampermonkey.net/) *(支持除 AiAgent 外的大多数通用脚本)*

### 2. 导入与运行
- **方式一：通过 GitHub Releases 一键安装（推荐）**  
  前往 [Releases 页面](https://github.com/moyefu/BrowserScript/releases)，直接点击各项目的 `.min.user.js`（如 `AiAgent.min.user.js`、`WebSnapshotManager.min.user.js`），油猴/脚本猫插件将自动弹出安装界面，点击确认即可一键安装。
- **方式二：手动复制源码**  
  1. 打开扩展管理器的 **「管理面板」** -> **「新建脚本 / 添加脚本」**。
  2. 进入对应子项目目录，复制 `index.user.js` 的完整代码。
  3. 粘贴至编辑器中并保存，脚本即可随匹配网页自动加载运行。
  4. 如需自定义参数，可在扩展管理器的「设置 / 用户配置」面板中修改。

---

## 🛠️ 本地构建与自动发布 (Build & Release)

### 1. 本地打包与压缩
本项目根目录提供统一构建工具，能自动扫描所有子项目、保留油猴元数据头并使用 Terser 深度压缩：
```bash
# 安装依赖
npm install

# 扫描并压缩所有子项目的 index.user.js
npm run build
```
压缩产物将集中输出至 `dist/<项目名>.min.user.js`（体积减小约 30% ~ 55%）。

### 2. GitHub 自动化发布
仓库已配置 GitHub Actions 自动化工作流（`.github/workflows/release.yml`）：
- **推送 Tag 自动发布**：
  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```
  GitHub Actions 将自动执行全量构建、压缩脚本并生成对应的 GitHub Release 附件供一键安装。
- **网页手动发布**：可在 GitHub 仓库的 **Actions** -> **Release UserScripts** 页面点击 **Run workflow** 手动触发。

---

## 📂 项目结构 (Repository Structure)

```text
.
├── .github/workflows/           # GitHub Actions 自动化工作流
│   └── release.yml              # Tag 触发与一键压缩发布 Release 工作流
├── scripts/                      # 仓库级构建脚本
│   └── build.js                 # 自动扫描并使用 Terser 压缩各项目脚本
├── package.json                 # 根目录依赖与构建脚本配置
├── README.md                    # 项目主仓库说明文档
├── AiAgent/                     # ScriptCat Agent 悬浮聊天窗
│   ├── index.user.js            # 脚本源码
│   ├── README.md                # 详细特性与使用说明
│   └── UPDATE.md                # 版本更新日志
├── BlockWebsites/               # 禁止打开的网页（防沉迷与时间段限制）
│   ├── index.user.js            # 脚本源码
│   ├── README.md                # 规则语法与时间段配置说明
│   └── UPDATE.md                # 版本更新日志
├── CpaToGrok2Api/               # Grok CPA 转 Grok2Api Json
│   ├── index.user.js            # 脚本源码
│   ├── README.md                # API 调用、JWT 转换与导出说明
│   └── UPDATE.md                # 版本更新日志
├── TabLimit/                    # 标签数量限制
│   ├── index.user.js            # 脚本源码
│   ├── README.md                # 规则语法与保留策略说明
│   └── UPDATE.md                # 版本更新日志
└── WebSnapshotManager/          # 网站快照存储与恢复助手
    ├── src/                     # 模块化工程源码
    │   ├── meta.js              # 脚本元数据头、UserConfig 配置与 CSP Trusted Types 策略
    │   ├── theme.js             # ThemeEngine 主题系统与官方/自定义主题导入导出
    │   ├── compress.js          # CompressionEngine 原生 CompressionStream 无损压缩引擎
    │   ├── crypto.js            # CryptoEngine AES-GCM 256 位加密与多版本密钥派生
    │   ├── session.js           # SessionManager Cookie 标准化采集/恢复分流/精准合成 URL 彻底清除
    │   ├── db.js                # DB 多域名快照存储、版本控制与墓碑防复活机制
    │   ├── gist.js              # GistSyncEngine GitHub Gist 双向云同步与防打扰空闲监听
    │   ├── ui.js                # LSM_UI 界面、悬浮球、设置窗口、主题编辑器、分片 QR 码
    │   └── main.js              # 域名白名单/黑名单短路拦截、菜单命令与生命周期启动器
    ├── build.js                 # 零依赖一键打包构建脚本 (node build.js)
    ├── package.json             # 极速打包构建配置 (npm run build)
    ├── index.user.js            # 构建生成的单文件发布脚本 (8500+ 行)
    ├── logo.gif                 # 标志图
    ├── README.md                # 安全加密、存储与恢复指南
    └── UPDATE.md                # 版本更新日志
```

---

## 📄 开源协议 (License)

本项目各子脚本均基于 [MIT License](https://opensource.org/licenses/MIT) 开源，欢迎自由使用、学习与修改。
