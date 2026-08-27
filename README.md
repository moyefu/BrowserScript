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
| [**WebSnapshotManager**](./WebSnapshotManager) <br> **网站快照存储与恢复助手** | `v1.4.3` | 通用全站 | Cookie（全量/HttpOnly）、LocalStorage、SessionStorage 一键捕获；AES-GCM 硬件级加密与 Trusted Types 严格 CSP 兼容；GitHub Gist 云同步；二维码生成展示/分片轮播/扫码识别恢复；多账号极速切换与跨设备导入导出。 | [查看文档](./WebSnapshotManager/README.md) |
| [**AiAgent**](./AiAgent) <br> **ScriptCat Agent 悬浮聊天窗** | `v1.15.0` | **ScriptCat Beta** *(必须)* | 悬浮球式可拖拽 AI 聊天窗；ScriptCat 原生 Agent API 驱动（需 Beta 版）；流式对话、模型切换、多会话管理与白名单站点控制。 | [查看文档](./AiAgent/README.md) |
| [**CpaToGrok2Api**](./CpaToGrok2Api) <br> **Grok CPA 转 Grok2Api Json** | `v0.1.0` | CPA 站点 | 自动感知 CPA 登录状态；实时并发检测 xAI 账号额度；纯前端原生解析 JWT Payload；一键转换并批量导出标准 Grok2Api JSON。 | [查看文档](./CpaToGrok2Api/README.md) |
| [**BlockWebsites**](./BlockWebsites) <br> **禁止打开的网页 (防沉迷)** | `v0.4.0` | 通用全站 | 灵活的网址通配符匹配；支持 `(HH-HH)`、`(HH:MM-HH:MM)`、`(HH:MM:SS-HH:MM:SS)` 多精度时间段限制；秒级自动关闭网页与降级拦截屏。 | [查看文档](./BlockWebsites/README.md) |

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
1. 打开扩展管理器的 **「管理面板」** -> **「新建脚本 / 添加脚本」**。
2. 进入对应脚本目录，复制 `index.user.js` 的完整代码。
3. 粘贴至编辑器中并保存，脚本即可随匹配网页自动加载运行。
4. 如需自定义参数，可在扩展管理器的「设置 / 用户配置」面板中修改。

---

## 📂 项目结构 (Repository Structure)

```text
.
├── README.md                     # 项目主仓库说明文档
├── AiAgent/                      # ScriptCat Agent 悬浮聊天窗
│   ├── index.user.js        # 脚本源码
│   ├── README.md                 # 详细特性与使用说明
│   └── UPDATE.md                 # 版本更新日志
├── BlockWebsites/                # 禁止打开的网页（防沉迷与时间段限制）
│   ├── index.user.js        # 脚本源码
│   ├── README.md                 # 规则语法与时间段配置说明
│   └── UPDATE.md                 # 版本更新日志
├── CpaToGrok2Api/                # Grok CPA 转 Grok2Api Json
│   ├── index.user.js        # 脚本源码
│   ├── README.md                 # API 调用、JWT 转换与导出说明
│   └── UPDATE.md                 # 版本更新日志
└── WebSnapshotManager/           # 网站快照存储与恢复助手
    ├── index.user.js        # 脚本源码
    ├── logo.gif                  # 标志图
    ├── README.md                 # 安全加密、存储与恢复指南
    └── UPDATE.md                 # 版本更新日志
```

---

## 📄 开源协议 (License)

本项目各子脚本均基于 [MIT License](https://opensource.org/licenses/MIT) 开源，欢迎自由使用、学习与修改。
