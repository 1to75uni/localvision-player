/* Preserve HTTP evidence even when an edge error page is not JSON. */
(function(root) {
  'use strict';
  function retryDelay(response, data, now) {
    const value = response.headers.get('retry-after') || '';
    const seconds = Number(value);
    const headerMs = value && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    const bodyMs = Number(data?.retryAfterSec) * 1000;
    return Math.min(86400000, Math.max(0, Number.isFinite(headerMs) ? headerMs : 0, Number.isFinite(bodyMs) ? bodyMs : 0));
  }
  async function read(response, url, now = Date.now()) {
    const meta = {status:response.status, url, endpoint:new URL(url).pathname,
      contentType:response.headers.get('content-type') || '', rayId:response.headers.get('cf-ray') || ''};
    let raw;
    try { raw = await response.text(); }
    catch (_) { throw Object.assign(new Error('CMS 응답 본문 수신 실패'), meta, {code:'LV-API-DOWN', temporary:true}); }
    let data;
    try { data = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch (_) {}
    const record = data !== null && typeof data === 'object' && !Array.isArray(data);
    const failed = !response.ok || (record && (data.ok === false || data.degraded));
    // Search only active error fields. Historical error logs in successful payloads are not outages.
    const evidence = record ? [data.error, data.healthError, data.message].filter(x=>typeof x==='string').join(' ') : raw.slice(0, 65536).replace(/<[^>]*>/g, ' ');
    let code = '', message = '', temporary = false;
    if (failed || !record) {
      if (data?.errorCode === 'LV-D1-QUOTA' || /\bD1(?:_ERROR)?\b[\s\S]{0,300}(?:exceeded|daily.{0,30}limit)|daily row (?:write|read) limit/i.test(evidence)) {
        code = 'LV-D1-QUOTA'; message = 'CMS D1 일일 사용 한도 복구 대기'; temporary = true;
      } else if (data?.errorCode === 'LV-WORKER-QUOTA' || /(?:error\s*(?:code\s*)?[:：]?\s*1027\b|worker\s+exceeded\s+(?:the\s+)?(?:free\s+)?(?:daily\s+)?request\s+limit)/i.test(evidence)) {
        code = 'LV-WORKER-QUOTA'; message = 'CMS 서버 요청 한도 복구 대기'; temporary = true;
      } else if (response.status === 429) {
        code = 'LV-API-RATE-LIMIT'; message = 'CMS 요청 제한 · 재연결 대기'; temporary = true;
      } else if (!record) {
        code = 'LV-API-INVALID'; message = `CMS 응답 형식 오류 (HTTP ${response.status})`;
        temporary = response.ok || response.status >= 500;
      } else if (failed) {
        code = data.errorCode || 'LV-API-DOWN';
        message = typeof data.error === 'string' ? data.error.slice(0,1000) : `CMS 오류 (HTTP ${response.status})`;
        temporary = response.status >= 500;
      }
      const error = Object.assign(new Error(message), meta, {code, temporary, retryAfterMs:retryDelay(response, data, now)});
      if (['LV-D1-QUOTA','LV-WORKER-QUOTA'].includes(code)) error.retryAfterMs = Math.max(900000, error.retryAfterMs);
      throw error;
    }
    return data;
  }
  root.LVApiResponse = {read};
})(typeof window === 'undefined' ? globalThis : window);
