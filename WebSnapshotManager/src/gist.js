// =========================================================================
// ☁️ GitHub Gist 云同步引擎 (双向增量合并 / 墓碑判定 / 首次连接冲突协商)
// =========================================================================
const GistSyncEngine = {
  GIST_FILENAME: "web_snapshot_manager_sync.json",
  syncLock: false,
  hasPendingChanges: false,
  idleMonitorTimer: null,
  lastActivityTime: Date.now(),
  _activityListenersInitialized: false,

  httpRequest(options) {
    return new Promise((resolve, reject) => {
      const { method = "GET", url, headers = {}, data } = options;

      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method,
          url,
          headers: {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "WebSnapshotManager-Tampermonkey-Script",
            ...headers
          },
          data: data ? (typeof data === "string" ? data : JSON.stringify(data)) : undefined,
          timeout: 20000,
          onload: (res) => {
            try {
              let parsed = null;
              if (res.responseText) {
                try {
                  parsed = JSON.parse(res.responseText);
                } catch (e) {
                  parsed = res.responseText;
                }
              }
              if (res.status >= 200 && res.status < 300) {
                resolve({ status: res.status, data: parsed, headers: res.responseHeaders });
              } else {
                const errorMsg = (parsed && parsed.message) || `HTTP ${res.status}: ${res.statusText || "请求失败"}`;
                reject(new Error(errorMsg));
              }
            } catch (err) {
              reject(err);
            }
          },
          onerror: () => reject(new Error("网络请求失败，请检查网络或代理设置")),
          ontimeout: () => reject(new Error("网络请求超时 (20秒)"))
        });
      } else {
        fetch(url, {
          method,
          headers: {
            "Accept": "application/vnd.github.v3+json",
            ...headers
          },
          body: data ? (typeof data === "string" ? data : JSON.stringify(data)) : undefined
        })
          .then(async (res) => {
            const text = await res.text();
            let parsed = null;
            try {
              parsed = JSON.parse(text);
            } catch (e) {
              parsed = text;
            }
            if (res.ok) {
              resolve({ status: res.status, data: parsed });
            } else {
              reject(new Error((parsed && parsed.message) || `HTTP ${res.status}`));
            }
          })
          .catch((e) => reject(new Error("Fetch 网络异常: " + e.message)));
      }
    });
  },

  getToken() {
    return (GM_getValue("Config.sync_gist_token", "") || "").trim();
  },

  getGistId() {
    return (GM_getValue("Config.sync_gist_id", "") || "").trim();
  },

  isAutoSyncEnabled() {
    return Boolean(GM_getValue("Config.sync_auto", false));
  },

  getIdleMinutes() {
    const val = Number(GM_getValue("Config.sync_idle_minutes", 5));
    return (!isNaN(val) && val > 0) ? Math.max(1, Math.floor(val)) : 5;
  },

  getLastSyncTime() {
    return GM_getValue("Config.sync_last_time", 0);
  },

  setSyncConfig(config) {
    if (typeof config.token === "string") GM_setValue("Config.sync_gist_token", config.token.trim());
    if (typeof config.gistId === "string") GM_setValue("Config.sync_gist_id", config.gistId.trim());
    if (typeof config.autoSync === "boolean") {
      GM_setValue("Config.sync_auto", config.autoSync);
      if (config.autoSync) {
        this.startIdleSyncMonitor();
      } else {
        this.stopIdleSyncMonitor();
      }
    }
    if (typeof config.idleMinutes === "number" && config.idleMinutes > 0) {
      GM_setValue("Config.sync_idle_minutes", Math.max(1, Math.floor(config.idleMinutes)));
    }
    if (typeof config.lastSyncTime === "number") GM_setValue("Config.sync_last_time", config.lastSyncTime);
  },

  async testConnection(customToken) {
    const token = (customToken !== undefined ? customToken : this.getToken()).trim();
    if (!token) throw new Error("请输入 GitHub Personal Access Token");

    const res = await this.httpRequest({
      method: "GET",
      url: "https://api.github.com/user",
      headers: { "Authorization": `Bearer ${token}` }
    });

    return {
      success: true,
      login: res.data.login,
      name: res.data.name || res.data.login,
      avatar_url: res.data.avatar_url,
      public_gists: res.data.public_gists,
      private_gists: res.data.total_private_gists
    };
  },

  async listUserGists(token) {
    const t = (token || this.getToken()).trim();
    if (!t) throw new Error("请先输入有效的 GitHub Token");

    const res = await this.httpRequest({
      method: "GET",
      url: "https://api.github.com/gists?per_page=100",
      headers: { "Authorization": `Bearer ${t}` }
    });

    const gists = Array.isArray(res.data) ? res.data : [];
    return gists.map((g) => {
      const files = g.files ? Object.keys(g.files) : [];
      const isSnapshotGist = files.includes(this.GIST_FILENAME);
      return {
        id: g.id,
        description: g.description || "（未命名 Gist）",
        isPublic: g.public,
        files: files,
        isSnapshotGist: isSnapshotGist,
        createdAt: g.created_at,
        updatedAt: g.updated_at
      };
    });
  },

  async fetchRemoteGist(token, gistId) {
    const t = (token || this.getToken()).trim();
    const gid = (gistId || this.getGistId()).trim();
    if (!t) throw new Error("未配置 GitHub Token");
    if (!gid) throw new Error("未配置 Gist ID");

    const res = await this.httpRequest({
      method: "GET",
      url: `https://api.github.com/gists/${gid}`,
      headers: { "Authorization": `Bearer ${t}` }
    });

    const files = res.data.files || {};
    const targetFile = files[this.GIST_FILENAME];
    if (!targetFile) {
      return {
        exists: true,
        isEmpty: true,
        records: {},
        tombstones: {},
        custom_themes: {},
        theme_tombstones: {},
        lastSyncTime: 0,
        rawGist: res.data
      };
    }

    let rawContent = targetFile.content;
    // 1. 处理 GitHub Gist 大文件截断（truncated 为 true 或 content 为空）
    if (targetFile.truncated || !rawContent) {
      if (targetFile.raw_url) {
        try {
          const rawRes = await this.httpRequest({
            method: "GET",
            url: targetFile.raw_url,
            headers: { "Authorization": `Bearer ${t}` }
          });
          rawContent = typeof rawRes.data === "string" ? rawRes.data : JSON.stringify(rawRes.data);
        } catch (err) {
          console.warn("[GistSync] 拉取 raw_url 失败:", err);
        }
      }
    }

    let contentObj = null;
    try {
      contentObj = this.safeParseRemoteGistData(rawContent);
    } catch (e) {
      if (targetFile.raw_url && !targetFile.truncated && rawContent === targetFile.content) {
        try {
          const rawRes = await this.httpRequest({
            method: "GET",
            url: targetFile.raw_url,
            headers: { "Authorization": `Bearer ${t}` }
          });
          const fallbackRaw = typeof rawRes.data === "string" ? rawRes.data : JSON.stringify(rawRes.data);
          contentObj = this.safeParseRemoteGistData(fallbackRaw);
        } catch (retryErr) {
          console.warn("[GistSync] 重试拉取 raw_url 仍失败:", retryErr);
        }
      }
      if (!contentObj) {
        console.warn("[GistSync] Gist 快照数据 JSON 解析失败，尝试容错分块提取:", e);
        contentObj = this.recoverCorruptedGistJson(rawContent);
      }
    }

    if (!contentObj || typeof contentObj !== "object") {
      throw new Error("Gist 内快照数据格式已损坏且无法提取有效快照");
    }

    // 对远程快照单条记录做严格校验和清洗，剔除单条损坏数据
    const { cleanMap: cleanRecords, corruptedCount: corruptedRecordCount } = this.sanitizeRecordsMap(contentObj.records);
    const cleanTombstones = this.sanitizeTombstonesMap(contentObj.tombstones);
    const cleanThemes = this.sanitizeThemesMap(contentObj.custom_themes);
    const cleanThemeTombs = this.sanitizeThemeTombstonesMap(contentObj.theme_tombstones);

    return {
      exists: true,
      isEmpty: false,
      records: cleanRecords,
      tombstones: cleanTombstones,
      custom_themes: cleanThemes,
      theme_tombstones: cleanThemeTombs,
      corruptedRecordCount: corruptedRecordCount,
      lastSyncTime: typeof contentObj.lastSyncTime === "number" ? contentObj.lastSyncTime : 0,
      version: contentObj.version || "1.0",
      rawGist: res.data
    };
  },

  safeParseRemoteGistData(rawText) {
    if (!rawText) return null;
    if (typeof rawText === "object") return rawText;

    const trimmed = String(rawText).trim();
    try {
      return JSON.parse(trimmed);
    } catch (e1) {
      try {
        const cleaned = trimmed
          .replace(/^\uFEFF/, "")
          .replace(/,\s*([\]}])/g, "$1");
        return JSON.parse(cleaned);
      } catch (e2) {
        return this.recoverCorruptedGistJson(trimmed);
      }
    }
  },

  recoverCorruptedGistJson(rawString) {
    if (!rawString || typeof rawString !== "string") {
      return { records: {}, tombstones: {}, custom_themes: {}, theme_tombstones: {}, lastSyncTime: 0 };
    }

    const recovered = {
      format: "LSM_GIST_SYNC",
      version: "1.5.0",
      records: {},
      tombstones: {},
      custom_themes: {},
      theme_tombstones: {},
      lastSyncTime: 0
    };

    const syncTimeMatch = rawString.match(/"lastSyncTime"\s*:\s*(\d+)/);
    if (syncTimeMatch) {
      recovered.lastSyncTime = parseInt(syncTimeMatch[1], 10) || 0;
    }

    let braceDepth = 0;
    let startIndex = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < rawString.length; i++) {
      const char = rawString[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") {
        if (braceDepth === 0) {
          startIndex = i;
        }
        braceDepth++;
      } else if (char === "}") {
        braceDepth--;
        if (braceDepth === 0 && startIndex !== -1) {
          const block = rawString.substring(startIndex, i + 1);
          try {
            const obj = JSON.parse(block);
            if (obj && typeof obj === "object") {
              if (this.isValidRecord(obj)) {
                const domain = obj.domain || location.hostname || "default";
                if (!recovered.records[domain]) recovered.records[domain] = [];
                if (!recovered.records[domain].some((r) => r.id === obj.id)) {
                  recovered.records[domain].push(obj);
                }
              } else if (obj.id && obj.tokens && (obj.type === "LSM_THEME_CONFIG" || obj.name)) {
                recovered.custom_themes[obj.id] = obj;
              } else if (obj.id && typeof obj.deletedAt === "number") {
                const domain = obj.domain || location.hostname || "default";
                if (!recovered.tombstones[domain]) recovered.tombstones[domain] = [];
                if (!recovered.tombstones[domain].some((t) => t.id === obj.id)) {
                  recovered.tombstones[domain].push(obj);
                }
              }
            }
          } catch (ignore) {}
          startIndex = -1;
        } else if (braceDepth < 0) {
          braceDepth = 0;
          startIndex = -1;
        }
      }
    }

    return recovered;
  },

  isValidRecord(rec) {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return false;
    if (typeof rec.id !== "string" || !rec.id.trim()) return false;
    if (typeof rec.name !== "string" && !rec.name) return false;
    if (rec.cipherData === undefined && rec.summary === undefined && rec.url === undefined) return false;
    if (rec.cipherData && typeof rec.cipherData === "object") {
      if (rec.cipherData.encrypted === true) {
        if (typeof rec.cipherData.payload !== "string" || !rec.cipherData.payload) return false;
      }
    }
    return true;
  },

  sanitizeRecordsMap(recordsMap) {
    const cleanMap = {};
    let totalValid = 0;
    let corruptedCount = 0;

    if (recordsMap && typeof recordsMap === "object") {
      for (const [domain, list] of Object.entries(recordsMap)) {
        if (Array.isArray(list)) {
          const cleanList = [];
          for (const item of list) {
            if (this.isValidRecord(item)) {
              cleanList.push(item);
              totalValid++;
            } else {
              corruptedCount++;
              console.warn(`[GistSync] 过滤忽略损坏的单条快照数据 (域名: ${domain}):`, item);
            }
          }
          if (cleanList.length > 0) {
            cleanMap[domain] = cleanList;
          }
        }
      }
    }
    return { cleanMap, totalValid, corruptedCount };
  },

  sanitizeTombstonesMap(tombstonesMap) {
    const cleanMap = {};
    if (tombstonesMap && typeof tombstonesMap === "object") {
      for (const [domain, list] of Object.entries(tombstonesMap)) {
        if (Array.isArray(list)) {
          const cleanList = list.filter(
            (t) => t && typeof t === "object" && typeof t.id === "string" && typeof t.deletedAt === "number"
          );
          if (cleanList.length > 0) cleanMap[domain] = cleanList;
        }
      }
    }
    return cleanMap;
  },

  sanitizeThemesMap(themesMap) {
    const cleanMap = {};
    if (themesMap && typeof themesMap === "object") {
      for (const [id, theme] of Object.entries(themesMap)) {
        if (theme && typeof theme === "object" && theme.id) {
          cleanMap[id] = theme;
        }
      }
    }
    return cleanMap;
  },

  sanitizeThemeTombstonesMap(themeTombsMap) {
    const cleanMap = {};
    if (themeTombsMap && typeof themeTombsMap === "object") {
      for (const [id, time] of Object.entries(themeTombsMap)) {
        if (typeof id === "string" && typeof time === "number") {
          cleanMap[id] = time;
        }
      }
    }
    return cleanMap;
  },

  async createGist(token, initialData) {
    const t = (token || this.getToken()).trim();
    if (!t) throw new Error("请先输入有效的 GitHub Token");

    const dataToSave = initialData || DB.getAllLocalData();
    dataToSave.lastSyncTime = Date.now();
    dataToSave.format = "LSM_GIST_SYNC";
    dataToSave.version = "1.5.0";
    if (!dataToSave.custom_themes && typeof ThemeEngine !== "undefined") {
      dataToSave.custom_themes = ThemeEngine.getCustomThemes();
    }
    if (!dataToSave.theme_tombstones && typeof ThemeEngine !== "undefined") {
      dataToSave.theme_tombstones = ThemeEngine.getThemeTombstones();
    }

    const res = await this.httpRequest({
      method: "POST",
      url: "https://api.github.com/gists",
      headers: {
        "Authorization": `Bearer ${t}`,
        "Content-Type": "application/json"
      },
      data: {
        description: "网站快照存储与恢复助手 - 云同步备份数据 (WebSnapshotManager)",
        public: false,
        files: {
          [this.GIST_FILENAME]: {
            content: JSON.stringify(dataToSave, null, 2)
          }
        }
      }
    });

    const newGistId = res.data.id;
    if (!newGistId) throw new Error("创建 Gist 失败，GitHub 未返回 Gist ID");

    this.setSyncConfig({ gistId: newGistId, lastSyncTime: Date.now() });
    return { gistId: newGistId, htmlUrl: res.data.html_url };
  },

  async updateGist(token, gistId, dataToSave) {
    const t = (token || this.getToken()).trim();
    const gid = (gistId || this.getGistId()).trim();
    if (!t) throw new Error("未配置 GitHub Token");
    if (!gid) throw new Error("未配置 Gist ID");

    const payload = {
      ...dataToSave,
      format: "LSM_GIST_SYNC",
      version: "1.5.0",
      lastSyncTime: Date.now()
    };

    await this.httpRequest({
      method: "PATCH",
      url: `https://api.github.com/gists/${gid}`,
      headers: {
        "Authorization": `Bearer ${t}`,
        "Content-Type": "application/json"
      },
      data: {
        description: "网站快照存储与恢复助手 - 云同步备份数据 (WebSnapshotManager)",
        files: {
          [this.GIST_FILENAME]: {
            content: JSON.stringify(payload, null, 2)
          }
        }
      }
    });

    this.setSyncConfig({ lastSyncTime: payload.lastSyncTime });
    return payload;
  },

  mergeThemeData(localThemes = {}, remoteThemes = {}, localThemeTombs = {}, remoteThemeTombs = {}) {
    const lThemes = (localThemes && typeof localThemes === "object") ? localThemes : {};
    const rThemes = (remoteThemes && typeof remoteThemes === "object") ? remoteThemes : {};
    const lTombs = (localThemeTombs && typeof localThemeTombs === "object") ? localThemeTombs : {};
    const rTombs = (remoteThemeTombs && typeof remoteThemeTombs === "object") ? remoteThemeTombs : {};

    const mergedTombs = {};
    const expireThreshold = Date.now() - 30 * 24 * 3600 * 1000;
    const allTombKeys = new Set([...Object.keys(lTombs), ...Object.keys(rTombs)]);
    for (const id of allTombKeys) {
      const lTime = typeof lTombs[id] === "number" ? lTombs[id] : 0;
      const rTime = typeof rTombs[id] === "number" ? rTombs[id] : 0;
      const latestTime = Math.max(lTime, rTime);
      if (latestTime > expireThreshold) {
        mergedTombs[id] = latestTime;
      }
    }

    const mergedThemes = {};
    const allThemeIds = new Set([...Object.keys(lThemes), ...Object.keys(rThemes)]);
    let addedFromRemoteThemeCount = 0;
    let updatedThemeCount = 0;
    let purgedByThemeTombCount = 0;

    for (const id of allThemeIds) {
      const lTheme = lThemes[id];
      const rTheme = rThemes[id];
      const tombTime = mergedTombs[id] || 0;

      const isThemeDeleted = (t) => {
        if (!t) return true;
        const themeTime = t.updatedAt || t.createdAt || 0;
        return tombTime >= themeTime;
      };

      if (lTheme && isThemeDeleted(lTheme)) {
        purgedByThemeTombCount++;
        continue;
      }
      if (rTheme && isThemeDeleted(rTheme)) {
        purgedByThemeTombCount++;
        continue;
      }

      if (lTheme && !rTheme) {
        mergedThemes[id] = lTheme;
      } else if (!lTheme && rTheme) {
        if (typeof ThemeEngine !== "undefined") {
          try {
            mergedThemes[id] = ThemeEngine.validateAndNormalizeTheme(rTheme);
          } catch (e) {
            mergedThemes[id] = rTheme;
          }
        } else {
          mergedThemes[id] = rTheme;
        }
        addedFromRemoteThemeCount++;
      } else if (lTheme && rTheme) {
        const lTime = lTheme.updatedAt || lTheme.createdAt || 0;
        const rTime = rTheme.updatedAt || rTheme.createdAt || 0;
        if (rTime > lTime) {
          if (typeof ThemeEngine !== "undefined") {
            try {
              mergedThemes[id] = ThemeEngine.validateAndNormalizeTheme(rTheme);
            } catch (e) {
              mergedThemes[id] = rTheme;
            }
          } else {
            mergedThemes[id] = rTheme;
          }
          updatedThemeCount++;
        } else {
          mergedThemes[id] = lTheme;
        }
      }
    }

    return {
      customThemes: mergedThemes,
      themeTombstones: mergedTombs,
      stats: {
        totalThemes: Object.keys(mergedThemes).length,
        addedFromRemoteThemeCount,
        updatedThemeCount,
        purgedByThemeTombCount
      }
    };
  },

  mergeSnapshotData(localData, remoteData) {
    const { cleanMap: localRecs, corruptedCount: localCorruptedCount } = this.sanitizeRecordsMap(localData.records);
    const { cleanMap: remoteRecs, corruptedCount: remoteCorruptedCount } = this.sanitizeRecordsMap(remoteData.records);
    const localTombstones = this.sanitizeTombstonesMap(localData.tombstones);
    const remoteTombstones = this.sanitizeTombstonesMap(remoteData.tombstones);

    const allDomains = new Set([
      ...Object.keys(localRecs),
      ...Object.keys(remoteRecs),
      ...Object.keys(localTombstones),
      ...Object.keys(remoteTombstones)
    ]);

    const mergedTombstones = {};
    const expireThreshold = Date.now() - 30 * 24 * 3600 * 1000;

    for (const d of allDomains) {
      const lT = Array.isArray(localTombstones[d]) ? localTombstones[d] : [];
      const rT = Array.isArray(remoteTombstones[d]) ? remoteTombstones[d] : [];
      const tombMap = new Map();

      for (const t of [...lT, ...rT]) {
        if (!t || !t.id || !t.deletedAt) continue;
        if (t.deletedAt <= expireThreshold) continue;

        if (!tombMap.has(t.id) || tombMap.get(t.id).deletedAt < t.deletedAt) {
          tombMap.set(t.id, { id: t.id, deletedAt: t.deletedAt });
        }
      }
      if (tombMap.size > 0) {
        mergedTombstones[d] = Array.from(tombMap.values());
      }
    }

    const mergedRecords = {};
    let totalMergedCount = 0;
    let purgedByTombstoneCount = 0;
    let addedFromRemoteCount = 0;
    let updatedCount = 0;

    for (const d of allDomains) {
      const lList = Array.isArray(localRecs[d]) ? localRecs[d] : [];
      const rList = Array.isArray(remoteRecs[d]) ? remoteRecs[d] : [];
      const dTombs = mergedTombstones[d] || [];
      const tombIdMap = new Map(dTombs.map((t) => [t.id, t.deletedAt]));

      const recordMap = new Map();

      const isDeleted = (rec) => {
        if (!rec || !rec.id) return true;
        if (tombIdMap.has(rec.id)) {
          const delTime = tombIdMap.get(rec.id);
          const recTime = rec.updatedAt || rec.createdAt || 0;
          if (delTime >= recTime) {
            return true;
          }
        }
        return false;
      };

      for (const rec of lList) {
        if (isDeleted(rec)) {
          purgedByTombstoneCount++;
          continue;
        }
        recordMap.set(rec.id, rec);
      }

      for (const rRec of rList) {
        if (isDeleted(rRec)) {
          purgedByTombstoneCount++;
          continue;
        }

        if (!recordMap.has(rRec.id)) {
          recordMap.set(rRec.id, rRec);
          addedFromRemoteCount++;
        } else {
          const lRec = recordMap.get(rRec.id);
          const lTime = lRec.updatedAt || lRec.createdAt || 0;
          const rTime = rRec.updatedAt || rRec.createdAt || 0;

          if (rTime > lTime) {
            recordMap.set(rRec.id, rRec);
            updatedCount++;
          }
        }
      }

      const finalDomainRecs = Array.from(recordMap.values()).sort(
        (a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0)
      );

      if (finalDomainRecs.length > 0) {
        mergedRecords[d] = finalDomainRecs;
        totalMergedCount += finalDomainRecs.length;
      }
    }

    const totalCorruptedSkipped =
      (localCorruptedCount || 0) + (remoteCorruptedCount || 0) + (remoteData.corruptedRecordCount || 0);

    return {
      records: mergedRecords,
      tombstones: mergedTombstones,
      totalSnapshots: totalMergedCount,
      stats: {
        totalMergedCount,
        purgedByTombstoneCount,
        addedFromRemoteCount,
        updatedCount,
        corruptedSkippedCount: totalCorruptedSkipped
      }
    };
  },

  async twoWaySync(options = {}) {
    const { silent = false } = options;

    if (this.syncLock) {
      if (!silent && typeof showToast === "function") {
        showToast("已有同步任务正在进行中，请稍候...", "info");
      }
      return { success: false, reason: "locked" };
    }

    const token = this.getToken();
    const gistId = this.getGistId();

    if (!token) {
      if (!silent && typeof showToast === "function") {
        showToast("请先在云同步设置中配置 GitHub Token", "error");
      }
      return { success: false, reason: "no_token" };
    }
    if (!gistId) {
      if (!silent && typeof showToast === "function") {
        showToast("请先配置 Gist ID 或点击一键自动创建", "error");
      }
      return { success: false, reason: "no_gist_id" };
    }

    this.syncLock = true;
    this.notifySyncStatus("syncing");

    try {
      if (!silent && typeof showToast === "function") {
        showToast("正在与 GitHub Gist 双向同步...", "info");
      }

      const localData = DB.getAllLocalData();
      const remoteData = await this.fetchRemoteGist(token, gistId);

      // 1. 合并快照记录与墓碑
      const mergedResult = this.mergeSnapshotData(localData, remoteData);
      DB.applyMergedData(mergedResult.records, mergedResult.tombstones);

      // 2. 合并自定义主题与主题墓碑
      const mergedThemeResult = this.mergeThemeData(
        localData.custom_themes || {},
        remoteData.custom_themes || {},
        localData.theme_tombstones || {},
        remoteData.theme_tombstones || {}
      );
      if (typeof ThemeEngine !== "undefined") {
        ThemeEngine.saveCustomThemesMap(mergedThemeResult.customThemes);
        ThemeEngine.saveThemeTombstones(mergedThemeResult.themeTombstones);
        ThemeEngine.applyTheme();
      }

      // 3. 将合并后的完整数据（快照 + 自定义主题）更新回远程 Gist
      await this.updateGist(token, gistId, {
        records: mergedResult.records,
        tombstones: mergedResult.tombstones,
        totalSnapshots: mergedResult.totalSnapshots,
        custom_themes: mergedThemeResult.customThemes,
        theme_tombstones: mergedThemeResult.themeTombstones
      });

      this.notifySyncStatus("success");

      if (typeof refreshList === "function") {
        refreshList();
      }
      if (typeof renderThemeList === "function") {
        renderThemeList();
      }
      if (typeof renderQuickThemeMenu === "function") {
        renderQuickThemeMenu();
      }

      if (!silent && typeof showToast === "function") {
        const s = mergedResult.stats;
        const ts = mergedThemeResult.stats;
        let msg = `同步成功！全域共 ${mergedResult.totalSnapshots} 条快照，${ts.totalThemes} 套自定义主题`;
        const details = [];
        if (s.addedFromRemoteCount > 0) details.push(`快照 +${s.addedFromRemoteCount}`);
        if (s.purgedByTombstoneCount > 0) details.push(`快照清理 -${s.purgedByTombstoneCount}`);
        if (s.corruptedSkippedCount > 0) details.push(`忽略损坏快照 ${s.corruptedSkippedCount} 条`);
        if (ts.addedFromRemoteThemeCount > 0) details.push(`主题 +${ts.addedFromRemoteThemeCount}`);
        if (ts.purgedByThemeTombCount > 0) details.push(`主题清理 -${ts.purgedByThemeTombCount}`);
        if (details.length > 0) {
          msg += ` (${details.join("，")})`;
        }
        showToast(msg, "success");
      }

      return { success: true, result: mergedResult, themeResult: mergedThemeResult };
    } catch (err) {
      this.notifySyncStatus("error", err.message);
      if (!silent && typeof showToast === "function") {
        showToast(`同步失败: ${err.message}`, "error");
      }
      return { success: false, error: err };
    } finally {
      this.syncLock = false;
    }
  },

  recordActivity() {
    this.lastActivityTime = Date.now();
  },

  isPluginInUse() {
    try {
      if (typeof LSM_UI !== "undefined" && typeof LSM_UI.isInUse === "function") {
        return LSM_UI.isInUse();
      }
    } catch (e) {}
    return false;
  },

  initActivityListeners(shadowRoot) {
    if (this._activityListenersInitialized) {
      if (shadowRoot) {
        this._bindShadowActivity(shadowRoot);
      }
      return;
    }
    this._activityListenersInitialized = true;

    const onActivity = () => {
      this.recordActivity();
    };

    const events = [
      "mousemove", "mousedown", "mouseup", "keydown", "keyup",
      "scroll", "wheel", "touchstart", "touchend", "touchmove",
      "pointerdown", "pointermove", "input", "change", "focus"
    ];

    events.forEach((ev) => {
      try {
        window.addEventListener(ev, onActivity, { capture: true, passive: true });
      } catch (e) {}
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.recordActivity();
      }
    });

    if (shadowRoot) {
      this._bindShadowActivity(shadowRoot);
    }

    if (this.isAutoSyncEnabled()) {
      this.startIdleSyncMonitor();
    }
  },

  _bindShadowActivity(shadowRoot) {
    if (!shadowRoot || shadowRoot._lsmActivityBound) return;
    shadowRoot._lsmActivityBound = true;
    const onActivity = () => {
      this.recordActivity();
    };
    const events = ["mousedown", "mouseup", "click", "keydown", "input", "scroll", "touchstart"];
    events.forEach((ev) => {
      try {
        shadowRoot.addEventListener(ev, onActivity, { capture: true, passive: true });
      } catch (e) {}
    });
  },

  scheduleAutoSync() {
    if (!this.isAutoSyncEnabled()) return;
    const token = this.getToken();
    const gistId = this.getGistId();
    if (!token || !gistId) return;

    this.hasPendingChanges = true;
    this.startIdleSyncMonitor();
  },

  startIdleSyncMonitor() {
    if (this.idleMonitorTimer) return;
    this.idleMonitorTimer = setInterval(() => {
      this.checkAndTriggerIdleSync();
    }, 10000);
  },

  stopIdleSyncMonitor() {
    if (this.idleMonitorTimer) {
      clearInterval(this.idleMonitorTimer);
      this.idleMonitorTimer = null;
    }
  },

  async checkAndTriggerIdleSync() {
    if (!this.isAutoSyncEnabled()) return;
    const token = this.getToken();
    const gistId = this.getGistId();
    if (!token || !gistId) return;
    if (this.syncLock) return;

    if (this.isPluginInUse()) return;

    const idleLimitMs = this.getIdleMinutes() * 60 * 1000;
    const now = Date.now();
    const idleTime = now - this.lastActivityTime;

    if (idleTime < idleLimitMs) return;

    const lastSync = this.getLastSyncTime();
    const needSync = this.hasPendingChanges || (!lastSync || (now - lastSync >= idleLimitMs));

    if (needSync) {
      try {
        const res = await this.twoWaySync({ silent: true, checkConflict: false });
        if (res && res.success) {
          this.hasPendingChanges = false;
        }
      } catch (err) {
        console.warn("[GistSync] 空闲自动同步失败:", err);
      }
    }
  },

  checkSyncOnOpen() {
    if (typeof updateCloudStatusUI === "function") {
      updateCloudStatusUI();
    }
  },

  notifySyncStatus(status, errorMsg) {
    if (typeof updateCloudStatusUI === "function") {
      updateCloudStatusUI(status, errorMsg);
    }
  }
};
