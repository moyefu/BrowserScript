// ==UserScript==
// @name         Grok CPA 转 Grok2Api Json
// @namespace    https://docs.scriptcat.org/
// @version      0.1.0
// @description  Grok CPA 转 Grok2Api Json
// @author       MOYEFU
// @match        *cpa.local/moyefu*
// @grant        GM_getValue
// @grant        GM_setValue
// @tag          MYF
// @noframes
// ==/UserScript==

/* ==UserConfig==
Config:
    password:
        title: 密码
        type: text
        default: 12345678
==/UserConfig== */

(function () {
    'use strict';

    console.error('脚本加载成功');

    // Your code here...
    (function checkLogin() {
        // 检测当前url是否包含#login
        if (!window.location.href.includes('login')) {
            setTimeout(() => {
                if (!window.location.href.includes('login')) {
                    console.log(window.location.href);
                    init();
                } else {
                    checkLogin();
                }
            }, 500);
        } else {
            console.log('等待登录');
            setTimeout(() => {
                checkLogin();
            }, 300);
        }
    })();

    

    function init() {
        console.log('登录成功');
        // 在右下角生成悬浮按钮
        const btn = document.createElement('button');
        btn.textContent = 'OAuth列表';
        btn.style.position = 'fixed';
        btn.style.bottom = '20px';
        btn.style.right = '20px';
        btn.style.zIndex = '9999';
        document.body.appendChild(btn);
        // 点击事件
        btn.addEventListener('click', () => {
            const isOpen = panel.style.display === 'flex';
            panel.style.display = isOpen ? 'none' : 'flex';
            if (!isOpen) loadList();
        });

        // ============ 注入样式（集中管理，替代散落的行内 style） ============
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            .gcpa-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:720px;max-height:80vh;background:#1a1a2e;color:#fff;border-radius:12px;z-index:10000;display:none;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden}
            .gcpa-header{padding:16px 20px;background:#16213e;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333}
            .gcpa-title{font-size:18px;font-weight:bold}
            .gcpa-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer}
            .gcpa-toolbar{padding:10px 20px;background:#0f3460;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
            .gcpa-toolbar>label{font-size:13px;margin-right:10px;cursor:pointer;display:flex;align-items:center;gap:4px}
            .gcpa-btn{padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-size:13px}
            .gcpa-btn-green{background:#4caf50;color:#fff}
            .gcpa-btn-cyan{background:#00d4ff;color:#000}
            .gcpa-btn-orange{background:#ff9800;color:#000}
            .gcpa-btn:disabled,.gcpa-export:disabled{opacity:.6;cursor:not-allowed}
            .gcpa-th{padding:10px 20px;background:#0a1929;display:grid;grid-template-columns:30px 1fr 80px 100px;gap:10px;font-weight:bold;font-size:13px;border-bottom:1px solid #333;align-items:center}
            .gcpa-list{flex:1;overflow-y:auto;padding:10px 0}
            .gcpa-row{padding:12px 20px;display:grid;grid-template-columns:30px 1fr 80px 100px;gap:10px;align-items:center;border-bottom:1px solid #222;transition:background .2s}
            .gcpa-row:hover{background:#1a2744}
            .gcpa-email{font-size:14px}
            .gcpa-status{font-size:12px;padding:3px 8px;border-radius:10px;background:#666;color:#fff;text-align:center}
            .gcpa-status.normal{background:#4caf50}
            .gcpa-status.error{background:#f44336}
            .gcpa-export{padding:5px 10px;background:#00bcd4;color:#000;border:none;border-radius:4px;cursor:pointer;font-size:12px}
            .gcpa-empty{padding:20px;text-align:center;color:#888}
        `;
        document.head.appendChild(styleEl);

        // ============ 面板 DOM 构建 ============
        const panel = document.createElement('div');
        panel.className = 'gcpa-panel';

        // 头部
        const panelHeader = document.createElement('div');
        panelHeader.className = 'gcpa-header';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'gcpa-title';
        titleSpan.textContent = 'Grok CPA 列表';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'gcpa-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => panel.style.display = 'none');
        panelHeader.append(titleSpan, closeBtn);

        // 工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'gcpa-toolbar';

        // 全选（用 label 包裹，点击文字即可切换）
        const selectAllLabel = document.createElement('label');
        selectAllLabel.className = 'gcpa-select-all-label';
        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        selectAllLabel.append(selectAllCheckbox, document.createTextNode('全选'));

        // 按钮工厂 —— 消除重复的创建代码
        const createBtn = (text, cls, onClick) => {
            const b = document.createElement('button');
            b.textContent = text;
            b.className = `gcpa-btn ${cls}`;
            b.addEventListener('click', onClick);
            return b;
        };

        // 异步操作时显示加载状态
        const withLoading = async (btn, fn) => {
            const oldText = btn.textContent;
            btn.textContent = '处理中...';
            btn.disabled = true;
            try {
                await fn();
            } finally {
                btn.textContent = oldText;
                btn.disabled = false;
            }
        };

        const refreshStatusBtn = createBtn('刷新状态', 'gcpa-btn-green', () => withLoading(refreshStatusBtn, () => loadList()));
        const exportSelectedBtn = createBtn('导出选中', 'gcpa-btn-cyan', () => withLoading(exportSelectedBtn, async () => {
            const items = getSelectedItems();
            if (items.length) await exportItems(items);
        }));
        const exportAllBtn = createBtn('导出全部', 'gcpa-btn-orange', () => withLoading(exportAllBtn, async () => {
            if (currentList.length) await exportItems(currentList);
        }));

        toolbar.append(selectAllLabel, refreshStatusBtn, exportSelectedBtn, exportAllBtn);

        // 表头
        const tableHeader = document.createElement('div');
        tableHeader.className = 'gcpa-th';
        tableHeader.innerHTML = '<span></span><span>邮箱</span><span>状态</span><span>操作</span>';

        // 列表容器（事件委托：点击导出按钮时从 dataset 取索引，无需为每行单独绑定）
        const listContainer = document.createElement('div');
        listContainer.className = 'gcpa-list';
        listContainer.addEventListener('click', (e) => {
            const exportBtn = e.target.closest('.gcpa-export');
            if (!exportBtn) return;
            const item = currentList[+exportBtn.dataset.index];
            if (item) withLoading(exportBtn, () => exportItem(item));
        });

        panel.append(panelHeader, toolbar, tableHeader, listContainer);
        document.body.appendChild(panel);

        // ============ 状态 ============
        let currentList = [];

        // ============ 数据加载 ============
        async function loadList() {
            listContainer.innerHTML = '<div class="gcpa-empty">加载中...</div>';
            selectAllCheckbox.checked = false;
            try {
                const list = await getOauthList();
                renderList(list);
            } catch (e) {
                console.error('加载列表失败:', e);
                listContainer.innerHTML = '<div class="gcpa-empty">加载失败</div>';
            }
        }

        // ============ 渲染列表 ============
        function renderList(list) {
            currentList = list || [];
            listContainer.innerHTML = '';
            selectAllCheckbox.checked = false;

            if (currentList.length === 0) {
                listContainer.innerHTML = '<div class="gcpa-empty">暂无数据</div>';
                return;
            }

            // 用 DocumentFragment 批量插入，减少回流
            const frag = document.createDocumentFragment();
            currentList.forEach((item, index) => {
                const row = document.createElement('div');
                row.className = 'gcpa-row';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.dataset.index = index;

                const emailSpan = document.createElement('span');
                emailSpan.className = 'gcpa-email';
                emailSpan.textContent = item.email || '未知';

                const statusSpan = document.createElement('span');
                statusSpan.className = 'gcpa-status';
                statusSpan.textContent = '检测中...';

                const exportBtn = document.createElement('button');
                exportBtn.className = 'gcpa-export';
                exportBtn.textContent = '导出';
                exportBtn.dataset.index = index;

                row.append(checkbox, emailSpan, statusSpan, exportBtn);
                frag.appendChild(row);

                // 异步获取额度并更新状态
                checkQuotaAsync(item, statusSpan);
            });
            listContainer.appendChild(frag);
        }

        // ============ 异步检查额度 ============
        async function checkQuotaAsync(item, statusSpan) {
            const setError = () => {
                statusSpan.textContent = '异常';
                statusSpan.className = 'gcpa-status error';
            };
            try {
                const result = await getQuota(item.auth_index || item.index);
                if (result && result !== false) {
                    statusSpan.textContent = '正常';
                    statusSpan.className = 'gcpa-status normal';
                } else {
                    setError();
                }
            } catch (e) {
                setError();
            }
        }

        // ============ 导出 ============
        function downloadJson(data, filename) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        }

        // 导出单项：获取配置 → 转换 → 下载
        async function exportItem(item) {
            const cpaJson = await getOauthConfig(item.name);
            if (!cpaJson) return;
            const grokJson = convertCpaToJson(cpaJson);
            if (!grokJson) return;
            downloadJson({ accounts: [grokJson] }, `${item.email || item.name || 'item'}.json`);
        }

        // 导出多项：并行获取配置 → 转换 → 汇总为 { accounts: [...] }
        async function exportItems(items) {
            const results = await Promise.allSettled(
                items.map(async (item) => {
                    const cpaJson = await getOauthConfig(item.name);
                    return cpaJson ? convertCpaToJson(cpaJson) : null;
                })
            );
            const accounts = results
                .filter(r => r.status === 'fulfilled' && r.value)
                .map(r => r.value);
            if (accounts.length === 0) return;
            downloadJson({ accounts }, `grok-cpa-${Date.now()}.json`);
        }

        // ============ 选中项 ============
        function getSelectedItems() {
            return Array.from(listContainer.querySelectorAll('.gcpa-row input[type=checkbox]:checked'))
                .map(cb => currentList[+cb.dataset.index])
                .filter(Boolean);
        }

        // ============ 全选事件 ============
        selectAllCheckbox.addEventListener('change', (e) => {
            listContainer.querySelectorAll('.gcpa-row input[type=checkbox]')
                .forEach(cb => cb.checked = e.target.checked);
        });
    }

    // 获取oauth列表
    function getOauthList() {

        const url = `${window.location.origin}/v0/management/auth-files`;
        const token = GM_getValue("Config.password");
        return fetch(url, {
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'authorization': `Bearer ${token}`,
                'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin'
            },
            referrer: window.location.href,
            body: null,
            method: 'GET',
            mode: 'cors',
            credentials: 'include'
        })
            .then(response => response.json())
            .then(data => {
                const files = data.files || [];
                const xaiResults = files.filter(file => file.type === 'xai');
                console.log('xai类型的oauth列表:', xaiResults);
                return xaiResults;
            })
            .catch(error => {
                console.error('获取oauth列表失败:', error);
                return [];
            });
    }

    // 刷新凭证
    function refreshToken(expired,name) {
        console.log('刷新凭证',expired,name);
        const url = `${window.location.origin}/v0/management/auth-files/fields`;
        const token = GM_getValue("Config.password");
        fetch(url, {
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'authorization': `Bearer ${token}`,
                'content-type': 'application/json',
                'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin'
            },
            referrer: window.location.href,
            body: JSON.stringify({ name, expired }),
            method: 'PATCH',
            mode: 'cors',
            credentials: 'include'
        })
            .then(response => response.json())
            .then(data => {
                console.log('刷新凭证成功:', data);
                return data;
            })
            .catch(error => {
                console.error('刷新凭证失败:', error);
                return null;
            });
    }

    // 获取额度
    function getQuota(auth_index) {
        console.log('获取额度',auth_index);
        const url = `${window.location.origin}/v0/management/api-call`;
        const token = GM_getValue("Config.password");
        return fetch(url, {
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'authorization': `Bearer ${token}`,
                'content-type': 'application/json',
                'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin'
            },
            referrer: window.location.href,
            body: JSON.stringify({
                authIndex: auth_index,
                method: 'GET',
                url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
                header: {
                    'Authorization': 'Bearer $TOKEN$',
                    'x-xai-token-auth': 'xai-grok-cli',
                    'x-grok-client-version': '0.2.91',
                    'accept': '*/*',
                    'user-agent': 'grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)'
                }
            }),
            method: 'POST',
            mode: 'cors',
            credentials: 'include'
        })
            .then(response => response.json())
            .then(data => {
                if (data.status_code !== 200) {
                    return false;
                }
                console.log('获取额度成功:', data);
                return data;
            })
            .catch(error => {
                console.error('获取额度失败:', error);
                return false;
            });
    }

    // 获取OAuth配置json
    function getOauthConfig(name) {
        console.log('获取OAuth配置',name);
        const url = `${window.location.origin}/v0/management/auth-files/download?name=${encodeURIComponent(name)}`;
        const token = GM_getValue("Config.password");
        return fetch(url, {
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'authorization': `Bearer ${token}`,
                'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin'
            },
            referrer: window.location.href,
            body: null,
            method: 'GET',
            mode: 'cors',
            credentials: 'include'
        })
            .then(response => response.json())
            .then(data => {
                console.log('获取OAuth配置成功:', data);
                return data;
            })
            .catch(error => {
                console.error('获取OAuth配置失败:', error);
                return null;
            });
    }

    // JWT 解码（解析 payload 部分，无外部依赖）
    function jwt_decode(token) {
        try {
            const payload = token.split('.')[1];
            const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
            const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            console.error('JWT 解码失败:', e);
            return {};
        }
    }

    // cpaJson转成grokJson
    function convertCpaToJson(cpaJson) {
        console.log('转换cpaJson', cpaJson);

        // jwt解析access_token
        const accessToken = cpaJson.access_token;
        if (!accessToken) {
            return null;
        }
        const decodedAccessToken = jwt_decode(accessToken);
        console.log('解析后的access_token:', decodedAccessToken);

        return {
            "provider": "grok_build",
            "name": cpaJson.email || "error",
            "client_id": decodedAccessToken.client_id || "",
            "access_token": accessToken,
            "refresh_token": cpaJson.refresh_token || "",
            "id_token": cpaJson.id_token || "",
            "token_type": "Bearer",
            "scope": "",
            "expires_at": "2029-12-30T15:15:55.189784106Z",
            "expires_in": 0,
            "email": cpaJson.email || "error",
            "sub": decodedAccessToken.sub || "",
            "user_id": decodedAccessToken.principal_id || "",
            "principal_id": decodedAccessToken.principal_id || "",
            "team_id": decodedAccessToken.team_id || ""
        };
    }


})();