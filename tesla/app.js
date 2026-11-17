/*
 * مختبر الفيديو — Tesla Browser Video Lab
 * نموذج أولي تجريبي لاختبار تشغيل YouTube داخل متصفح Tesla.
 *
 * ملاحظات توافق: الكود مكتوب بصيغة ES2015 تقريبًا (بدون ?. أو ?? أو async/await
 * أو replaceAll) ليعمل على Chromium 79 الموجود في بعض إصدارات MCU2.
 */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var DISCLAIMER_VERSION = '1';

  // ---------------------------------------------------------------- أدوات
  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn, opt) { el.addEventListener(ev, fn, opt || false); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var ss = s < 10 ? '0' + s : '' + s;
    if (h) return h + ':' + (m < 10 ? '0' + m : m) + ':' + ss;
    return m + ':' + ss;
  }
  function fmtMs(ms) { return ms == null ? '—' : (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s'); }

  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('tvl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('tvl.' + k, JSON.stringify(v)); } catch (e) { /* وضع التصفّح الخاص */ } }
  };
  var session = {
    get: function (k) { try { return sessionStorage.getItem('tvl.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem('tvl.' + k, v); } catch (e) { } }
  };

  var toastTimer;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }

  // ---------------------------------------------------------------- سجل الأحداث
  var events = [];
  var t0 = Date.now();
  function log(msg, level) {
    var entry = { t: ((Date.now() - t0) / 1000).toFixed(1), msg: msg, level: level || 'i' };
    events.push(entry);
    if (events.length > 200) events.shift();
    var li = document.createElement('li');
    li.className = entry.level;
    li.textContent = '+' + entry.t + 's  ' + msg;
    var ol = $('log');
    ol.insertBefore(li, ol.firstChild);
    while (ol.childNodes.length > 80) ol.removeChild(ol.lastChild);
  }

  // ---------------------------------------------------------------- البيئة
  function detectEnv() {
    var ua = navigator.userAgent || '';
    var tesla = /Tesla\/([\w.\-]+)/.exec(ua);
    var qt = /QtCarBrowser/i.test(ua);
    var chrome = /(?:Chrome|Chromium)\/(\d+)[\d.]*/.exec(ua);
    var env = {
      ua: ua,
      isTesla: !!tesla || qt,
      teslaVersion: tesla ? tesla[1] : (qt ? 'QtCarBrowser (MCU1)' : null),
      chromeMajor: chrome ? parseInt(chrome[1], 10) : null,
      screen: screen.width + '×' + screen.height,
      viewport: window.innerWidth + '×' + window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      cores: navigator.hardwareConcurrency || null,
      memory: navigator.deviceMemory || null,
      lang: navigator.language
    };
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c) {
      env.net = { type: c.type || null, effectiveType: c.effectiveType || null, downlink: c.downlink, rtt: c.rtt, saveData: !!c.saveData };
    }
    // تقدير جيل الحاسوب: Chromium ≥ 100 تقريبًا يعني تحديث برمجي حديث (MCU2 مُحدّث أو MCU3)
    if (qt) env.mcuGuess = 'MCU1 — غير مدعوم غالبًا';
    else if (env.isTesla && env.cores >= 8) env.mcuGuess = 'MCU3 (AMD Ryzen) على الأرجح';
    else if (env.isTesla) env.mcuGuess = 'MCU2 (Intel Atom) على الأرجح';
    return env;
  }

  function featureSupport() {
    var css = window.CSS && CSS.supports ? CSS.supports.bind(CSS) : function () { return false; };
    return [
      ['Promise', typeof Promise !== 'undefined'],
      ['fetch', typeof fetch === 'function'],
      ['URL API', typeof URL === 'function'],
      ['IntersectionObserver', 'IntersectionObserver' in window],
      ['Service Worker', 'serviceWorker' in navigator],
      ['Fullscreen API', !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)],
      ['localStorage', (function () { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return true; } catch (e) { return false; } })()],
      ['Geolocation', 'geolocation' in navigator],
      ['Network Info', !!(navigator.connection)],
      ['Media Source', 'MediaSource' in window],
      ['VP9', !!(window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported('video/webm; codecs="vp9"'))],
      ['AV1', !!(window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported('video/mp4; codecs="av01.0.05M.08"'))],
      ['H.264', !!(window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'))],
      ['CSS Grid', css('display', 'grid')],
      ['CSS Variables', css('--a', '0')],
      ['Clipboard', !!(navigator.clipboard)]
    ];
  }

  // ارتفاع النافذة الفعلي (شريط أدوات المتصفح يُنقص منه)
  function setVh() { document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px'); }

  // ---------------------------------------------------------------- الإعدادات
  var DEFAULTS = {
    quality: 'default', autoRecover: true, threshold: 4, autoDowngrade: true,
    nativeControls: true, nocookie: false, lite: false, motionGuard: false
  };
  var settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  function saveSettings() { store.set('settings', settings); }

  var QUALITIES = [
    ['default', 'تلقائي'], ['hd1080', '1080p'], ['hd720', '720p'],
    ['large', '480p'], ['medium', '360p'], ['small', '240p'], ['tiny', '144p']
  ];
  var QUALITY_LADDER = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  var QUALITY_LABEL = { highres: '4K+', hd2880: '2880p', hd2160: '2160p', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p', auto: 'تلقائي', 'default': 'تلقائي', unknown: '—' };

  // ---------------------------------------------------------------- عيّنات الاختبار
  var SAMPLES = [
    { id: 'aqz-KE-bpKQ', title: 'Big Buck Bunny — 4K 60fps', note: 'اختبار دقة عالية ومعدّل إطارات 60' },
    { id: 'LXb3EKWsInQ', title: 'Costa Rica 4K 60fps HDR', note: 'محتوى طبيعي كثيف التفاصيل — ضغط عالٍ على فك الترميز' },
    { id: 'eRsGyueVLvQ', title: 'Sintel — Blender Open Movie', note: 'فيلم قصير 15 دقيقة — اختبار ثبات طويل' },
    { id: 'R6MlUcmOul8', title: 'Tears of Steel', note: 'مشاهد حركة ومؤثرات' },
    { id: 'jfKfPfyJRdk', title: 'lofi hip hop radio — بث مباشر', note: 'اختبار البث المباشر وزمن التأخير' },
    { id: 'jNQXAC9IVRw', title: 'Me at the zoo', note: 'مقطع خفيف جدًا 240p — خط أساس للشبكة' }
  ];

  // ---------------------------------------------------------------- السجل
  var history = store.get('history', []);
  function addHistory(item) {
    history = history.filter(function (h) { return !(h.id === item.id && h.list === item.list); });
    history.unshift({ id: item.id || null, list: item.list || null, title: item.title || null, ts: Date.now() });
    if (history.length > 25) history.length = 25;
    store.set('history', history);
    renderHistory();
  }
  function updateHistoryTitle(id, title) {
    var changed = false;
    history.forEach(function (h) { if (h.id === id && h.title !== title) { h.title = title; changed = true; } });
    if (changed) { store.set('history', history); renderHistory(); }
  }

  function thumbUrl(id) { return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; }
  function itemHtml(it, note) {
    var thumb = it.id ? '<div class="thumb" style="background-image:url(\'' + thumbUrl(it.id) + '\')"></div>' : '<div class="thumb"></div>';
    var title = it.title || (it.list ? 'قائمة تشغيل ' + it.list.slice(0, 10) + '…' : it.id);
    return thumb + '<div class="vmeta"><div class="vtitle">' + esc(title) + '</div><div class="vnote">' + esc(note || '') + '</div></div>';
  }
  function renderList(ul, items, noteFn) {
    ul.innerHTML = '';
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'vitem' + (current && it.id && current.id === it.id ? ' current' : '');
      li.innerHTML = itemHtml(it, noteFn(it));
      on(li, 'click', function () { play({ id: it.id, list: it.list, title: it.title }); });
      ul.appendChild(li);
    });
  }
  function renderSamples() { renderList($('samples'), SAMPLES, function (s) { return s.note; }); }
  function renderHistory() {
    renderList($('history'), history, function (h) { return new Date(h.ts).toLocaleString('ar'); });
    $('history-empty').hidden = history.length > 0;
  }

  // ---------------------------------------------------------------- تحليل الروابط
  function parseTime(t) {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    var m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    if (!m) return 0;
    return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
  }
  function parseInput(str) {
    str = (str || '').trim();
    if (!str) return null;
    if (/^[\w-]{11}$/.test(str)) return { id: str };
    if (/^(PL|UU|LL|RD|OL)[\w-]{10,}$/.test(str)) return { list: str };
    var url;
    try { url = new URL(/^https?:\/\//i.test(str) ? str : 'https://' + str); } catch (e) { return null; }
    var host = url.hostname.replace(/^(www|m|music)\./, '');
    var id = null, m;
    if (host === 'youtu.be') {
      m = /^\/([\w-]{11})/.exec(url.pathname); if (m) id = m[1];
    } else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      id = url.searchParams.get('v');
      if (!id) { m = /\/(?:embed|shorts|live|v|e)\/([\w-]{11})/.exec(url.pathname); if (m) id = m[1]; }
    } else {
      return null;
    }
    if (id && !/^[\w-]{11}$/.test(id)) id = null;
    var list = url.searchParams.get('list');
    if (!id && !list) return null;
    return { id: id, list: list || null, start: parseTime(url.searchParams.get('t') || url.searchParams.get('start')) };
  }

  // ---------------------------------------------------------------- YouTube IFrame API
  var apiPromise = null;
  function loadApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      var started = now();
      var timer = setTimeout(function () { reject(new Error('انتهت مهلة تحميل مكتبة YouTube')); }, 20000);
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        clearTimeout(timer);
        log('IFrame API ready in ' + fmtMs(now() - started));
        if (typeof prev === 'function') prev();
        resolve(window.YT);
      };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = function () { clearTimeout(timer); apiPromise = null; reject(new Error('تعذّر تحميل مكتبة YouTube — تحقّق من الاتصال')); };
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  var player = null;
  var playerReady = false;
  var playerConfig = null;   // الإعدادات التي أُنشئ بها المشغل الحالي
  var current = null;        // { id, list, title, start }
  var pendingLoad = null;

  // مقاييس جلسة التشغيل الحالية
  var M = null;
  function resetMetrics(item) {
    M = {
      videoId: item.id, list: item.list || null,
      requestedAt: now(), startupMs: null, firstPlay: false,
      stalls: 0, stallMs: 0, stallStart: null, longestStallMs: 0,
      recoveries: 0, recoveryTimes: [], qualityChanges: 0, qualityHistory: [],
      errors: [], state: 'unstarted', frozenFor: 0, bufferingFor: 0, lastTime: -1, downgrades: 0
    };
  }

  var STATE_NAME = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
  var ERRORS = {
    2: 'معرّف الفيديو غير صالح',
    5: 'خطأ في مشغل HTML5 — قد لا يدعم المتصفح هذا المحتوى',
    100: 'الفيديو غير موجود أو أصبح خاصًا',
    101: 'صاحب الفيديو لا يسمح بتشغيله في المواقع الأخرى',
    150: 'صاحب الفيديو لا يسمح بتشغيله في المواقع الأخرى',
    152: 'تعذّر تشغيل المحتوى المضمّن',
    153: 'خطأ في إعداد المشغل (عادةً بسبب ترويسة Referer) — افتح الموقع عبر https'
  };

  function wantConfig() { return { controls: settings.nativeControls ? 1 : 0, nocookie: settings.nocookie }; }
  function sameConfig(a, b) { return a && b && a.controls === b.controls && a.nocookie === b.nocookie; }

  function play(item) {
    if (!item || (!item.id && !item.list)) return;
    if (motionBlocked) { toast('الفيديو موقوف: السيارة تتحرك'); return; }
    current = { id: item.id || null, list: item.list || null, title: item.title || null, start: item.start || 0 };
    resetMetrics(current);
    log('load ' + (current.id || '') + (current.list ? ' list=' + current.list : '') + (current.start ? ' t=' + current.start : ''));
    addHistory(current);
    renderSamples();
    $('placeholder').hidden = true;
    showBuffering(true, 'جارٍ تجهيز المشغل…');
    setControlsEnabled(true);

    loadApi().then(function () {
      var cfg = wantConfig();
      if (player && playerReady && sameConfig(cfg, playerConfig)) {
        loadIntoPlayer(current);   // إعادة استخدام نفس الـ iframe = أسرع بكثير من إعادة إنشائه
      } else {
        createPlayer(current, cfg);
      }
    }).catch(function (err) {
      showBuffering(false);
      log(err.message, 'e');
      toast(err.message, 5000);
    });
  }

  function loadIntoPlayer(it) {
    var q = settings.quality;
    if (it.list) {
      player.loadPlaylist({ list: it.list, listType: 'playlist', index: 0, startSeconds: it.start || 0, suggestedQuality: q });
    } else {
      player.loadVideoById({ videoId: it.id, startSeconds: it.start || 0, suggestedQuality: q });
    }
  }

  function createPlayer(it, cfg) {
    if (player) {
      try { player.destroy(); } catch (e) { }
      player = null;
    }
    playerReady = false;
    var box = $('player-box');
    var old = $('player');
    if (old) old.parentNode.removeChild(old);
    var div = document.createElement('div');
    div.id = 'player';
    box.insertBefore(div, box.firstChild);

    var vars = {
      autoplay: 1, playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1,
      controls: cfg.controls, fs: 1, enablejsapi: 1, cc_load_policy: 0, disablekb: 0
    };
    if (location.origin && location.origin !== 'null') {
      vars.origin = location.origin;
      vars.widget_referrer = location.href;
    }
    if (it.start) vars.start = it.start;
    if (it.list) { vars.listType = 'playlist'; vars.list = it.list; }

    var opts = {
      width: '100%', height: '100%', playerVars: vars,
      events: {
        onReady: onReady, onStateChange: onStateChange, onError: onError,
        onPlaybackQualityChange: onQualityChange, onPlaybackRateChange: function (e) { log('rate ' + e.data); }
      }
    };
    if (it.id) opts.videoId = it.id;
    if (cfg.nocookie) opts.host = 'https://www.youtube-nocookie.com';
    playerConfig = cfg;
    var created = now();
    player = new YT.Player('player', opts);
    log('player created (host=' + (cfg.nocookie ? 'nocookie' : 'youtube') + ', controls=' + cfg.controls + ')');
    player._createdAt = created;
  }

  function onReady() {
    playerReady = true;
    log('player ready in ' + fmtMs(now() - player._createdAt));
    if (settings.quality !== 'default') suggestQuality(settings.quality);
    applyMute();
    try { player.playVideo(); } catch (e) { }
    startWatchdog();
  }

  function onStateChange(e) {
    if (!M) return;
    var s = e.data;
    var name = STATE_NAME[s] || String(s);
    var prev = M.state;
    M.state = name;
    log('state ' + name);

    // نهاية فترة تقطيع
    if (prev === 'buffering' && M.stallStart != null && name !== 'buffering') {
      var d = now() - M.stallStart;
      M.stallMs += d; if (d > M.longestStallMs) M.longestStallMs = d;
      M.stallStart = null;
      if (d > 300) log('stall ended after ' + fmtMs(d), 'w');
    }

    if (s === 1) { // playing
      if (!M.firstPlay) {
        M.firstPlay = true;
        M.startupMs = now() - M.requestedAt;
        log('startup time ' + fmtMs(M.startupMs));
      }
      showBuffering(false);
      var data = player.getVideoData ? player.getVideoData() : null;
      if (data && data.video_id) {
        if (current && !current.id) current.id = data.video_id;
        if (current && data.title) { current.title = data.title; updateHistoryTitle(data.video_id, data.title); }
      }
      M.bufferingFor = 0;
    } else if (s === 3) { // buffering
      if (M.firstPlay) {
        M.stalls++;
        M.stallStart = now();
        showBuffering(true, 'تخزين مؤقت…');
      } else {
        showBuffering(true, 'جارٍ التحميل…');
      }
    } else {
      showBuffering(false);
    }
    if (s === 0 && current) current.start = 0;
    updatePlayIcon(s === 1 || s === 3);
    updateHealth();
  }

  function onError(e) {
    var msg = ERRORS[e.data] || ('خطأ غير معروف (' + e.data + ')');
    if (M) M.errors.push({ code: e.data, at: ((now() - M.requestedAt) / 1000).toFixed(1) });
    log('error ' + e.data + ': ' + msg, 'e');
    toast(msg, 6000);
    showBuffering(false);
    updateHealth();
  }

  function onQualityChange(e) {
    if (!M) return;
    M.qualityChanges++;
    M.qualityHistory.push(e.data);
    log('quality → ' + (QUALITY_LABEL[e.data] || e.data));
  }

  // ملاحظة: YouTube قد يتجاهل الاقتراح ويختار الجودة بنفسه (ABR). نحاول ثم نعرض الجودة الفعلية.
  function suggestQuality(q) {
    if (!player || !playerReady) return;
    try {
      if (player.setPlaybackQualityRange) player.setPlaybackQualityRange(q, q);
      player.setPlaybackQuality(q);
    } catch (e) { }
  }

  // ---------------------------------------------------------------- حارس التجمّد والإنعاش
  var watchdog = null;
  function startWatchdog() {
    if (watchdog) return;
    watchdog = setInterval(tick, 1000);
  }

  function tick() {
    if (!player || !playerReady || !M) return;
    var state, t;
    try { state = player.getPlayerState(); t = player.getCurrentTime(); } catch (e) { return; }

    if (state === 1) {
      // الوقت لا يتقدّم رغم أن الحالة «تشغيل» = تجمّد صامت
      if (M.lastTime >= 0 && Math.abs(t - M.lastTime) < 0.05) M.frozenFor++;
      else M.frozenFor = 0;
      if (M.frozenFor >= settings.threshold && settings.autoRecover) recover('frozen');
    } else {
      M.frozenFor = 0;
    }
    if (state === 3 && M.firstPlay) {
      M.bufferingFor++;
      if (M.bufferingFor >= settings.threshold * 2 && settings.autoRecover) recover('long-buffering');
    } else {
      M.bufferingFor = 0;
    }
    M.lastTime = t;

    updateProgress();
    if (activeTab === 'diag') renderDiagSession();
  }

  function recover(reason, manual) {
    if (!player || !M) return;
    var t = 0;
    try { t = player.getCurrentTime(); } catch (e) { }
    var nowMs = now();
    M.recoveryTimes = M.recoveryTimes.filter(function (x) { return nowMs - x < 60000; });
    M.recoveryTimes.push(nowMs);
    M.recoveries++;
    M.frozenFor = 0; M.bufferingFor = 0;
    var level = manual ? 2 : M.recoveryTimes.length;
    log('recover #' + M.recoveries + ' (' + reason + ', level ' + level + ') at ' + t.toFixed(1) + 's', 'w');

    // تصعيد تدريجي: 1) قفزة صغيرة  2) خفض الجودة + إعادة تحميل من نفس الموضع  3) إعادة إنشاء المشغل
    if (level >= 2 && settings.autoDowngrade) stepDownQuality();
    if (level === 1) {
      player.seekTo(t + 0.3, true);
      player.playVideo();
      toast('تم رصد تجمّد — جارٍ الاستئناف');
    } else if (level === 2 || !current) {
      if (current && current.id && !current.list) {
        player.loadVideoById({ videoId: current.id, startSeconds: Math.max(0, t - 1), suggestedQuality: currentSuggested() });
      } else {
        player.seekTo(t, true); player.playVideo();
      }
      toast('جارٍ إعادة تحميل المقطع من الموضع الحالي');
    } else {
      current.start = Math.max(0, Math.floor(t - 1));
      M.recoveryTimes = [];
      createPlayer(current, wantConfig());
      toast('إعادة إنشاء المشغل بالكامل');
    }
    updateHealth();
  }

  var dynamicQuality = null;
  function currentSuggested() { return dynamicQuality || settings.quality; }
  // خطوة واحدة أقل من الجودة الحالية، وبحد أقصى 720p (ما فوقها نادرًا ما يفيد على شاشة السيارة)
  function stepDownQuality() {
    var q = 'unknown';
    try { q = player.getPlaybackQuality(); } catch (e) { }
    var idx = QUALITY_LADDER.indexOf(q);
    var cap = QUALITY_LADDER.indexOf('hd720');
    var next = idx < 0 ? 'hd720' : QUALITY_LADDER[Math.min(QUALITY_LADDER.length - 1, Math.max(idx + 1, cap))];
    if (next === q) return;
    dynamicQuality = next;
    if (M) M.downgrades++;
    suggestQuality(next);
    log('auto downgrade ' + (QUALITY_LABEL[q] || q) + ' → ' + QUALITY_LABEL[next], 'w');
    syncQualitySelect();
  }

  // ---------------------------------------------------------------- واجهة التحكم
  function showBuffering(show, text) {
    $('buffering').hidden = !show;
    if (text) $('buf-text').textContent = text;
  }
  function setControlsEnabled(en) {
    ['b-back', 'b-play', 'b-fwd', 'b-mute', 's-rate', 'b-recover', 'seek'].forEach(function (id) { $(id).disabled = !en; });
  }
  function updatePlayIcon(playing) {
    $('b-play-icon').firstElementChild.setAttribute('href', playing ? '#i-pause' : '#i-play');
  }
  var seeking = false;
  function updateProgress() {
    if (seeking || !player || !playerReady) return;
    var d = 0, t = 0;
    try { d = player.getDuration() || 0; t = player.getCurrentTime() || 0; } catch (e) { return; }
    $('t-cur').textContent = fmtTime(t);
    $('t-dur').textContent = d ? fmtTime(d) : 'مباشر';
    $('seek').value = d ? Math.round((t / d) * 1000) : 1000;
  }

  var muted = store.get('muted', false);
  function applyMute() {
    if (!player || !playerReady) return;
    if (muted) player.mute(); else player.unMute();
    $('b-mute-icon').firstElementChild.setAttribute('href', muted ? '#i-mute' : '#i-vol');
  }

  function syncQualitySelect() {
    var sel = $('s-quality');
    var v = currentSuggested();
    sel.value = v;
    if (sel.value !== v) sel.value = 'default';
  }

  function fillQualitySelect(sel, value) {
    sel.innerHTML = QUALITIES.map(function (q) { return '<option value="' + q[0] + '">' + q[1] + '</option>'; }).join('');
    sel.value = value;
  }

  // وضع المسرح + محاولة ملء الشاشة الحقيقي إن توفّر
  var theater = false, idleTimer = null;
  function setTheater(onOff) {
    theater = onOff;
    var app = $('app');
    app.classList.toggle('theater', theater);
    $('b-theater-icon').firstElementChild.setAttribute('href', theater ? '#i-shrink' : '#i-expand');
    var de = document.documentElement;
    try {
      if (theater) {
        var rq = de.requestFullscreen || de.webkitRequestFullscreen;
        if (rq) { var p = rq.call(de); if (p && p.catch) p.catch(function () { }); }
      } else if (document.fullscreenElement || document.webkitFullscreenElement) {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) { var p2 = ex.call(document); if (p2 && p2.catch) p2.catch(function () { }); }
      }
    } catch (e) { }
    bumpIdle();
  }
  function bumpIdle() {
    var app = $('app');
    app.classList.remove('idle');
    clearTimeout(idleTimer);
    if (theater) idleTimer = setTimeout(function () { app.classList.add('idle'); }, 3500);
  }

  // ---------------------------------------------------------------- مؤشر الصحة
  function updateHealth() {
    var chip = $('chip-health');
    if (!M) { chip.textContent = 'لا يوجد تشغيل'; chip.className = 'chip'; return; }
    if (M.errors.length) { chip.textContent = 'خطأ في التشغيل'; chip.className = 'chip bad'; return; }
    if (M.stalls >= 4 || M.recoveries >= 2) { chip.textContent = 'تقطيع متكرر (' + M.stalls + ')'; chip.className = 'chip bad'; return; }
    if (M.stalls >= 1) { chip.textContent = 'تقطيع: ' + M.stalls; chip.className = 'chip warn'; return; }
    chip.textContent = M.firstPlay ? 'تشغيل سلس' : 'جارٍ التحميل'; chip.className = 'chip ok';
  }

  // ---------------------------------------------------------------- التشخيص
  var ENV = null;
  var activeTab = 'samples';
  function kv(dl, rows) {
    dl.innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
  }
  function renderDiagSession() {
    var q = '—', avail = '—', loaded = '—', state = '—';
    if (player && playerReady) {
      try {
        q = QUALITY_LABEL[player.getPlaybackQuality()] || player.getPlaybackQuality();
        var a = player.getAvailableQualityLevels() || [];
        avail = a.length ? a.map(function (x) { return QUALITY_LABEL[x] || x; }).join('، ') : '—';
        loaded = Math.round((player.getVideoLoadedFraction() || 0) * 100) + '%';
      } catch (e) { }
    }
    if (M) state = M.state;
    var liveStall = M && M.stallStart != null ? now() - M.stallStart : 0;
    kv($('diag-session'), [
      ['الفيديو', current ? (current.title || current.id || current.list) : '—'],
      ['الحالة', state],
      ['زمن بدء التشغيل', M ? fmtMs(M.startupMs) : '—'],
      ['مرات التقطيع', M ? M.stalls : '—'],
      ['إجمالي زمن التقطيع', M ? fmtMs(M.stallMs + liveStall) : '—'],
      ['أطول تقطيع', M ? fmtMs(Math.max(M.longestStallMs, liveStall)) : '—'],
      ['عمليات الإنعاش', M ? M.recoveries : '—'],
      ['خفض الجودة التلقائي', M ? M.downgrades : '—'],
      ['الجودة الفعلية', q],
      ['الجودات المتاحة', avail],
      ['تغييرات الجودة', M ? M.qualityChanges : '—'],
      ['المحمَّل مسبقًا', loaded],
      ['أخطاء', M && M.errors.length ? M.errors.map(function (x) { return x.code; }).join(', ') : '0'],
      ['معدّل إطارات الواجهة', fps ? fps + ' fps' : '—']
    ]);
  }
  function renderDiagEnv() {
    ENV = detectEnv();
    var net = ENV.net ? [ENV.net.effectiveType, ENV.net.downlink != null ? ENV.net.downlink + ' Mbps' : null, ENV.net.rtt != null ? 'RTT ' + ENV.net.rtt + 'ms' : null].filter(Boolean).join(' · ') : 'غير متاح';
    kv($('diag-env'), [
      ['متصفح Tesla', ENV.isTesla ? 'نعم' : 'لا (متصفح آخر)'],
      ['إصدار البرنامج', ENV.teslaVersion || '—'],
      ['تقدير الحاسوب', ENV.mcuGuess || '—'],
      ['Chromium', ENV.chromeMajor || '—'],
      ['الشاشة', ENV.screen + ' @' + ENV.dpr + 'x'],
      ['مساحة العرض', ENV.viewport],
      ['أنوية المعالج', ENV.cores || '—'],
      ['الذاكرة (تقريبية)', ENV.memory ? ENV.memory + ' GB' : '—'],
      ['الشبكة', net],
      ['زمن الوصول لـ YouTube', pingResult || 'لم يُقَس'],
      ['User-Agent', ENV.ua]
    ]);
    $('diag-features').innerHTML = featureSupport().map(function (f) {
      return '<li><span class="' + (f[1] ? 'y' : 'n') + '">' + (f[1] ? '✓' : '✗') + '</span> ' + esc(f[0]) + '</li>';
    }).join('');
  }
  function renderChips() {
    var env = detectEnv();
    var ce = $('chip-env');
    if (env.isTesla) { ce.textContent = 'Tesla ' + (env.teslaVersion || ''); ce.className = 'chip ok'; }
    else { ce.textContent = 'متصفح غير Tesla' + (env.chromeMajor ? ' · Chrome ' + env.chromeMajor : ''); ce.className = 'chip'; }
    var cn = $('chip-net');
    if (!navigator.onLine) { cn.textContent = 'غير متصل'; cn.className = 'chip bad'; }
    else if (env.net && env.net.effectiveType) {
      cn.textContent = 'الشبكة: ' + env.net.effectiveType + (env.net.downlink ? ' · ' + env.net.downlink + 'Mbps' : '');
      cn.className = 'chip ' + (/^(slow-2g|2g)$/.test(env.net.effectiveType) ? 'bad' : env.net.effectiveType === '3g' ? 'warn' : 'ok');
    } else { cn.textContent = 'متصل'; cn.className = 'chip ok'; }
  }

  // عدّاد معدّل إطارات الواجهة: يعمل فقط عند فتح تبويب التشخيص لتوفير الموارد
  var fps = 0, fpsRaf = null, fpsFrames = 0, fpsStart = 0;
  function fpsLoop(ts) {
    if (!fpsStart) fpsStart = ts;
    fpsFrames++;
    if (ts - fpsStart >= 1000) { fps = Math.round(fpsFrames * 1000 / (ts - fpsStart)); fpsFrames = 0; fpsStart = ts; }
    fpsRaf = requestAnimationFrame(fpsLoop);
  }
  function fpsRun(onOff) {
    if (onOff && !fpsRaf) { fpsStart = 0; fpsFrames = 0; fpsRaf = requestAnimationFrame(fpsLoop); }
    if (!onOff && fpsRaf) { cancelAnimationFrame(fpsRaf); fpsRaf = null; }
  }

  // قياس تقريبي لزمن الوصول: تحميل صورة مصغّرة صغيرة من i.ytimg.com (نفس شبكة CDN) ثلاث مرات
  var pingResult = null;
  function ping() {
    var id = (current && current.id) || SAMPLES[0].id;
    var results = [];
    $('b-ping').disabled = true;
    function one(n) {
      if (n === 0) {
        results.sort(function (a, b) { return a - b; });
        pingResult = results.length ? 'وسيط ' + Math.round(results[Math.floor(results.length / 2)]) + ' ms (' + results.map(Math.round).join('/') + ')' : 'فشل القياس';
        log('ping ' + pingResult);
        $('b-ping').disabled = false;
        renderDiagEnv();
        return;
      }
      var img = new Image();
      var st = now();
      img.onload = function () { results.push(now() - st); one(n - 1); };
      img.onerror = function () { one(n - 1); };
      img.src = 'https://i.ytimg.com/vi/' + id + '/default.jpg?_=' + Date.now() + n;
    }
    one(3);
  }

  function buildReport() {
    var r = {
      app: 'tesla-video-lab', version: VERSION, generatedAt: new Date().toISOString(),
      env: detectEnv(), settings: settings, video: current,
      metrics: M ? {
        startupMs: M.startupMs && Math.round(M.startupMs), stalls: M.stalls, stallMs: Math.round(M.stallMs),
        longestStallMs: Math.round(M.longestStallMs), recoveries: M.recoveries, downgrades: M.downgrades,
        qualityChanges: M.qualityChanges, qualityHistory: M.qualityHistory, errors: M.errors, state: M.state
      } : null,
      ping: pingResult, uiFps: fps || null,
      events: events.slice(-80)
    };
    try { r.actualQuality = player && playerReady ? player.getPlaybackQuality() : null; } catch (e) { }
    return JSON.stringify(r, null, 2);
  }

  function copyText(text, ta) {
    function fallback() {
      ta.focus(); ta.select();
      try { document.execCommand('copy'); toast('تم النسخ'); } catch (e) { toast('حدّد النص وانسخه يدويًا'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('تم النسخ'); }, fallback);
    } else fallback();
  }

  // ---------------------------------------------------------------- حارس الحركة (اختياري)
  var geoWatch = null, motionBlocked = false, speedOverSince = null;
  function setMotionGuard(enabled) {
    var st = $('motion-status');
    if (geoWatch != null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
    if (!enabled) { st.textContent = ''; unblockMotion(); return; }
    if (!('geolocation' in navigator)) { st.textContent = 'الموقع الجغرافي غير مدعوم في هذا المتصفح.'; return; }
    st.textContent = 'جارٍ طلب إذن الموقع…';
    geoWatch = navigator.geolocation.watchPosition(function (pos) {
      var sp = pos.coords.speed; // م/ث
      if (sp == null || isNaN(sp)) { st.textContent = 'الحارس يعمل، لكن المتصفح لا يوفّر السرعة.'; return; }
      var kmh = sp * 3.6;
      st.textContent = 'الحارس يعمل · السرعة الحالية ' + kmh.toFixed(0) + ' كم/س';
      if (kmh > 6) {
        if (speedOverSince == null) speedOverSince = Date.now();
        if (Date.now() - speedOverSince > 1500 || kmh > 15) blockMotion(kmh);
      } else {
        speedOverSince = null;
        if (kmh < 1) unblockMotion();
      }
    }, function (err) {
      st.textContent = 'تعذّر تفعيل الحارس: ' + (err.code === 1 ? 'تم رفض الإذن' : err.message);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  }
  function blockMotion(kmh) {
    $('mb-speed').textContent = kmh.toFixed(0);
    if (motionBlocked) return;
    motionBlocked = true;
    $('motion-block').hidden = false;
    if (player && playerReady) { try { player.pauseVideo(); } catch (e) { } }
    log('motion guard: paused at ' + kmh.toFixed(0) + ' km/h', 'w');
  }
  function unblockMotion() {
    if (!motionBlocked) return;
    motionBlocked = false;
    $('motion-block').hidden = true;
    log('motion guard: vehicle stopped');
  }

  // ---------------------------------------------------------------- إخلاء المسؤولية
  function showDisclaimer() {
    var dz = $('disclaimer');
    $('dz-c1').checked = false; $('dz-c2').checked = false;
    $('dz-accept').disabled = true;
    dz.hidden = false;
    setTimeout(function () { try { $('dz-c1').focus(); } catch (e) { } }, 50);
    if (player && playerReady) { try { player.pauseVideo(); } catch (e) { } }
  }
  function initDisclaimer() {
    function upd() { $('dz-accept').disabled = !($('dz-c1').checked && $('dz-c2').checked); }
    on($('dz-c1'), 'change', upd);
    on($('dz-c2'), 'change', upd);
    on($('dz-accept'), 'click', function () {
      if (!($('dz-c1').checked && $('dz-c2').checked)) return;
      session.set('dz', DISCLAIMER_VERSION);
      var acc = store.get('dz-log', []);
      acc.push(new Date().toISOString());
      store.set('dz-log', acc.slice(-20));
      $('disclaimer').hidden = true;
      log('disclaimer accepted');
      loadApi().catch(function () { }); // تحميل المكتبة مسبقًا بعد الموافقة لتسريع أول تشغيل
    });
    on($('dz-leave'), 'click', function () {
      if (window.history.length > 1) window.history.back();
      else location.href = 'about:blank';
    });
    if (session.get('dz') !== DISCLAIMER_VERSION) showDisclaimer();
    else loadApi().catch(function () { });
  }

  // ---------------------------------------------------------------- الربط
  function bindSettings() {
    fillQualitySelect($('set-quality'), settings.quality);
    fillQualitySelect($('s-quality'), settings.quality);
    $('set-recover').checked = settings.autoRecover;
    $('set-threshold').value = settings.threshold;
    $('set-threshold-v').textContent = settings.threshold;
    $('set-downgrade').checked = settings.autoDowngrade;
    $('set-native').checked = settings.nativeControls;
    $('set-nocookie').checked = settings.nocookie;
    $('set-lite').checked = settings.lite;
    $('set-motion').checked = settings.motionGuard;
    document.body.classList.toggle('lite', settings.lite);
  }

  function init() {
    setVh();
    on(window, 'resize', setVh);
    on(window, 'orientationchange', setVh);
    $('app-version').textContent = VERSION;

    initDisclaimer();
    bindSettings();
    renderSamples();
    renderHistory();
    renderChips();
    updateHealth();
    on(window, 'online', renderChips);
    on(window, 'offline', renderChips);
    if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', renderChips);

    // الإدخال
    on($('url-form'), 'submit', function (e) {
      e.preventDefault();
      var parsed = parseInput($('url-input').value);
      if (!parsed) { toast('رابط غير صالح — الصق رابط YouTube أو معرّف فيديو من 11 حرفًا'); return; }
      $('url-input').blur();
      play(parsed);
    });
    on($('b-paste'), 'click', function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast('اللصق التلقائي غير مدعوم — استخدم لوحة المفاتيح'); $('url-input').focus(); return; }
      navigator.clipboard.readText().then(function (t) { $('url-input').value = t; }, function () { toast('لم يُسمح بالوصول للحافظة'); });
    });
    on($('b-clear'), 'click', function () { $('url-input').value = ''; $('url-input').focus(); });

    // التبويبات
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      on(tab, 'click', function () {
        activeTab = tab.getAttribute('data-tab');
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.toggle('active', t === tab); });
        Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) { p.classList.toggle('active', p.id === 'tab-' + activeTab); });
        fpsRun(activeTab === 'diag');
        if (activeTab === 'diag') { renderDiagEnv(); renderDiagSession(); }
      });
    });

    // أدوات المشغل
    on($('b-play'), 'click', function () {
      if (!player || !playerReady) return;
      var s = player.getPlayerState();
      if (s === 1 || s === 3) player.pauseVideo(); else player.playVideo();
    });
    on($('b-back'), 'click', function () { if (playerReady) player.seekTo(Math.max(0, player.getCurrentTime() - 10), true); });
    on($('b-fwd'), 'click', function () { if (playerReady) player.seekTo(player.getCurrentTime() + 10, true); });
    on($('b-mute'), 'click', function () { muted = !muted; store.set('muted', muted); applyMute(); });
    on($('s-rate'), 'change', function () { if (playerReady) player.setPlaybackRate(parseFloat(this.value)); });
    on($('s-quality'), 'change', function () {
      dynamicQuality = this.value === 'default' ? null : this.value;
      suggestQuality(this.value === 'default' ? 'default' : this.value);
      log('user quality → ' + (QUALITY_LABEL[this.value] || this.value));
      // بعض إصدارات المشغل لا تطبّق الجودة إلا بعد طلب مقطع جديد: نعيد التحميل من الموضع الحالي
      if (playerReady && current && current.id && !current.list && this.value !== 'default') {
        var t = player.getCurrentTime();
        player.loadVideoById({ videoId: current.id, startSeconds: t, suggestedQuality: this.value });
      }
    });
    on($('b-recover'), 'click', function () { recover('manual', true); });
    on($('b-theater'), 'click', function () { setTheater(!theater); });
    on(document, 'fullscreenchange', function () { if (!document.fullscreenElement && theater) setTheater(false); });
    ['touchstart', 'mousemove', 'click'].forEach(function (ev) { on(document, ev, bumpIdle, { passive: true }); });

    var seek = $('seek');
    on(seek, 'input', function () {
      seeking = true;
      if (!playerReady) return;
      var d = player.getDuration() || 0;
      $('t-cur').textContent = fmtTime(d * seek.value / 1000);
    });
    on(seek, 'change', function () {
      seeking = false;
      if (!playerReady) return;
      var d = player.getDuration() || 0;
      if (d) player.seekTo(d * seek.value / 1000, true);
    });

    // لوحة المفاتيح (للاختبار من الحاسوب)
    on(document, 'keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (!playerReady) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); $('b-play').click(); }
      else if (e.key === 'ArrowLeft') $('b-back').click();   // شريط الوقت بالاتجاه LTR كما في YouTube
      else if (e.key === 'ArrowRight') $('b-fwd').click();
      else if (e.key === 'f') $('b-theater').click();
      else if (e.key === 'm') $('b-mute').click();
      else if (e.key === 'Escape' && theater) setTheater(false);
    });

    // الإعدادات
    on($('set-quality'), 'change', function () { settings.quality = this.value; dynamicQuality = null; saveSettings(); syncQualitySelect(); });
    on($('set-recover'), 'change', function () { settings.autoRecover = this.checked; saveSettings(); });
    on($('set-threshold'), 'input', function () { settings.threshold = parseInt(this.value, 10); $('set-threshold-v').textContent = this.value; saveSettings(); });
    on($('set-downgrade'), 'change', function () { settings.autoDowngrade = this.checked; saveSettings(); });
    on($('set-native'), 'change', function () { settings.nativeControls = this.checked; saveSettings(); });
    on($('set-nocookie'), 'change', function () { settings.nocookie = this.checked; saveSettings(); });
    on($('set-lite'), 'change', function () { settings.lite = this.checked; saveSettings(); document.body.classList.toggle('lite', settings.lite); });
    on($('set-motion'), 'change', function () { settings.motionGuard = this.checked; saveSettings(); setMotionGuard(this.checked); });
    on($('b-show-dz'), 'click', showDisclaimer);
    on($('b-reset'), 'click', function () {
      settings = Object.assign({}, DEFAULTS); saveSettings(); bindSettings(); setMotionGuard(false); toast('تمت استعادة الإعدادات الافتراضية');
    });
    on($('b-history-clear'), 'click', function () { history = []; store.set('history', history); renderHistory(); });

    // التشخيص
    on($('b-ping'), 'click', ping);
    on($('b-report'), 'click', function () { $('report-box').hidden = false; $('report').value = buildReport(); });
    on($('b-copy'), 'click', function () { copyText($('report').value, $('report')); });

    if (settings.motionGuard) setMotionGuard(true);

    // دعم الروابط المباشرة: ?v=ID أو ?url=...
    var qs = new URLSearchParams(location.search);
    var direct = qs.get('v') ? parseInput(qs.get('v')) : (qs.get('url') ? parseInput(qs.get('url')) : null);
    if (direct) $('url-input').value = qs.get('v') || qs.get('url');

    // Service Worker لتسريع فتح الواجهة في المرات التالية
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function (e) { log('SW: ' + e.message, 'w'); });
    }
    log('app ' + VERSION + ' ready · ' + (detectEnv().isTesla ? 'Tesla browser' : 'non-Tesla browser'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
