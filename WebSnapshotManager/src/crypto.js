// =========================================================================
// 全局配置快捷访问器
// =========================================================================
const isEncryptionEnabled = () => Boolean(GM_getValue("Config.enable_encryption", false));
const isAutoReloadEnabled = () => Boolean(GM_getValue("Config.auto_reload_after_restore", false));

// =========================================================================
// 加密与安全擦除引擎 (AES-GCM 256)
// =========================================================================
const CryptoEngine = {
  keyCache: new Map(),

  isEncryptionEnabled() {
    return isEncryptionEnabled();
  },

  // 安全派生密钥：支持 v3（跨设备强通用密钥）、v2（域名绑定密钥）、legacy（UA 绑定历史密钥）
  async getDerivedKey(saltString, domain, version = "v3") {
    const host = (domain || location.hostname || "").trim().toLowerCase();
    const salt = saltString || "SESSION_MGR_SALT_2026";
    const cacheKey = `${host}___${salt}___${version}`;

    if (this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey);
    }

    const enc = new TextEncoder();
    let baseKeyMaterial = "";

    if (version === "v3") {
      // v3: 全局稳定密钥材料，彻底消除跨设备、跨浏览器、二级域名或跨站点恢复时的环境不一致问题
      baseKeyMaterial = "LSM_STABLE_UNIVERSAL_KEY_MATERIAL_2026_SECURE";
    } else if (version === "v2") {
      // v2: 基于主域名的派生密钥材料
      baseKeyMaterial = `LSM_KEY_V2_SNAPSHOT_${host}`;
    } else {
      // legacy: 兼容旧版本保存的历史快照数据 (含 UA 前缀)
      baseKeyMaterial = `LSM_KEY_${navigator.userAgent.slice(0, 32)}_${host}`;
    }

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(baseKeyMaterial),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode(salt),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    this.keyCache.set(cacheKey, derivedKey);
    return derivedKey;
  },

  async encrypt(plainObject, domain) {
    if (!this.isEncryptionEnabled() || !crypto.subtle) {
      return { encrypted: false, payload: JSON.stringify(plainObject) };
    }
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      // 默认使用 v3 跨设备强通用稳定密钥加密
      const key = await this.getDerivedKey("SESSION_SALT_GCM", domain, "v3");
      const encodedData = new TextEncoder().encode(JSON.stringify(plainObject));

      const cipherBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encodedData
      );

      const ivBase64 = btoa(String.fromCharCode(...iv));
      const cipherBase64 = btoa(String.fromCharCode(...new Uint8Array(cipherBuffer)));

      return {
        encrypted: true,
        v: "3", // 标注密钥协议版本
        iv: ivBase64,
        payload: cipherBase64
      };
    } catch (err) {
      console.warn("[LSM] 加密失败，使用原始格式:", err);
      return { encrypted: false, payload: JSON.stringify(plainObject) };
    }
  },

  async decrypt(cipherObj, domain) {
    if (!cipherObj) return null;
    if (!cipherObj.encrypted) {
      return typeof cipherObj.payload === "string"
        ? JSON.parse(cipherObj.payload)
        : cipherObj.payload;
    }
    try {
      const iv = new Uint8Array(
        atob(cipherObj.iv)
          .split("")
          .map((c) => c.charCodeAt(0))
      );
      const cipherData = new Uint8Array(
        atob(cipherObj.payload)
          .split("")
          .map((c) => c.charCodeAt(0))
      );

      const tryDecryptWithKey = async (targetDomain, version) => {
        try {
          const key = await this.getDerivedKey("SESSION_SALT_GCM", targetDomain, version);
          const decryptedBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            cipherData
          );
          const decryptedStr = new TextDecoder().decode(decryptedBuffer);
          return JSON.parse(decryptedStr);
        } catch (e) {
          return null;
        }
      };

      // 智能自适应多级回退解密管道：
      // 1. 优先尝试 v3 跨设备强通用密钥 (零环境依赖)
      let res = await tryDecryptWithKey("", "v3");
      if (res) return res;

      // 2. 尝试 v2 密钥 (快照原始 domain)
      if (domain) {
        res = await tryDecryptWithKey(domain, "v2");
        if (res) return res;
      }

      // 3. 尝试 v2 密钥 (当前页面 location.hostname)
      if (location.hostname && location.hostname !== domain) {
        res = await tryDecryptWithKey(location.hostname, "v2");
        if (res) return res;
      }

      // 4. 尝试 legacy 密钥 (快照原始 domain)
      if (domain) {
        res = await tryDecryptWithKey(domain, "legacy");
        if (res) return res;
      }

      // 5. 尝试 legacy 密钥 (当前 location.hostname)
      if (location.hostname && location.hostname !== domain) {
        res = await tryDecryptWithKey(location.hostname, "legacy");
        if (res) return res;
      }

      throw new Error("数据解密失败，快照可能损坏或加密密钥不匹配");
    } catch (err) {
      console.error("[LSM] 解密失败:", err);
      throw err instanceof Error ? err : new Error("数据解密失败");
    }
  },

  wipeMemory(obj) {
    if (typeof obj === "object" && obj !== null) {
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === "string") {
          obj[key] = "";
        } else if (typeof obj[key] === "object") {
          this.wipeMemory(obj[key]);
        }
        delete obj[key];
      }
    }
  }
};
