// =========================================================================
// 🗜️ 数据无损压缩引擎 (CompressionEngine)
// 基于浏览器原生 CompressionStream / DecompressionStream ('deflate-raw')
// 当快照数据或同步载荷较大时自动透明压缩，大幅缩减油猴存储与 Gist 网络体积
// =========================================================================
const CompressionEngine = {
  COMPRESSION_PREFIX: "__gz__:",
  MIN_COMPRESS_SIZE: 4096, // 超过 4KB 自动触发压缩

  isSupported() {
    return (
      typeof CompressionStream !== "undefined" &&
      typeof DecompressionStream !== "undefined" &&
      typeof Response !== "undefined"
    );
  },

  isCompressed(val) {
    return typeof val === "string" && val.startsWith(this.COMPRESSION_PREFIX);
  },

  // 压缩字符串为 Base64 标记字符串
  async compressString(rawStr) {
    if (!this.isSupported() || typeof rawStr !== "string") return rawStr;
    if (rawStr.length < this.MIN_COMPRESS_SIZE) return rawStr;

    try {
      const stream = new Blob([rawStr]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const buffer = await new Response(stream).arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      
      // 分块高效转为 Base64，避免超大数组栈溢出
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
      }
      const b64 = btoa(binary);
      // 仅当压缩后确实变小才返回压缩格式
      if (b64.length + this.COMPRESSION_PREFIX.length < rawStr.length) {
        return this.COMPRESSION_PREFIX + b64;
      }
      return rawStr;
    } catch (e) {
      console.warn("[LSM Compress] 压缩失败，降级使用原始数据:", e);
      return rawStr;
    }
  },

  // 解压缩字符串为原始字符串
  async decompressString(compressedStr) {
    if (!this.isCompressed(compressedStr)) return compressedStr;
    if (!this.isSupported()) {
      throw new Error("当前浏览器环境不支持原生 DecompressionStream，无法解压数据");
    }

    try {
      const b64 = compressedStr.slice(this.COMPRESSION_PREFIX.length);
      const binary = atob(b64);
      const uint8 = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        uint8[i] = binary.charCodeAt(i);
      }

      const stream = new Blob([uint8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    } catch (e) {
      console.error("[LSM Compress] 解压失败:", e);
      throw new Error("数据解压失败: " + e.message);
    }
  }
};
