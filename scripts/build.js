#!/usr/bin/env node

/**
 * 自动化脚本：扫描仓库各子项目，打包并压缩 index.user.js
 * 输出为 dist/<项目名>.min.user.js
 */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// 忽略的目录名称
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'test',
  'scripts',
  '.git',
  '.idea',
  '.trae'
]);

/**
 * 提取 UserScript 和 UserConfig 元数据头
 * @param {string} content 
 * @returns {{ headers: string, body: string }}
 */
function extractHeaders(content) {
  let headers = [];
  let remaining = content;

  // 匹配 // ==UserScript== ... // ==/UserScript==
  const userScriptMatch = remaining.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  if (userScriptMatch) {
    headers.push(userScriptMatch[0].trim());
    remaining = remaining.replace(userScriptMatch[0], '');
  }

  // 匹配 /* ==UserConfig== ... ==/UserConfig== */
  const userConfigMatch = remaining.match(/\/\* ==UserConfig==[\s\S]*?==\/UserConfig== \*\//);
  if (userConfigMatch) {
    headers.push(userConfigMatch[0].trim());
    remaining = remaining.replace(userConfigMatch[0], '');
  }

  return {
    headers: headers.join('\n\n'),
    body: remaining.trim()
  };
}

/**
 * 格式化字节大小为可读字符串
 * @param {number} bytes 
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

async function main() {
  console.log('📦 开始构建与压缩各项目油猴脚本...\n');
  const startTime = Date.now();

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
  const projectDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED_DIRS.has(entry.name))
    .map((entry) => entry.name);

  const results = [];

  for (const dirName of projectDirs) {
    const projectPath = path.join(ROOT_DIR, dirName);
    const scriptPath = path.join(projectPath, 'index.user.js');
    const projectBuildScript = path.join(projectPath, 'build.js');

    // 如果子项目包含自带的 build.js（例如模块化组合），先执行子项目构建
    if (fs.existsSync(projectBuildScript)) {
      console.log(`🔨 检测到 [${dirName}] 具有独立 build.js，正在预构建...`);
      try {
        execFileSync(process.execPath, ['build.js'], {
          cwd: projectPath,
          stdio: 'inherit'
        });
      } catch (err) {
        console.error(`❌ [${dirName}] 预构建失败:`, err.message);
        process.exit(1);
      }
    }

    if (!fs.existsSync(scriptPath)) {
      continue;
    }

    const originalContent = fs.readFileSync(scriptPath, 'utf8');
    const originalSize = Buffer.byteLength(originalContent, 'utf8');

    // 提取头部并压缩主体
    const { headers, body } = extractHeaders(originalContent);

    try {
      const minified = await minify(body, {
        ecma: 2020,
        compress: {
          drop_console: false,
          drop_debugger: true,
          passes: 2
        },
        mangle: {
          toplevel: false
        },
        format: {
          comments: false
        }
      });

      if (!minified.code) {
        throw new Error('Terser 未生成有效代码');
      }

      const finalOutput = headers ? `${headers}\n\n${minified.code}\n` : `${minified.code}\n`;
      const outputFileName = `${dirName}.min.user.js`;
      const outputPath = path.join(DIST_DIR, outputFileName);

      fs.writeFileSync(outputPath, finalOutput, 'utf8');

      const minifiedSize = Buffer.byteLength(finalOutput, 'utf8');
      const ratio = (((originalSize - minifiedSize) / originalSize) * 100).toFixed(1);

      results.push({
        name: dirName,
        outputFile: outputFileName,
        originalSize,
        minifiedSize,
        ratio
      });

      console.log(`✅ [${dirName}] -> dist/${outputFileName}`);
      console.log(`   原始大小: ${formatSize(originalSize)} | 压缩后: ${formatSize(minifiedSize)} | 减小: ${ratio}%\n`);
    } catch (err) {
      console.error(`❌ 压缩项目 [${dirName}] 失败:`, err);
      process.exit(1);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log('========================================');
  console.log(`🎉 全部构建完成！共成功处理 ${results.length} 个项目`);
  console.log(`⏱️ 总耗时: ${elapsed} ms`);
  console.log(`📁 产物目录: ${DIST_DIR}`);
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('构建异常中断:', err);
  process.exit(1);
});
