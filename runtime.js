/* LocalVision v1.9.0. Dependency-free runtime; also exercised by node:test. */
(function (root) {
  'use strict';
  const clamp = (v, lo, hi, fallback) => Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback;
  const uid = () => root.crypto?.randomUUID?.() || `lv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const abortError = () => Object.assign(new Error('Operation cancelled'), {name: 'AbortError'});
  function readJSON(storage, key, fallback) { try { return JSON.parse(storage.getItem(key) || 'null') ?? fallback; } catch (_) { return fallback; } }
  async function timedFetch(url, options = {}, timeoutMs = 15000, consume) {
    const controller = new AbortController();
    const external = options.signal;
    const cancel = () => controller.abort();
    if (external?.aborted) throw abortError();
    external?.addEventListener('abort', cancel, {once: true});
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const response = await root.fetch(url, {...options, signal: controller.signal});
      return consume ? await consume(response,controller.signal) : response;
    } finally { clearTimeout(timer); external?.removeEventListener('abort', cancel); }
  }
  class Outbox {
    constructor({storage, key, send, onState = () => {}, maxCount = 1500, maxBytes = 1800000}) {
      Object.assign(this, {storage, key, send, onState, maxCount, maxBytes});
      this.items = readJSON(storage, key, []);
      if (!Array.isArray(this.items)) this.items = [];
      this.items = this.items.filter(e => e && e.id && e.queuedAt > Date.now() - 7 * 86400000);
      this.busy = false; this.attempt = 0; this.timer = null; this.lastSuccess = ''; this.lastError = ''; this.durable = true; this.dropped = 0;
    }
    snapshot() { return {pending: this.items.length, durable: this.durable, dropped: this.dropped, lastSuccess: this.lastSuccess, lastError: this.lastError}; }
    persist() {
      const discard = () => {
        let i = this.items.findIndex(e => ['debug', 'info'].includes(e.level));
        if (i < 0) i = 0;
        this.items.splice(i, 1); this.dropped++;
      };
      while (this.items.length > this.maxCount) discard();
      let serialized = JSON.stringify(this.items);
      while (serialized.length * 2 > this.maxBytes && this.items.length > 1) { discard(); serialized = JSON.stringify(this.items); }
      try { this.storage.setItem(this.key, serialized); this.durable = true; }
      catch (_) { this.durable = false; this.lastError = '기기 로그 저장 공간 부족'; }
      this.onState(this.snapshot());
    }
    enqueue(event) {
      const record = {...event, id: event.id || uid(), queuedAt: Date.now()};
      this.items.push(record); this.persist(); this.schedule(1500); return record.id;
    }
    schedule(delay = 1500) {
      if (this.timer || !this.items.length) return;
      this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, delay);
    }
    async flush() {
      if (this.busy || !this.items.length) return false;
      this.busy = true;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      const batch = this.items.slice(0, 40);
      try {
        const data = await this.send(batch);
        if (!data || data.ok !== true || data.degraded) throw new Error('CMS가 로그 저장을 확인하지 못했습니다.');
        let ids = Array.isArray(data.acknowledged) ? data.acknowledged : [];
        // v2.0.5 compatibility: correlate the ordered per-entry results, never trust HTTP 200 alone.
        if (!ids.length && Array.isArray(data.results) && data.results.length === batch.length) {
          ids = batch.filter((_, i) => data.results[i]?.ok === true).map(e => e.id);
        }
        const sent = new Set(batch.map(e => e.id));
        const accepted = new Set(ids.filter(id => sent.has(id)));
        if (!accepted.size) throw new Error('저장 확인된 로그가 없습니다.');
        this.items = this.items.filter(e => !accepted.has(e.id));
        this.lastSuccess = new Date().toISOString(); this.lastError = ''; this.attempt = 0;
      } catch (error) {
        this.lastError = String(error?.message || error).slice(0, 200); this.attempt++;
      } finally {
        this.busy = false; this.persist();
        this.schedule(this.attempt ? Math.min(300000, 3000 * (2 ** Math.min(this.attempt, 7))) : 1500);
      }
      return this.items.length === 0;
    }
  }
  function classify(error, phase) {
    if (error?.name === 'NotAllowedError') return {code: 'LV-PLAY-POLICY', kind: 'policy', label: '브라우저/APP 재생 정책 거절'};
    if (error?.name === 'NotSupportedError' || error?.mediaCode === 4) return {code: 'LV-MEDIA-UNSUPPORTED', kind: 'format', label: '지원되지 않는 미디어 형식'};
    if (error?.mediaCode === 3) return {code: 'LV-MEDIA-DECODE', kind: 'decode', label: '영상 디코딩 실패'};
    if (error?.code) return {code: error.code, kind: phase, label: error.message};
    if (phase === 'source') return {code: 'LV-MEDIA-DOWNLOAD', kind: 'source', label: '미디어 읽기 또는 다운로드 실패'};
    return {code: 'LV-MEDIA-PLAY-FAIL', kind: phase, label: '미디어 재생 실패'};
  }
  class Lane {
    constructor(side, options) {
      this.side = side; this.o = options; this.items = []; this.index = 0; this.generation = 0;
      this.current = null; this.element = null; this.src = ''; this.phase = 'empty'; this.reason = '';
      this.failures = new Map(); this.exclusions = new Map(); this.timers = new Set(); this.pauses = new Set();
      this.currentTime = 0; this.duration = 0; this.lastProgressAt = 0; this.firstFrameAt = 0; this.lastCompletedAt = '';
      this.playedMs = 0; this.progressTick = 0; this.frameCount = 0; this.lastError = null;
      this.controller = null; this.releaseGate = null; this.attemptId = ''; this.terminal = false; this.rvfc = null;
      this.poster = null;
    }
    key(item) { return `${item?.id || item?.url || ''}|${item?.url || ''}|${item?.integrity?.revision || item?.revision || item?.updatedAt || ''}`; }
    valid(token) { return token === this.generation && !this.terminal && !this.pauses.size; }
    later(fn, ms) { const id = setTimeout(() => {this.timers.delete(id); fn();}, ms); this.timers.add(id); return id; }
    cancelTimer(id) { clearTimeout(id); this.timers.delete(id); }
    event(code, message, level = 'info', extra = {}) {
      this.o.onEvent?.(code, message, {side: this.side, itemId: this.current?.id || '', fileName: this.current?.fileName || '', title: this.current?.title || '', sourceUrl: this.current?.url || '', attemptId: this.attemptId, phase: this.phase, currentTime: this.currentTime, duration: this.duration, playedMs: Math.round(this.playedMs), ...extra}, level);
    }
    change(phase, reason = '', important = false) {
      const category = ['playing','image'].includes(phase) ? 'healthy' : ['retrying','quarantined','fallback'].includes(phase) ? 'problem' : ['paused','empty','stopped'].includes(phase) ? phase : '';
      if (category && category !== this.lastHealthClass) {important = true; this.lastHealthClass = category;}
      this.phase = phase; this.reason = reason; this.o.onState?.(this.side, this.snapshot(), important);
    }
    cleanup() {
      this.controller?.abort(); this.controller = null;
      this.timers.forEach(clearTimeout); this.timers.clear();
      const el = this.element;
      if (el) {
        for (const key of ['onerror','onended','onloadedmetadata','onloadeddata','oncanplay','onplaying','onpause','onwaiting','onstalled','onload']) el[key] = null;
        if (this.rvfc != null) { try {el.cancelVideoFrameCallback?.(this.rvfc);} catch (_) {} }
        try { el.pause?.(); if (el !== this.poster?.element) el.removeAttribute('src'); el.load?.(); } catch (_) {}
        el.remove?.();
      }
      this.element = null; this.rvfc = null;
      if (this.src.startsWith('blob:') && this.src !== this.poster?.src) {try {URL.revokeObjectURL(this.src);} catch (_) {}}
      this.src = '';
      if (this.releaseGate) {this.releaseGate(); this.releaseGate = null;}
    }
    placeholder() {
      if (this.poster) {this.o.zone.replaceChildren(this.poster.element);return;}
      const img = document.createElement('img'); img.className = 'media contain lv-fallback';
      img.src = this.o.fallback || './loading.jpg'; img.alt = 'LocalVision';
      this.o.zone.replaceChildren(img);
    }
    setPlaylist(items, startIndex = 0) {
      const signature = list => JSON.stringify(list.map(i => [this.key(i), i.duration, i.type]));
      const same = signature(items) === signature(this.items);
      this.items = items.slice();
      const keys = new Set(items.map(i => this.key(i)));
      if (this.poster && !keys.has(this.poster.key)) {if(this.poster.src.startsWith('blob:')) URL.revokeObjectURL(this.poster.src);this.poster=null;}
      for (const key of this.exclusions.keys()) if (!keys.has(key)) this.exclusions.delete(key);
      for (const key of this.failures.keys()) if (!keys.has(key)) this.failures.delete(key);
      if (same && this.current && !['empty','stopped'].includes(this.phase)) return;
      this.index = Math.max(0, startIndex) % Math.max(1, items.length);
      if (!items.length) {this.generation++; this.cleanup(); this.current = null; this.placeholder(); this.change('empty'); return;}
      this.choose(this.index);
    }
    choose(start) {
      if (!this.items.length) return;
      const now = Date.now();
      for (let i = 0; i < this.items.length; i++) {
        const index = (start + i) % this.items.length;
        const blocked = this.exclusions.get(this.key(this.items[index]));
        if (!blocked || blocked.retryAt <= now) {this.index = index; this.play(this.items[index]); return;}
      }
      this.generation++; this.cleanup(); this.placeholder();
      this.change('fallback', '모든 콘텐츠 일시 제외 · 자동 재검사 대기', true);
      const next = Math.min(...[...this.exclusions.values()].map(x => x.retryAt));
      this.later(() => this.choose(start), Math.max(1000, next - now));
    }
    next() {this.choose((this.index + 1) % Math.max(1, this.items.length));}
    async play(item) {
      const token = ++this.generation; this.cleanup(); this.current = item; this.terminal = false;
      this.currentTime = 0; this.duration = 0; this.firstFrameAt = 0; this.playedMs = 0; this.frameCount = 0;
      this.progressTick = 0; this.lastProgressAt = 0; this.attemptId = uid(); this.lastError = null;
      this.o.onItem?.(this.side, item, this.index); this.placeholder();
      if (this.pauses.size) {this.change('paused', [...this.pauses].join(', ')); return;}
      this.controller = new AbortController();
      this.change('loading', '파일 준비 중');
      const sourceTimeout = this.later(() => this.fail(Object.assign(new Error('파일 준비 시간 초과'), {code: 'LV-MEDIA-SOURCE-TIMEOUT'}), 'source', token), this.o.sourceTimeoutMs || 90000);
      try {
        const src = await this.o.resolveSource(item, this.controller.signal);
        if (!this.valid(token)) {if (src.startsWith('blob:')) URL.revokeObjectURL(src); return;}
        this.cancelTimer(sourceTimeout); this.src = src;
        if (item.type === 'video') {
          const release = await this.o.acquire(this.controller.signal);
          if (!this.valid(token)) {release(); return;}
          this.releaseGate = release;
          // Yield once after releasing a previous decoder; never decode an extra preloaded video.
          this.later(() => {if (this.valid(token)) this.video(token);}, 120);
        } else this.image(token);
      } catch (error) {if (this.valid(token)) this.fail(error, 'source', token);}
    }
    image(token) {
      const img = document.createElement('img'); this.element = img;
      img.className = `media ${this.o.fit === 'contain' ? 'contain' : ''}`; img.alt = this.current?.title || 'LocalVision';
      const timeout = this.later(() => this.fail(Object.assign(new Error('이미지 표시 시간 초과'), {code:'LV-IMAGE-TIMEOUT'}), 'image', token), 15000);
      img.onload = () => {
        if (!this.valid(token)) return;
        this.cancelTimer(timeout); this.firstFrameAt = Date.now(); this.lastProgressAt = Date.now();
        this.o.zone.replaceChildren(img); this.duration = clamp(this.current.duration, 3, 86400, 20);
        if (this.poster && this.poster.src !== this.src && this.poster.src.startsWith('blob:')) URL.revokeObjectURL(this.poster.src);
        this.poster = {element:img,src:this.src,key:this.key(this.current)};
        this.change('image', '', this.exclusions.has(this.key(this.current)));
        this.later(() => {this.playedMs = this.duration * 1000; this.complete(token);}, this.duration * 1000);
      };
      img.onerror = () => this.fail(Object.assign(new Error('이미지 디코딩 실패'), {code:'LV-IMAGE-DECODE'}), 'image', token);
      img.src = this.src;
    }
    video(token) {
      const el = document.createElement('video'); this.element = el;
      el.className = `media ${this.o.fit === 'contain' ? 'contain' : ''}`;
      el.muted = true; el.defaultMuted = true; el.setAttribute('muted','');
      el.playsInline = true; el.setAttribute('playsinline',''); el.preload = 'auto'; el.autoplay = false; el.controls = false;
      this.o.zone.replaceChildren(el); this.change('starting', '영상 시작 확인 중');
      let playBusy = false, attempts = 0, lastPlayError = null;
      const started = () => {
        if (!this.valid(token)) return;
        this.lastProgressAt = Date.now(); this.progressTick = Date.now();
        if (this.releaseGate) {this.releaseGate(); this.releaseGate = null;}
      };
      const tryPlay = () => {
        if (!this.valid(token) || playBusy) return;
        playBusy = true; attempts++;
        Promise.resolve().then(() => el.play()).then(() => {
          if (!this.valid(token)) return;
          playBusy = false; started();
        }).catch(error => {
          if (!this.valid(token)) return;
          playBusy = false; lastPlayError = error;
          if (attempts < 2) this.later(tryPlay, 400);
          else this.fail(error, 'start', token);
        });
      };
      const progress = (position, frame) => {
        if (!this.valid(token)) return;
        const now = Date.now();
        if (!this.firstFrameAt) {
          this.firstFrameAt = now; this.event('LV-PLAY-START', '영상 첫 화면 진행 확인', 'info');
          this.change('playing', '', this.exclusions.has(this.key(this.current)));
        }
        if (this.progressTick && position >= this.currentTime) this.playedMs += Math.min(2500, now - this.progressTick);
        this.progressTick = now; this.lastProgressAt = now; this.currentTime = position;
        if (frame) this.frameCount++;
        if (this.releaseGate) {this.releaseGate(); this.releaseGate = null;}
      };
      const framesSupported = typeof el.requestVideoFrameCallback === 'function';
      const frame = (_now, metadata) => {
        if (!this.valid(token)) return;
        progress(Number(metadata.mediaTime) || Number(el.currentTime) || 0, true);
        this.rvfc = el.requestVideoFrameCallback(frame);
      };
      if (framesSupported) this.rvfc = el.requestVideoFrameCallback(frame);
      const poll = () => {
        if (!this.valid(token)) return;
        const now = Date.now();
        if (!framesSupported && !el.paused && Number(el.currentTime) > this.currentTime + 0.02) progress(Number(el.currentTime), false);
        if (!this.firstFrameAt && now - initial >= (this.o.startTimeoutMs || 20000)) {
          this.fail(lastPlayError || Object.assign(new Error('영상 첫 화면 진행 시간 초과'), {code:'LV-MEDIA-START-TIMEOUT'}), 'start', token); return;
        }
        if (this.firstFrameAt && !el.ended && now - this.lastProgressAt >= (this.o.stallTimeoutMs || 12000)) {
          this.fail(Object.assign(new Error('재생 화면이 진행되지 않습니다.'), {code:'LV-MEDIA-STALL'}), 'playback', token); return;
        }
        this.later(poll, 1000);
      };
      const initial = Date.now();
      el.onloadedmetadata = () => {if(this.valid(token)) this.duration = Number.isFinite(el.duration) ? el.duration : 0;};
      el.oncanplay = () => {if (attempts === 0) tryPlay();};
      el.onloadeddata = () => {if (attempts === 0) tryPlay();};
      el.onplaying = started;
      el.onended = () => {
        if (!this.valid(token)) return;
        if (!framesSupported && !this.firstFrameAt && Number(el.currentTime) > 0 && el.ended) progress(Number(el.currentTime), false);
        if (!this.firstFrameAt || (this.duration > 1 && Number(el.currentTime) < this.duration - 0.75)) {
          this.fail(Object.assign(new Error('영상 완료 전에 종료됨'), {code:'LV-MEDIA-EARLY-END'}), 'playback', token);
        } else {this.currentTime = Number(el.currentTime) || this.currentTime; this.complete(token);}
      };
      el.onerror = () => this.fail(Object.assign(new Error(el.error?.message || '영상 재생 오류'), {mediaCode:el.error?.code}), 'decode', token);
      el.src = this.src; el.load(); tryPlay(); this.later(poll, 1000);
    }
    complete(token) {
      if (!this.valid(token)) return;
      this.terminal = true;
      const key = this.key(this.current), recovered = this.failures.has(key) || this.exclusions.has(key);
      this.failures.delete(key); this.exclusions.delete(key); this.lastCompletedAt = new Date().toISOString();
      this.event('LV-PLAY-COMPLETE', '콘텐츠 재생 완료', 'info', {actualCompleted:true});
      if (recovered) {this.event('LV-MEDIA-RECOVERED', '제외 또는 실패 콘텐츠 정상 재생 복구', 'info'); this.o.onState?.(this.side,this.snapshot(),true);}
      this.next();
    }
    fail(error, phase, token) {
      if (!this.valid(token)) return;
      this.terminal = true;
      const type = classify(error, phase), now = Date.now(), key = this.key(this.current);
      const old = this.failures.get(key), count = old && now - old.at < 30 * 60000 ? old.count + 1 : 1;
      const debug = {name:error?.name || '', mediaCode:error?.mediaCode || this.element?.error?.code || 0, readyState:this.element?.readyState, networkState:this.element?.networkState, paused:this.element?.paused, frameCount:this.frameCount};
      this.lastError = {code:type.code, message:type.label, at:new Date().toISOString(), count};
      this.failures.set(key,{count,at:now});
      this.event(type.code, error?.message || type.label, 'error', {category:type.kind,failCount:count,...debug});
      this.cleanup(); this.placeholder();
      if (count === 1) {
        this.change('retrying', `${type.label} · 재시도 대기`, true);
        this.later(() => this.play(this.current), type.kind === 'policy' ? 3000 : 1500);
      } else {
        const retryAt = now + Math.min(15 * 60000, 60000 * 2 ** Math.min(4, count - 2));
        this.exclusions.set(key,{itemId:this.current?.id || '',fileName:this.current?.fileName || '',title:this.current?.title || '',url:this.current?.url || '',side:this.side,code:type.code,reason:type.label,failCount:count,retryAt,excludedAt:now});
        this.event('LV-MEDIA-SESSION-SKIP', '반복 실패로 콘텐츠 일시 제외 · 자동 재검사 예정', 'warning', {failCount:count,retryAt:new Date(retryAt).toISOString(),reasonCode:type.code});
        this.change('quarantined', type.label, true); this.later(() => this.next(), 1500);
      }
    }
    pause(reason) {
      if (this.pauses.has(reason)) return;
      this.pauses.add(reason);
      if (this.current && this.firstFrameAt && !this.terminal) this.event('LV-PLAY-INTERRUPTED', '정책에 따른 재생 일시 중단', 'info', {reason,intentional:true});
      this.generation++; this.cleanup(); this.placeholder(); this.change('paused', [...this.pauses].join(', '));
    }
    resume(reason) {
      if (!this.pauses.delete(reason)) return;
      if (!this.pauses.size && this.items.length) this.choose(this.index);
    }
    snapshot() {
      return {side:this.side,status:this.phase,reason:this.reason,itemId:this.current?.id || '',fileName:this.current?.fileName || '',title:this.current?.title || '',type:this.current?.type || '',currentTime:Number(this.element?.currentTime) || this.currentTime,duration:this.duration,frameCount:this.frameCount,firstFrameAt:this.firstFrameAt ? new Date(this.firstFrameAt).toISOString() : '',lastProgressAt:this.lastProgressAt ? new Date(this.lastProgressAt).toISOString() : '',lastCompletedAt:this.lastCompletedAt,lastError:this.lastError,playlistCount:this.items.length,index:this.index,exclusions:[...this.exclusions.values()]};
    }
    stop() {this.generation++; this.cleanup(); if (this.poster?.src.startsWith('blob:')) URL.revokeObjectURL(this.poster.src);this.poster=null;this.change('stopped');}
  }
  function createGate() {
    let active = false; const queue = [];
    function drain() {
      if (active) return;
      while (queue.length) {
        const job = queue.shift(); if (job.signal?.aborted) {job.reject(abortError());continue;}
        active = true; job.signal?.removeEventListener('abort',job.cancel);
        let released = false;
        job.resolve(() => {if (released) return; released = true; active = false; drain();}); return;
      }
    }
    return signal => new Promise((resolve,reject) => {
      if (signal?.aborted) {reject(abortError());return;}
      const job = {signal,resolve,reject};
      job.cancel = () => {const i = queue.indexOf(job);if(i >= 0) queue.splice(i,1);reject(abortError());};
      signal?.addEventListener('abort',job.cancel,{once:true});queue.push(job);drain();
    });
  }
  root.LVRuntime = {clamp,uid,readJSON,timedFetch,Outbox,Lane,createGate};
})(typeof window !== 'undefined' ? window : globalThis);
