// ==UserScript==
// @name         禁止打开的网页
// @namespace    https://docs.scriptcat.org/
// @version      0.4.0
// @description  配置黑名单网址，匹配后自动关闭页面；支持时间段 (HH-HH) / (HH:MM-HH:MM) / (HH:MM:SS-HH:MM:SS)，仅在该时间段内自动关闭
// @author       MOYEFU
// @match        http*://*/*
// @grant        window.close
// @icon         https://image.maxemblem.com/maxemblem/uploads_file/20260730/10f0a1bbc4a6c391b2289facb2106e2f.svg
// @grant        GM_setValue
// @grant        GM_getValue
// @tag          MYF
// @noframes
// ==/UserScript==

/* ==UserConfig==
Config:
  hosts_list:
    title: 要禁止打开的网站 (多个用换行区分)
    description: 每行一条，支持通配符 * ；可附加时间段 (HH-HH) / (HH:MM-HH:MM) / (HH:MM:SS-HH:MM:SS)，如 https://example.com (12-18) 表示 12:00:00 到 18:59:59 之间打开自动关闭，不带时间段则打开即关闭
    type: textarea
    default: https://*adblockplus.org (12:00:00-23:59:59)

==/UserConfig== */

(function() {
    'use strict';

    // 获取配置，没有配置就取默认字符串
    let hostsRaw = GM_getValue('Config.hosts_list');
    if (!hostsRaw) return;

    // 每行格式：域名通配符 或 域名通配符 (HH-HH) / (HH:MM-HH:MM) / (HH:MM:SS-HH:MM:SS)
    // 例：(12-18) 表示 12:00:00-18:59:59；结束时间不足三位时缺省位补 59（开始时间补 0）
    const TIME_RANGE_REG = /^(.+?)\s*\((\d{1,2})(?::(\d{2})(?::(\d{2}))?)?-(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\)$/;

    // 按换行切割，去除空行、前后空格，解析可选的时间段
    const blockRules = [];
    hostsRaw.split('\n').forEach(line => {
        line = line.trim();
        if (!line) return;

        const rule = { pattern: line, start: null, end: null };
        const m = line.match(TIME_RANGE_REG);
        if (m) {
            rule.pattern = m[1].trim();
            rule.start = (+m[2]) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
            rule.end = (+m[5]) * 3600 + (+(m[6] || 59)) * 60 + (+(m[7] || 59));
        }
        blockRules.push(rule);
    });

    const currentUrl = window.location.href;

    // 将通配符 * 转为正则
    function wildcardToRegex(pattern) {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp('^' + escaped + '$');
    }

    // 当前时间是否在 [startSec, endSec] 内
    // 结束时间秒数为 0（如 18:59:00）时，视为覆盖到该分钟最后一秒，即 18:59:59
    function inTimeRange(startSec, endSec) {
        const now = new Date();
        const cur = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const end = endSec % 60 === 0 ? endSec + 59 : endSec;
        return cur >= startSec && cur <= end;
    }

    // 黑名单规则匹配：命中 URL 且（无时间段或当前时间在时间段内）则关闭
    let needClose = false;
    for (const rule of blockRules) {
        const reg = wildcardToRegex(rule.pattern);
        if (reg.test(currentUrl) && (rule.start === null || inTimeRange(rule.start, rule.end))) {
            needClose = true;
            break;
        }
    }

    if (needClose) {
        // 有些浏览器脚本无法直接关闭非脚本打开的标签，做个兜底
        try {
            window.close();
        } catch (e) {
            console.error(e);
            document.body.innerHTML = '<h1>此页面已被油猴脚本拦截，请手动关闭标签页</h1>';
        }
    }

})();
