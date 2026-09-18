// =========================================================================
// 🗄️ 本地存储与数据库引擎 (DB)
// 负责多域名快照记录存储、墓碑机制（防云端复活）与全域数据汇总
// =========================================================================
const DB = {
  getStorageKey(domain) {
    return `SESSION_DATA_${domain || location.hostname}`;
  },

  getRecords(domain) {
    const key = this.getStorageKey(domain);
    const raw = GM_getValue(key, []);
    return Array.isArray(raw) ? raw : [];
  },

  saveRecords(records, domain) {
    const key = this.getStorageKey(domain);
    GM_setValue(key, records);
  },

  // --- 墓碑 (Tombstones) 机制 ---
  // 用于记录已删除快照的 ID 及删除时间戳，彻底杜绝两端同步时被旧云端数据反向复活
  getTombstones(domain) {
    const raw = GM_getValue("LSM_TOMBSTONES", {});
    const tombstones = (raw && typeof raw === "object") ? raw : {};

    // 30 天自动过期垃圾回收 (30 days in ms = 2592000000)
    const expireThreshold = Date.now() - 30 * 24 * 3600 * 1000;
    let changed = false;
    for (const d of Object.keys(tombstones)) {
      if (Array.isArray(tombstones[d])) {
        const filtered = tombstones[d].filter((t) => t && t.deletedAt && t.deletedAt > expireThreshold);
        if (filtered.length !== tombstones[d].length) {
          tombstones[d] = filtered;
          changed = true;
        }
      }
    }
    if (changed) {
      GM_setValue("LSM_TOMBSTONES", tombstones);
    }

    if (domain) {
      return Array.isArray(tombstones[domain]) ? tombstones[domain] : [];
    }
    return tombstones;
  },

  saveTombstones(tombstoneMap) {
    if (tombstoneMap && typeof tombstoneMap === "object") {
      GM_setValue("LSM_TOMBSTONES", tombstoneMap);
    }
  },

  recordTombstone(id, domain) {
    const d = domain || location.hostname;
    const allTombstones = this.getTombstones();
    if (!Array.isArray(allTombstones[d])) {
      allTombstones[d] = [];
    }
    const existing = allTombstones[d].find((t) => t.id === id);
    if (existing) {
      existing.deletedAt = Date.now();
    } else {
      allTombstones[d].push({ id, deletedAt: Date.now() });
    }
    this.saveTombstones(allTombstones);
  },

  clearTombstone(id, domain) {
    const d = domain || location.hostname;
    const allTombstones = this.getTombstones();
    if (Array.isArray(allTombstones[d])) {
      allTombstones[d] = allTombstones[d].filter((t) => t.id !== id);
      this.saveTombstones(allTombstones);
    }
  },

  async addRecord(name, rawSessionData) {
    const domain = location.hostname;
    const records = this.getRecords(domain);
    const cipherObject = await CryptoEngine.encrypt(rawSessionData, domain);
    const now = Date.now();

    const newRecord = {
      id: "sess_" + now + "_" + Math.random().toString(36).slice(2, 7),
      name: name.trim(),
      domain: domain,
      url: location.href,
      createdAt: now,
      updatedAt: now,
      summary: rawSessionData.summary,
      cipherData: cipherObject
    };

    // 清除可能存在的同 ID 墓碑
    this.clearTombstone(newRecord.id, domain);

    records.unshift(newRecord);
    this.saveRecords(records, domain);
    CryptoEngine.wipeMemory(rawSessionData);

    // 触发自动同步调度
    if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
      GistSyncEngine.scheduleAutoSync();
    }

    return newRecord;
  },

  updateRecordName(id, newName, domain) {
    const d = domain || location.hostname;
    const records = this.getRecords(d);
    const target = records.find((r) => r.id === id);
    if (target) {
      target.name = newName.trim();
      target.updatedAt = Date.now();
      this.saveRecords(records, d);

      if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
        GistSyncEngine.scheduleAutoSync();
      }
      return true;
    }
    return false;
  },

  deleteRecord(id, domain) {
    const d = domain || location.hostname;
    let records = this.getRecords(d);
    const initialLen = records.length;
    records = records.filter((r) => r.id !== id);
    if (records.length !== initialLen) {
      this.saveRecords(records, d);
      // 持久化记录墓碑，杜绝两端同步时旧数据反向复活
      this.recordTombstone(id, d);

      if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
        GistSyncEngine.scheduleAutoSync();
      }
      return true;
    }
    return false;
  },

  importRecords(newRecords, domain) {
    const d = domain || location.hostname;
    const existing = this.getRecords(d);
    let count = 0;
    let skipped = 0;
    for (const item of newRecords) {
      if (!item || !item.name || !item.cipherData) continue;

      const itemCipherStr = typeof item.cipherData === "string" ? item.cipherData : JSON.stringify(item.cipherData);
      const isDuplicate = existing.some((r) => {
        if (!r || !r.cipherData) return false;
        const rCipherStr = typeof r.cipherData === "string" ? r.cipherData : JSON.stringify(r.cipherData);
        return rCipherStr === itemCipherStr || (r.id && item.id && r.id === item.id);
      });

      if (isDuplicate) {
        skipped++;
        continue;
      }

      const record = {
        ...item,
        id: item.id && !existing.some((r) => r.id === item.id) ? item.id : "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        importedAt: Date.now()
      };
      this.clearTombstone(record.id, d);

      existing.unshift(record);
      count++;
    }
    if (count > 0) {
      this.saveRecords(existing, d);
      if (typeof GistSyncEngine !== "undefined" && GistSyncEngine.scheduleAutoSync) {
        GistSyncEngine.scheduleAutoSync();
      }
    }
    return { count, skipped };
  },

  getAllDomains() {
    const domains = new Set();
    try {
      if (typeof GM_listValues === "function") {
        const keys = GM_listValues();
        for (const key of keys) {
          if (key.startsWith("SESSION_DATA_")) {
            const dom = key.replace("SESSION_DATA_", "");
            if (dom) domains.add(dom);
          }
        }
      }
    } catch (e) {}

    domains.add(location.hostname);
    const hostRules = getHostRules();
    for (const h of hostRules) {
      try {
        const hostOnly = h.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^\*\./, "");
        if (hostOnly && !hostOnly.includes("*")) {
          domains.add(hostOnly);
        }
      } catch (e) {}
    }
    return Array.from(domains);
  },

  getAllLocalData() {
    const domains = this.getAllDomains();
    const recordsMap = {};
    let totalCount = 0;
    for (const d of domains) {
      const recs = this.getRecords(d);
      if (recs && recs.length > 0) {
        recordsMap[d] = recs;
        totalCount += recs.length;
      }
    }
    return {
      format: "LSM_GIST_SYNC",
      version: "1.5.0",
      lastSyncTime: GM_getValue("Config.sync_last_time", 0),
      totalSnapshots: totalCount,
      records: recordsMap,
      tombstones: this.getTombstones(),
      custom_themes: typeof ThemeEngine !== "undefined" ? ThemeEngine.getCustomThemes() : {},
      theme_tombstones: typeof ThemeEngine !== "undefined" ? ThemeEngine.getThemeTombstones() : {}
    };
  },

  applyMergedData(mergedRecordsMap, mergedTombstonesMap) {
    if (mergedRecordsMap && typeof mergedRecordsMap === "object") {
      for (const [domain, recs] of Object.entries(mergedRecordsMap)) {
        this.saveRecords(Array.isArray(recs) ? recs : [], domain);
      }
    }
    if (mergedTombstonesMap && typeof mergedTombstonesMap === "object") {
      this.saveTombstones(mergedTombstonesMap);
    }
  },

  overwriteAllLocalData(remoteRecordsMap, remoteTombstonesMap) {
    const localDomains = this.getAllDomains();
    for (const d of localDomains) {
      this.saveRecords([], d);
    }
    this.applyMergedData(remoteRecordsMap, remoteTombstonesMap);
  },

  async getDecryptedSession(id, domain) {
    const d = domain || location.hostname;
    const records = this.getRecords(d);
    const target = records.find((r) => r.id === id);
    if (!target) throw new Error("未找到对应快照记录");
    const recDomain = target.domain || d;
    return await CryptoEngine.decrypt(target.cipherData, recDomain);
  }
};
