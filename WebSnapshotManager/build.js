#!/usr/bin/env node

/**
 * WebSnapshotManager 打包构建脚本
 * 将 src/ 下的模块合并构建为最终发布的单个 index.user.js 文件
 * 运行方式: node build.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.join(__dirname, 'src');
const OUTPUT_FILE = path.join(__dirname, 'index.user.js');

const MODULE_FILES = [
  'meta.js',
  'theme.js',
  'compress.js',
  'crypto.js',
  'session.js',
  'db.js',
  'gist.js',
  'ui.js',
  'main.js'
];

function build() {
  console.log('🚀 开始打包构建 WebSnapshotManager...');
  const startTime = Date.now();

  const parts = [];

  for (const file of MODULE_FILES) {
    const filePath = path.join(SRC_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 找不到模块文件: ${filePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, 'utf8').trim();
    parts.push(content);
    console.log(`  ✓ 加载模块: src/${file} (${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1)} KB)`);
  }

  const bundledCode = parts.join('\n\n') + '\n';

  // 语法验证 (去除 UserScript 和 UserConfig 头后进行严格语法树编译检查)
  console.log('🔍 正在进行 JS 语法结构校验...');
  try {
    const codeForValidation = bundledCode
      .replace(/\/\* ==UserConfig==[\s\S]*?==\/UserConfig== \*\//, '')
      .replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');
    new vm.Script(codeForValidation);
    console.log('  ✓ 语法结构校验通过！');
  } catch (err) {
    console.error('❌ 打包后语法校验失败:', err.message);
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_FILE, bundledCode, 'utf8');

  const stats = fs.statSync(OUTPUT_FILE);
  const lineCount = bundledCode.split('\n').length;
  const elapsed = Date.now() - startTime;

  console.log('\n========================================');
  console.log('🎉 构建打包成功！');
  console.log(`📁 输出文件: ${OUTPUT_FILE}`);
  console.log(`📊 总行数:   ${lineCount} 行`);
  console.log(`📦 总大小:   ${(stats.size / 1024).toFixed(2)} KB (${stats.size} 字节)`);
  console.log(`⏱️ 耗时:     ${elapsed} ms`);
  console.log('========================================\n');
}

build();
