// =========================================================================
// 🍪 Cookie & WebStorage 会话管理器 (SessionManager)
// 1. 标准化元数据：记录 hostOnly、partitionKey，规范化 domain 剥离前导点
// 2. 恢复精准分流：Host-Only 不传 domain（无前导点），Domain Cookie 规范传参
// 3. 精准合成 URL 清除：动态匹配 protocol/domain/path，彻底清除带点与特定路径 Cookie
// 4. 交互式范围支持：支持彻底清空生效域或仅限当前子域
// =========================================================================
const SessionManager = {
  hasGmCookie() {
    return (
      typeof GM_cookie !== "undefined" &&
      GM_cookie &&
      typeof GM_cookie.list === "function" &&
      typeof GM_cookie.set === "function"
    );
  },

  // 获取当前生效的 Cookie 列表（增强元数据与跨浏览器规范化）
  async getCookies() {
    if (this.hasGmCookie()) {
      return new Promise((resolve) => {
        try {
          GM_cookie.list({ url: location.href }, (cookies, error) => {
            if (error || !cookies || !Array.isArray(cookies)) {
              resolve(this.getDocumentCookies());
            } else {
              resolve(
                cookies.map((c) => {
                  const rawDomain = String(c.domain || "").trim();
                  const cleanDomain = (rawDomain || location.hostname).replace(/^\.+/, "");
                  // 精确判断是否为 Host-Only Cookie
                  const isHostOnly = c.hostOnly !== undefined
                    ? !!c.hostOnly
                    : (!rawDomain.startsWith(".") && (cleanDomain === location.hostname || !rawDomain));

                  return {
                    name: c.name,
                    value: c.value,
                    domain: cleanDomain,
                    hostOnly: isHostOnly,
                    path: c.path || "/",
                    secure: !!c.secure,
                    httpOnly: !!c.httpOnly,
                    sameSite: c.sameSite || "unspecified",
                    expirationDate: c.expirationDate,
                    partitionKey: c.partitionKey || null,
                    storeId: c.storeId || null
                  };
                })
              );
            }
          });
        } catch (e) {
          resolve(this.getDocumentCookies());
        }
      });
    }
    return this.getDocumentCookies();
  },

  // 降级使用 document.cookie 获取当前可见 Cookie
  getDocumentCookies() {
    const raw = document.cookie;
    if (!raw || !raw.trim()) return [];
    return raw
      .split(";")
      .map((pair) => {
        const idx = pair.indexOf("=");
        if (idx === -1) return null;
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (!name) return null;
        return {
          name,
          value,
          domain: location.hostname,
          hostOnly: true,
          path: "/",
          secure: location.protocol === "https:",
          httpOnly: false,
          sameSite: "unspecified",
          expirationDate: null,
          partitionKey: null
        };
      })
      .filter(Boolean);
  },

  getWebStorage() {
    const local = {};
    const session = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) local[key] = localStorage.getItem(key);
      }
    } catch (e) {}

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) session[key] = sessionStorage.getItem(key);
      }
    } catch (e) {}

    return { localStorage: local, sessionStorage: session };
  },

  async captureCurrentSession() {
    const cookies = await this.getCookies();
    const storage = this.getWebStorage();

    const sessionObj = {
      domain: location.hostname,
      url: location.href,
      timestamp: Date.now(),
      cookies: cookies,
      localStorage: storage.localStorage,
      sessionStorage: storage.sessionStorage
    };

    const approxBytes = new Blob([JSON.stringify(sessionObj)]).size;

    return {
      ...sessionObj,
      summary: {
        cookieCount: cookies.length,
        localCount: Object.keys(storage.localStorage).length,
        sessionCount: Object.keys(storage.sessionStorage).length,
        approxBytes: approxBytes
      }
    };
  },

  // 精准清除 Cookie（支持可选范围：彻底清空生效域 / 仅限当前子域）
  async clearCookies(options = {}) {
    const onlyCurrentHost = !!options.onlyCurrentHost;
    let cookieCount = 0;
    const hostname = location.hostname;
    const hostParts = hostname.split(".");

    if (this.hasGmCookie()) {
      try {
        // 1. 获取当前页面 URL 作用域下的 Cookie
        const cookiesByUrl = await new Promise((resolve) => {
          GM_cookie.list({ url: location.href }, (c, err) => {
            if (err || !c || !Array.isArray(c)) resolve([]);
            else resolve(c);
          });
        });

        // 2. 收集当前域名及所有合法父级域名（统一不带前导点，确保 Chromium 子域搜索生效）
        const domainList = [hostname];
        if (!onlyCurrentHost) {
          for (let i = 1; i < hostParts.length - 1; i++) {
            const parentDomain = hostParts.slice(i).join(".");
            if (parentDomain.includes(".")) {
              domainList.push(parentDomain);
            }
          }
        }

        const domainCookies = [];
        for (const d of Array.from(new Set(domainList))) {
          try {
            const list = await new Promise((resolve) => {
              GM_cookie.list({ domain: d }, (c, err) => {
                if (err || !c || !Array.isArray(c)) resolve([]);
                else resolve(c);
              });
            });
            if (Array.isArray(list)) domainCookies.push(...list);
          } catch (e) {}
        }

        // 合并去重
        const allCookiesMap = new Map();
        for (const c of [...cookiesByUrl, ...domainCookies]) {
          const rawDom = String(c.domain || "").trim();
          const cleanDom = (rawDom || hostname).replace(/^\.+/, "");
          
          // 如果指定仅清理当前子域，过滤掉属于父级泛域的 Cookie
          if (onlyCurrentHost && cleanDom !== hostname) {
            continue;
          }

          const path = c.path || "/";
          const key = `${c.name}___${cleanDom}___${path}`;
          if (!allCookiesMap.has(key)) {
            allCookiesMap.set(key, { ...c, cleanDomain: cleanDom, path: path });
          }
        }

        // 3. 为每一个 Cookie 动态合成绝对精准的目标 URL 进行删除
        const deletePromises = Array.from(allCookiesMap.values()).map((c) => {
          return new Promise(async (resolve) => {
            const isSecure = !!c.secure;
            const proto = isSecure ? "https:" : (location.protocol === "https:" ? "https:" : "http:");
            const path = c.path.startsWith("/") ? c.path : "/" + c.path;
            const targetUrl = `${proto}//${c.cleanDomain}${path}`;

            // 构建删除参数（兼容 Tampermonkey、ScriptCat 与 Violentmonkey）
            const delDetails = {
              url: targetUrl,
              name: c.name,
              domain: c.cleanDomain,
              path: c.path
            };
            if (c.storeId) delDetails.storeId = c.storeId;
            if (c.partitionKey) delDetails.partitionKey = c.partitionKey;

            let deleted = false;
            try {
              deleted = await new Promise((res) => {
                GM_cookie.delete(delDetails, (err) => {
                  res(!err);
                });
              });
            } catch (e) {}

            // 若使用合成 URL 删除未成功，发起多级补充尝试
            if (!deleted) {
              try {
                // 尝试当前 location.href
                await new Promise((res) => {
                  GM_cookie.delete({ url: location.href, name: c.name }, () => res());
                });
              } catch (e) {}

              // 若为 HTTPS 网站上的非 Secure Cookie 或反之，尝试协议对换
              if (location.protocol === "https:" && !isSecure) {
                try {
                  const httpUrl = `http://${c.cleanDomain}${path}`;
                  await new Promise((res) => {
                    GM_cookie.delete({ url: httpUrl, name: c.name }, () => res());
                  });
                } catch (e) {}
              }
            }

            cookieCount++;
            resolve();
          });
        });

        await Promise.all(deletePromises);
      } catch (e) {
        console.warn("[LSM Session] GM_cookie 清除异常:", e);
      }
    }

    // 4. document.cookie 全域多路径深度兜底清除
    try {
      const docCookies = this.getDocumentCookies();
      const testPaths = ["/", location.pathname];
      for (const c of docCookies) {
        const cleanName = encodeURIComponent(c.name);
        const expStr = "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0";

        for (const p of Array.from(new Set(testPaths))) {
          // 当前 Host-Only 清除
          document.cookie = `${cleanName}${expStr}; path=${p}`;
          document.cookie = `${cleanName}${expStr}; path=${p}; Secure`;

          // 当前域名清除（带点与不带点）
          document.cookie = `${cleanName}${expStr}; path=${p}; domain=${hostname}`;
          document.cookie = `${cleanName}${expStr}; path=${p}; domain=.${hostname}`;

          // 父级域名清除
          if (!onlyCurrentHost) {
            for (let i = 1; i < hostParts.length - 1; i++) {
              const domain = hostParts.slice(i).join(".");
              if (domain.includes(".")) {
                document.cookie = `${cleanName}${expStr}; path=${p}; domain=${domain}`;
                document.cookie = `${cleanName}${expStr}; path=${p}; domain=.${domain}`;
              }
            }
          }
        }
        cookieCount++;
      }
    } catch (e) {}

    return cookieCount;
  },

  // 清除当前网站全部数据（Cookie + WebStorage）
  async clearAllData(options = {}) {
    const cookieCount = await this.clearCookies(options);

    let storageCount = 0;
    try {
      storageCount += localStorage.length;
      localStorage.clear();
    } catch (e) {}

    try {
      storageCount += sessionStorage.length;
      sessionStorage.clear();
    } catch (e) {}

    return { cookieCount, storageCount };
  },

  // 恢复快照数据到当前浏览器环境中
  async restoreSession(sessionData) {
    // 切换与恢复前，先彻底清空当前所有生效域数据
    await this.clearAllData({ onlyCurrentHost: false });

    let cookieSuccessCount = 0;
    let cookieFailCount = 0;

    if (Array.isArray(sessionData.cookies)) {
      if (this.hasGmCookie()) {
        const cookieSetPromises = sessionData.cookies.map((c) => {
          return new Promise((resolve) => {
            try {
              const rawDomain = String(c.domain || "").trim();
              const cleanDomain = (rawDomain || location.hostname).replace(/^\.+/, "");

              // 向下兼容历史旧快照与新标准：精确判定是否为 Host-Only
              const isHostOnly = c.hostOnly !== undefined
                ? !!c.hostOnly
                : (!rawDomain.startsWith(".") && (cleanDomain === location.hostname || !rawDomain));

              // 基础 Cookie 属性构造
              const cookieDetails = {
                url: location.href,
                name: c.name,
                value: c.value,
                path: c.path || "/",
                secure: !!c.secure,
                httpOnly: !!c.httpOnly
              };

              // 🌟 核心规范化分流：
              // 1. 如果是 Host-Only Cookie，严禁传递 domain 参数！
              //    在 Chromium / Tampermonkey 规范中，只要不传 domain，就会被保存为精准的 Host-Only Cookie（绝不生成前导点）。
              // 2. 如果是 Domain Cookie，传递去除前导点的标准 cleanDomain，
              //    浏览器底层会自动管理为合法带点的泛域名 Cookie，保障同主域与子域正常共享。
              if (!isHostOnly) {
                cookieDetails.domain = cleanDomain;
              }

              // SameSite 与 Secure 校验联动
              if (c.sameSite && c.sameSite !== "unspecified") {
                cookieDetails.sameSite = c.sameSite;
                if (String(c.sameSite).toLowerCase() === "none") {
                  cookieDetails.secure = true;
                }
              }

              if (c.expirationDate) {
                cookieDetails.expirationDate = c.expirationDate;
              }
              if (c.partitionKey) {
                cookieDetails.partitionKey = c.partitionKey;
              }

              GM_cookie.set(cookieDetails, (err) => {
                if (err) {
                  // 若带 domain 设置失败，尝试降级为当前 URL Host-Only 写入
                  if (cookieDetails.domain) {
                    delete cookieDetails.domain;
                    GM_cookie.set(cookieDetails, (err2) => {
                      if (err2) cookieFailCount++;
                      else cookieSuccessCount++;
                      resolve();
                    });
                    return;
                  }
                  cookieFailCount++;
                } else {
                  cookieSuccessCount++;
                }
                resolve();
              });
            } catch (e) {
              cookieFailCount++;
              resolve();
            }
          });
        });
        await Promise.all(cookieSetPromises);
      } else {
        // document.cookie 降级写入
        for (const c of sessionData.cookies) {
          try {
            const rawDomain = String(c.domain || "").trim();
            const cleanDomain = (rawDomain || location.hostname).replace(/^\.+/, "");
            const isHostOnly = c.hostOnly !== undefined
              ? !!c.hostOnly
              : (!rawDomain.startsWith(".") && (cleanDomain === location.hostname || !rawDomain));

            let cookieStr = `${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}; path=${c.path || "/"}`;
            if (!isHostOnly && cleanDomain) {
              cookieStr += `; domain=${cleanDomain}`;
            }
            if (c.secure || location.protocol === "https:") {
              cookieStr += "; Secure";
            }
            if (c.sameSite && c.sameSite !== "unspecified") {
              cookieStr += `; SameSite=${c.sameSite}`;
            }
            if (c.expirationDate) {
              cookieStr += `; expires=${new Date(c.expirationDate * 1000).toUTCString()}`;
            }
            document.cookie = cookieStr;
            cookieSuccessCount++;
          } catch (e) {
            cookieFailCount++;
          }
        }
      }
    }

    let localCount = 0;
    if (sessionData.localStorage && typeof sessionData.localStorage === "object") {
      try {
        localStorage.clear();
        for (const [k, v] of Object.entries(sessionData.localStorage)) {
          if (v !== null && v !== undefined) {
            localStorage.setItem(k, v);
            localCount++;
          }
        }
      } catch (e) {}
    }

    let sessionCount = 0;
    if (sessionData.sessionStorage && typeof sessionData.sessionStorage === "object") {
      try {
        sessionStorage.clear();
        for (const [k, v] of Object.entries(sessionData.sessionStorage)) {
          if (v !== null && v !== undefined) {
            sessionStorage.setItem(k, v);
            sessionCount++;
          }
        }
      } catch (e) {}
    }

    return { cookieSuccessCount, cookieFailCount, localCount, sessionCount };
  }
};
