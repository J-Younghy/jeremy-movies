/* ==========================================================================
   Jeremy's Movies — 前端主脚本
   职责：数据驱动渲染 + 悬停剧照预览 + IMDB 式详情页 + 拟火展开动画
         + URL 同步 + 无障碍 + 筛选排序 + 三态主题
   技术：原生 ES，零依赖，零构建。数据源：movies.json（唯一数据源）
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     1. 常量与状态
     ====================================================================== */
  var THEME_KEY = 'theme';
  var SITE_NAME = "Jeremy's — 电影";
  var SITE_DESC = 'Jeremy 的个人电影收藏海报墙，收录经典与当代影片。';
  var BASE_URL = 'https://jeremy-movies.com/';

  var root = document.documentElement;
  var body = document.body;

  var movies = [];
  var currentFilter = 'all';
  var currentSort = 'default';

  // 设备能力 / 偏好探测
  var pointerFine = window.matchMedia('(pointer: fine)').matches;
  var hoverable = window.matchMedia('(hover: hover)').matches;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  var hoverEnabled = pointerFine && hoverable && !reduceMotion;
  var touchMode = coarsePointer && !hoverEnabled;  // 触屏两段式点按

  // 拟火 / 详情页时序（reduced-motion 退化为 200ms 淡入淡出）
  var OPEN_MS = reduceMotion ? 200 : 640;
  var CLOSE_MS = reduceMotion ? 200 : 460;

  // 详情页状态
  var detailOpen = false;
  var currentMovieId = null;
  var didPush = false;
  var lastTriggerCard = null;
  var lastFocused = null;
  var openTimer = null;
  var closeTimer = null;
  var hoverIntent = null;

  // 预览态状态（悬停 / 点按共用）
  var previewActive = false;
  var previewSourceCard = null;
  var previewMovie = null;

  // 悬停进出状态机：移开立即收起；落下是否延迟取决于"是否刚移开还停在海报区"
  var lastFocusCard = null;     // 当前聚焦的真实卡片（用于高亮）
  var cooldownActive = false;   // 冷却态：刚移开且鼠标仍停在海报区 → 新海报需停留确认
  var ENTER_DELAY = 260;        // 冷却态下，落在新海报上需停留 260ms 才展开（过滤快速扫过）

  /* ======================================================================
     2. DOM 引用
     ====================================================================== */
  var grid = document.querySelector('[data-grid]');
  var emptyState = document.querySelector('[data-empty]');
  var countEl = document.querySelector('[data-count]');
  var watchedEl = document.querySelector('[data-watched]');
  var towatchEl = document.querySelector('[data-towatch]');
  var filterButtons = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  var sortSelect = document.querySelector('[data-sort]');
  var nav = document.querySelector('[data-nav]');
  var burger = document.querySelector('[data-nav-burger]');
  var themeToggle = document.querySelector('[data-theme-toggle]');

  // 悬停 / 点按预览（单例）
  var previewBg = document.querySelector('[data-preview-bg]');
  var previewBgImg = previewBg ? previewBg.querySelector('.preview-bg__img') : null;
  var previewCard = document.querySelector('[data-preview-card]');
  var previewOverview = document.querySelector('[data-preview-overview]');
  var previewTitle = previewOverview ? previewOverview.querySelector('.preview-overview__title') : null;
  var previewYear = previewOverview ? previewOverview.querySelector('.preview-overview__year') : null;
  var previewMeta = previewOverview ? previewOverview.querySelector('.preview-overview__meta') : null;
  var previewText = previewOverview ? previewOverview.querySelector('.preview-overview__text') : null;
  var previewRatings = previewOverview ? previewOverview.querySelector('.preview-overview__ratings') : null;
  var previewCast = previewOverview ? previewOverview.querySelector('.preview-overview__cast') : null;

  // 详情页
  var detail = document.querySelector('[data-detail]');
  var backButton = document.querySelector('[data-detail-back]');
  var detailTitle = document.querySelector('#detail-title');
  var detailOrig = detail ? detail.querySelector('.detail__orig') : null;
  var detailStatus = detail ? detail.querySelector('.detail__status') : null;
  var detailMeta = detail ? detail.querySelector('.detail__meta') : null;
  var detailBackdrop = detail ? detail.querySelector('.detail__backdrop') : null;
  var overviewBlock = detail ? detail.querySelector('.detail__block--overview') : null;
  var detailOverview = detail ? detail.querySelector('.detail__overview') : null;
  var directorsBlock = detail ? detail.querySelector('.detail__block--directors') : null;
  var detailDirectors = detail ? detail.querySelector('.detail__directors') : null;
  var castBlock = detail ? detail.querySelector('.detail__block--cast') : null;
  var detailCast = detail ? detail.querySelector('.detail__cast') : null;
  var ratingsBlock = detail ? detail.querySelector('.detail__block--ratings') : null;
  var ratingList = detail ? detail.querySelector('.rating-list') : null;
  var personalBlock = detail ? detail.querySelector('.detail__personal') : null;
  var detailStars = detail ? detail.querySelector('.detail__stars') : null;
  var detailComment = detail ? detail.querySelector('.detail__comment') : null;
  // 预告片
  var trailerBlock = detail ? detail.querySelector('.detail__block--trailer') : null;
  var trailerBtn = detail ? detail.querySelector('[data-trailer-btn]') : null;
  var trailerPlaceholder = detail ? detail.querySelector('[data-trailer-placeholder]') : null;
  var trailerPlayer = detail ? detail.querySelector('[data-trailer-player]') : null;
  var currentTrailerId = null;

  var fireEl = document.querySelector('[data-fire]');
  var glow = document.querySelector('[data-detail-glow]');

  /* ======================================================================
     3. 工具函数
     ====================================================================== */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n.toFixed(1) : String(v);
  }

  // 取人物名：兼容「纯字符串」与「对象（含 name/photo/personId）」两种结构
  function nameOf(p) {
    if (p == null) return '';
    return (typeof p === 'string') ? p : (p.name || '');
  }
  function photoOf(p) {
    if (p == null || typeof p === 'string') return null;
    return p.photo || null;
  }

  // 取 rich 导演（对象数组，含头像）；无 rich 则把字符串数组转成 {name} 兜底
  function richDirectors(m) {
    if (m._richDirectors && m._richDirectors.length) return m._richDirectors;
    return (m.directors || []).map(function (d) {
      return (typeof d === 'string') ? { name: d, personId: null, photo: null } : d;
    });
  }
  function richCast(m) {
    if (m._richCast && m._richCast.length) return m._richCast;
    return (m.cast || []).map(function (c) {
      return (typeof c === 'string') ? { name: c, character: null, personId: null, photo: null } : c;
    });
  }

  // 生成人物 chip：带头像（有照片）或首字占位（无照片），返回 DOM 元素
  function personChip(p, role) {
    var wrap = document.createElement('span');
    wrap.className = 'person-chip';
    var name = nameOf(p);
    var photo = photoOf(p);

    if (photo) {
      var img = document.createElement('img');
      img.className = 'person-chip__avatar';
      img.src = photo;
      img.alt = name;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = function () { img.style.display = 'none'; };
      wrap.appendChild(img);
    } else {
      var fallback = document.createElement('span');
      fallback.className = 'person-chip__avatar person-chip__avatar--fallback';
      fallback.setAttribute('aria-hidden', 'true');
      fallback.textContent = name ? name.charAt(0) : '?';
      wrap.appendChild(fallback);
    }

    var nm = document.createElement('span');
    nm.className = 'person-chip__name';
    nm.textContent = name;
    wrap.appendChild(nm);

    // 若为演员且带角色名，附角色
    if (role === 'actor' && p && typeof p === 'object' && p.character) {
      var ch = document.createElement('span');
      ch.className = 'person-chip__character';
      ch.textContent = p.character;
      wrap.appendChild(ch);
    }
    return wrap;
  }

  function findMovie(id) {
    for (var i = 0; i < movies.length; i++) {
      if (String(movies[i].id) === String(id)) return movies[i];
    }
    return null;
  }

  function starsHTML(rating) {
    var n = Math.max(0, Math.min(5, Math.round(rating)));
    var out = '';
    for (var i = 0; i < 5; i++) {
      out += i < n ? '\u2605' : '<span class="star-empty">\u2606</span>';
    }
    return out;
  }

  function formatRuntime(min) {
    if (min == null || min === '') return null;
    var m = Number(min);
    if (!isFinite(m)) return null;
    var h = Math.floor(m / 60), mm = m % 60;
    if (h && mm) return h + ' 小时 ' + mm + ' 分钟';
    if (h) return h + ' 小时';
    return mm + ' 分钟';
  }

  function formatDate(s) {
    if (!s) return null;
    var parts = String(s).split('-');
    if (parts.length === 3) {
      return Number(parts[0]) + ' 年 ' + Number(parts[1]) + ' 月 ' + Number(parts[2]) + ' 日';
    }
    return String(s);
  }

  function parseHash() {
    var m = /#movie=(\d+)/.exec(location.hash);
    return m ? m[1] : null;
  }

  /* ======================================================================
     4. 主题切换（三态：浅 / 深 / 跟随系统）
     ====================================================================== */
  function getTheme() {
    try {
      var t = localStorage.getItem(THEME_KEY);
      if (t === 'light' || t === 'dark' || t === 'system') return t;
    } catch (e) { /* 隐私模式等场景忽略 */ }
    return 'system';
  }

  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    var labels = { light: '浅色', dark: '深色', system: '跟随系统' };
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', '切换主题（当前：' + labels[t] + '）');
      themeToggle.setAttribute('title', '切换主题（当前：' + labels[t] + '）');
    }
  }

  function cycleTheme() {
    var order = ['light', 'dark', 'system'];
    var cur = getTheme();
    var next = order[(order.indexOf(cur) + 1) % order.length];
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    applyTheme(next);
  }

  function initTheme() {
    applyTheme(getTheme());
    if (themeToggle) themeToggle.addEventListener('click', cycleTheme);
  }

  /* ======================================================================
     5. 卡片模板（纯正面）
     ====================================================================== */
  function cardHTML(m) {
    var title = m.title || '';
    var year = m.year != null ? m.year : '';
    var personal = m.personal || {};

    var badge = '';
    if (m.status === 'watched') {
      badge = '<span class="status-badge status--watched">\u5df2\u770b</span>';
    } else if (m.status === 'towatch') {
      badge = '<span class="status-badge status--towatch">\u5f85\u770b</span>';
    }

    var rating = personal.rating != null ? personal.rating : null;
    var infoRow = '';
    if (rating != null) {
      infoRow += '<span class="stars stars--sm" aria-label="\u4e2a\u4eba\u8bc4\u5206 ' + rating + '/5">' +
        starsHTML(rating) + '</span>';
    }
    if (year !== '') {
      infoRow += '<span class="poster-card__year">' + year + '</span>';
    }

    return (
      '<article class="poster-card" data-card data-id="' + esc(m.id) + '"' +
      ' role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false"' +
      ' aria-label="\u67e5\u770b\u300a' + esc(title) + '\u300b\u8be6\u60c5">' +
        '<div class="poster-card__media">' +
          '<img src="' + esc(m.poster) + '" alt="' + esc(title) + '" loading="lazy" decoding="async">' +
          badge +
        '</div>' +
        '<div class="poster-card__info">' +
          '<div class="poster-card__title">' + esc(title) + '</div>' +
          '<div class="poster-card__meta">' + infoRow + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  /* ======================================================================
     6. 筛选与排序
     ====================================================================== */
  function scoreOf(m) {
    var r = m.ratings || {};
    if (r.tmdb && r.tmdb.score != null) return Number(r.tmdb.score);
    return -1;
  }

  function sortList(list) {
    if (currentSort === 'rating') {
      list.sort(function (a, b) {
        return (scoreOf(b) - scoreOf(a)) || ((a.order || 0) - (b.order || 0));
      });
    } else if (currentSort === 'year') {
      list.sort(function (a, b) {
        return ((b.year || 0) - (a.year || 0)) || ((a.order || 0) - (b.order || 0));
      });
    } else {
      list.sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
    }
  }

  function showEmpty(title, hint) {
    if (!emptyState) return;
    emptyState.hidden = false;
    var t = emptyState.querySelector('[data-empty-title]');
    var h = emptyState.querySelector('[data-empty-hint]');
    if (t) t.textContent = title || '\u6682\u65e0\u5339\u914d\u7684\u7535\u5f71';
    if (h) h.textContent = hint || '\u6362\u4e2a\u7b5b\u9009\u6761\u4ef6\u8bd5\u8bd5';
  }

  function hideEmpty() {
    if (emptyState) emptyState.hidden = true;
  }

  function render() {
    if (!grid) return;

    hidePreview();

    // 统计
    var watched = 0, towatch = 0;
    movies.forEach(function (m) {
      if (m.status === 'watched') watched++;
      else if (m.status === 'towatch') towatch++;
    });
    if (countEl) countEl.textContent = movies.length;
    if (watchedEl) watchedEl.textContent = watched;
    if (towatchEl) towatchEl.textContent = towatch;

    // 筛选 + 排序
    var list = movies.slice();
    if (currentFilter !== 'all') {
      list = list.filter(function (m) { return m.status === currentFilter; });
    }
    sortList(list);

    if (list.length === 0) {
      grid.innerHTML = '';
      showEmpty();
      return;
    }
    hideEmpty();
    grid.innerHTML = list.map(cardHTML).join('');
    bindCards();
  }

  /* ======================================================================
     7. 卡片交互：点击进详情 + 键盘触发 + 悬停预览 + 触屏两段式点按
     ====================================================================== */
  function onCardClick(e) {
    var card = e.currentTarget;
    var movie = findMovie(card.getAttribute('data-id'));
    if (!movie) return;

    // 触屏：第一次点按 → 进入预览态；第二次点按（由海报克隆承接）→ 详情
    if (touchMode && !previewActive) {
      showPreview(card, movie);
      return;
    }
    openDetail(card, movie, {});
  }

  function onCardKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      var card = e.currentTarget;
      var movie = findMovie(card.getAttribute('data-id'));
      if (movie) openDetail(card, movie, {});
    }
  }

  function onCardEnter(e) {
    if (!hoverEnabled) return;
    var card = e.currentTarget;
    var movie = findMovie(card.getAttribute('data-id'));
    if (!movie) return;

    // 预览已展开且停在同一张卡上：无需重复触发
    if (previewActive && previewSourceCard === card) return;

    clearTimeout(hoverIntent);

    if (cooldownActive) {
      // 冷却态（刚移开、鼠标还停在海报区）：需停留 ENTER_DELAY 才展开，过滤快速扫过
      hoverIntent = setTimeout(function () { showPreview(card, movie); }, ENTER_DELAY);
    } else {
      // 非冷却态（鼠标刚从空白处进入海报区）：立即显示
      showPreview(card, movie);
    }
  }

  function onCardLeave(e) {
    // 移开海报 → 立即收起预览，回到海报墙
    clearTimeout(hoverIntent);
    hidePreview();

    // 判断鼠标落点，决定是否进入冷却态
    var to = e.relatedTarget;
    if (to && grid && grid.contains(to)) {
      // 仍停在海报区（滑到相邻海报）：进入冷却态
      cooldownActive = true;
    } else {
      // 移出海报区（落在空白/导航/页脚）：解除冷却，下次进入立即显示
      cooldownActive = false;
    }
  }

  function bindCards() {
    Array.prototype.forEach.call(grid.querySelectorAll('[data-card]'), function (card) {
      card.addEventListener('click', onCardClick);
      card.addEventListener('keydown', onCardKeydown);
      if (hoverEnabled) {
        card.addEventListener('mouseenter', onCardEnter);
        card.addEventListener('mouseleave', onCardLeave);
      }
    });
  }

  /* ======================================================================
     8. 预览态：虚化剧照背景 + 聚焦卡片（海报平移放大）+ 固定信息面板
     ====================================================================== */
  // 聚焦布局：海报向空白多的一侧平移+放大，信息面板固定在相反侧，垂直居中
  function layoutFocus(card) {
    var r = card.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var PAD = 20;          // 视口安全边距
    var GAP = 36;          // 海报与面板间距
    var PANEL_W = 420;     // 信息面板固定宽度
    var SCALE = 1.14;      // 聚焦放大倍数

    var leftSpace = r.left;
    var rightSpace = vw - r.right;
    var placeRight = rightSpace >= leftSpace;  // 空白多的一侧放面板

    // 窄屏退化为上下堆叠：视口太窄装不下「海报+面板」并排
    var stacked = (vw < 760);   // 阈值：并排需海报宽+面板宽+间距
    // 手机端海报小，放大更明显才有「聚焦」感；桌面维持 1.14
    var scale = stacked ? 1.3 : SCALE;

    var cardW = r.width, cardH = r.height;
    var visualW = cardW * scale;
    var visualH = cardH * scale;

    // —— 海报克隆：始终以原海报左上角为锚点，用 translate 位移 + scale 放大 ——
    var targetLeft, targetTop;   // 目标视觉左上角
    if (stacked) {
      targetLeft = Math.max(PAD, Math.min((vw - visualW) / 2, vw - PAD - visualW));
      targetTop = PAD + 8;
    } else if (placeRight) {
      targetLeft = PAD;
      var cy = r.top + cardH / 2;
      targetTop = cy - visualH / 2;
    } else {
      targetLeft = vw - PAD - visualW;
      cy = r.top + cardH / 2;
      targetTop = cy - visualH / 2;
    }
    // 钳制垂直
    if (targetTop < PAD) targetTop = PAD;
    if (targetTop + visualH > vh - PAD) targetTop = vh - PAD - visualH;

    // translate 位移量：从原海报左上角到目标视觉左上角的偏移
    var dx = targetLeft - r.left;
    var dy = targetTop - r.top;

    if (previewCard) {
      previewCard.style.setProperty('--focus-dx', dx + 'px');
      previewCard.style.setProperty('--focus-dy', dy + 'px');
      previewCard.style.setProperty('--focus-scale', scale);
    }

    // —— 信息面板：并排时固定在面板侧，堆叠时放海报下方 ——
    if (previewOverview) {
      ['left', 'right', 'top', 'bottom', 'maxWidth', 'maxHeight'].forEach(function (p) {
        previewOverview.style[p] = '';
      });
      previewOverview.style.maxWidth = PANEL_W + 'px';

      if (stacked) {
        // 手机端：面板宽度钳制在视口内（375px 手机上 420px 会溢出）
        previewOverview.style.maxWidth = Math.min(PANEL_W, vw - PAD * 2) + 'px';
        previewOverview.style.left = '50%';
        previewOverview.style.transform = 'translateX(-50%)';
        previewOverview.style.top = (targetTop + visualH + GAP) + 'px';
        // maxHeight 兜底：剩余空间过小（横屏/超矮视口）至少给 72px
        var mh = vh - targetTop - visualH - GAP - PAD;
        previewOverview.style.maxHeight = Math.max(72, mh) + 'px';
      } else {
        previewOverview.style.transform = '';
        if (placeRight) {
          previewOverview.style.left = (targetLeft + visualW + GAP) + 'px';
        } else {
          previewOverview.style.right = (vw - targetLeft + GAP) + 'px';
        }
        // 垂直居中于海报中心
        var panelTop = targetTop + visualH / 2 - previewOverview.offsetHeight / 2;
        if (panelTop < PAD) panelTop = PAD;
        if (panelTop + previewOverview.offsetHeight > vh - PAD) {
          panelTop = Math.max(PAD, vh - PAD - previewOverview.offsetHeight);
        }
        previewOverview.style.top = panelTop + 'px';
      }
    }

    // 记录布局方向，供面板过渡用
    if (previewCard) previewCard.setAttribute('data-side', placeRight ? 'right' : 'left');
  }

  function positionPreviewCard(card) {
    if (!previewCard) return;
    var r = card.getBoundingClientRect();
    previewCard.style.left = r.left + 'px';
    previewCard.style.top = r.top + 'px';
    previewCard.style.width = r.width + 'px';
    previewCard.style.height = r.height + 'px';
    previewCard.style.right = 'auto';
    previewCard.style.bottom = 'auto';
    // 复位聚焦位移/缩放（过渡起点 = 原海报位置）
    previewCard.style.setProperty('--focus-dx', '0px');
    previewCard.style.setProperty('--focus-dy', '0px');
    previewCard.style.setProperty('--focus-scale', '1');
  }

  function positionPreviewOverview(card) {
    // 聚焦卡片方案下，面板位置由 layoutFocus 统一计算
    layoutFocus(card);
  }

  // 剧照预加载：避免切换影片时旧图消失→新图才渲染的错位闪烁
  var backdropCache = {};
  function loadBackdrop(src, done) {
    if (!src) { done(false); return; }
    if (backdropCache[src]) { done(true); return; }
    var img = new Image();
    img.onload = function () { backdropCache[src] = true; done(true); };
    img.onerror = function () { done(false); };
    img.src = src;
  }

  function populatePreview(movie) {
    var r = movie.ratings || {};
    var personal = movie.personal || {};

    // 标题 + 年份
    if (previewTitle) previewTitle.textContent = movie.title || '';
    if (previewYear) {
      previewYear.textContent = movie.year != null ? String(movie.year) : '';
      previewYear.style.display = movie.year != null ? '' : 'none';
    }

    // meta chips：导演 / 类型 / 时长 / 状态
    if (previewMeta) {
      previewMeta.innerHTML = '';
      var chips = [];
      // 导演（可能有多个，取前 2 个，避免过长）
      (movie.directors || []).slice(0, 2).forEach(function (d) {
        var dn = nameOf(d);
        if (dn) chips.push('\u5bfc ' + dn);
      });
      (movie.genres || []).forEach(function (g) { chips.push(esc(g)); });
      var rt = formatRuntime(movie.runtime);
      if (rt) chips.push(esc(rt));
      if (movie.status === 'watched') chips.push('\u5df2\u770b');
      else if (movie.status === 'towatch') chips.push('\u5f85\u770b');
      if (chips.length) {
        chips.forEach(function (c) {
          var li = document.createElement('li');
          li.textContent = c;
          previewMeta.appendChild(li);
        });
        previewMeta.style.display = '';
      } else {
        previewMeta.style.display = 'none';
      }
    }

    // 剧情梗概
    if (previewText) {
      previewText.textContent = movie.overview || '';
      previewText.style.display = movie.overview ? '' : 'none';
    }

    // 评分行：IMDB / 豆瓣 / TMDB（有则显示）+ 个人星级
    if (previewRatings) {
      previewRatings.innerHTML = '';
      var items = [];
      if (r.imdb && r.imdb.score != null) items.push(['imdb', 'IMDb', num(r.imdb.score)]);
      if (r.douban && r.douban.score != null) items.push(['douban', '\u8c46\u74e3', num(r.douban.score)]);
      if (r.tmdb && r.tmdb.score != null) items.push(['tmdb', 'TMDB', num(r.tmdb.score)]);
      if (personal.rating != null) {
        items.push(['star', '\u2605 ' + personal.rating, null]);
      }
      if (items.length) {
        items.forEach(function (it) {
          var s = document.createElement('span');
          s.className = 'preview-rating preview-rating--' + it[0];
          if (it[2] != null) {
            s.innerHTML = '<span class="preview-rating__label">' + esc(it[1]) + '</span>' +
                          '<span class="preview-rating__value">' + esc(it[2]) + '</span>';
          } else {
            s.innerHTML = '<span class="preview-rating__star">' + it[1] + '</span>';
          }
          previewRatings.appendChild(s);
        });
        previewRatings.style.display = '';
      } else {
        previewRatings.style.display = 'none';
      }
    }

    // 卡司（最多 4 人，避免画幅过满）
    if (previewCast) {
      previewCast.innerHTML = '';
      var cast = movie.cast || [];
      if (cast.length) {
        cast.slice(0, 4).forEach(function (p) {
          var c = document.createElement('span');
          c.className = 'preview-cast';
          c.textContent = nameOf(p);
          previewCast.appendChild(c);
        });
        previewCast.style.display = '';
      } else {
        previewCast.style.display = 'none';
      }
    }
  }

  function showPreview(card, movie) {
    previewActive = true;
    previewSourceCard = card;
    previewMovie = movie;
    body.classList.add('is-preview');

    // 高亮当前聚焦的真实卡片（让用户清楚"聚焦的是哪张"）
    if (lastFocusCard && lastFocusCard !== card) lastFocusCard.classList.remove('is-hovering');
    card.classList.add('is-hovering');
    lastFocusCard = card;

    // 触屏预览态锁滚动，避免海报与背景错位
    if (touchMode) document.documentElement.style.overflow = 'hidden';

    var bgSrc = movie.backdrop || movie.poster || '';

    if (previewCard) {
      previewCard.innerHTML = card.innerHTML;   // 复制真实海报内容
      positionPreviewCard(card);                // 先落位到原海报位置（过渡起点）
      previewCard.classList.add('is-on');
      void previewCard.offsetWidth;             // 强制 reflow，提交过渡起点
    }

    populatePreview(movie);
    if (previewOverview) previewOverview.classList.add('is-on');

    // 双 rAF：第一帧让浏览器提交过渡起点（样式计算），第二帧改终点才会产生 transition
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!previewActive || previewSourceCard !== card) return;
        layoutFocus(card);
      });
    });

    // 剧照背景：先预加载，就绪后再挂载，杜绝错位闪烁
    loadBackdrop(bgSrc, function (ok) {
      // 若用户已移开（预览已关闭）或已切到另一部，放弃本次挂载
      if (!previewActive || previewMovie !== movie) return;
      if (previewBgImg && ok) {
        previewBgImg.src = bgSrc;
        if (previewBg) previewBg.classList.add('is-on');
      } else if (previewBg) {
        // 剧照加载失败：仍开启背景层（显示占位底色），避免梗概无背景
        previewBg.classList.add('is-on');
      }
    });
  }

  function hidePreview() {
    clearTimeout(hoverIntent);
    if (!previewActive) return;
    previewActive = false;
    previewSourceCard = null;
    previewMovie = null;
    body.classList.remove('is-preview');
    if (lastFocusCard) {
      lastFocusCard.classList.remove('is-hovering');
      lastFocusCard = null;
    }
    if (touchMode) document.documentElement.style.overflow = '';
    if (previewBg) previewBg.classList.remove('is-on');
    if (previewCard) {
      previewCard.classList.remove('is-on');
    }
    if (previewOverview) previewOverview.classList.remove('is-on');
  }

  /* ======================================================================
     9. IMDB 式详情页：数据填充
     ====================================================================== */
  function populateDetail(movie) {
    var r = movie.ratings || {};
    var personal = movie.personal || {};

    if (detailTitle) detailTitle.textContent = movie.title || '';

    var origBits = [];
    if (movie.originalTitle && movie.originalTitle !== movie.title) origBits.push(movie.originalTitle);
    if (movie.year != null) origBits.push(String(movie.year));
    if (detailOrig) {
      detailOrig.textContent = origBits.join(' \u00b7 ');
      detailOrig.hidden = origBits.length === 0;
    }

    if (detailStatus) {
      if (movie.status === 'watched' || movie.status === 'towatch') {
        detailStatus.className = 'detail__status status--' + movie.status;
        detailStatus.textContent = movie.status === 'watched' ? '\u5df2\u770b' : '\u5f85\u770b';
        detailStatus.hidden = false;
      } else {
        detailStatus.hidden = true;
      }
    }

    // meta chips：类型 / 时长 / 上映日期
    if (detailMeta) {
      detailMeta.innerHTML = '';
      var chips = [];
      (movie.genres || []).forEach(function (g) { chips.push(esc(g)); });
      var rt = formatRuntime(movie.runtime);
      if (rt) chips.push(esc(rt));
      var rd = formatDate(movie.releaseDate);
      if (rd) chips.push(esc(rd));
      chips.forEach(function (c) {
        var li = document.createElement('li');
        li.textContent = c;
        detailMeta.appendChild(li);
      });
    }

    if (detailBackdrop) {
      detailBackdrop.src = movie.backdrop || movie.poster || '';
      detailBackdrop.alt = movie.title || '';
    }

    // 剧情简介
    if (overviewBlock) {
      overviewBlock.hidden = !movie.overview;
      if (movie.overview && detailOverview) detailOverview.textContent = movie.overview;
    }

    // 预告片（懒加载：先显示占位按钮，点击才挂载 iframe）
    if (trailerBlock) {
      var hasTrailer = !!(movie.trailer && movie.trailer.youtubeId);
      trailerBlock.hidden = !hasTrailer;
      if (hasTrailer) {
        currentTrailerId = movie.trailer.youtubeId;
        // 复位占位/播放器状态
        if (trailerPlaceholder) trailerPlaceholder.hidden = false;
        if (trailerPlayer) {
          trailerPlayer.hidden = true;
          trailerPlayer.innerHTML = '';
        }
      } else {
        currentTrailerId = null;
      }
    }

    // 导演（带头像）
    var dirs = richDirectors(movie);
    if (directorsBlock) {
      directorsBlock.hidden = !dirs.length;
      if (detailDirectors) {
        detailDirectors.innerHTML = '';
        dirs.forEach(function (d) {
          detailDirectors.appendChild(personChip(d, 'director'));
        });
      }
    }

    // 卡司 chips（带头像）
    var castList = richCast(movie);
    if (castBlock) {
      castBlock.hidden = !castList.length;
      if (detailCast) {
        detailCast.innerHTML = '';
        castList.forEach(function (c) {
          var li = document.createElement('li');
          li.className = 'detail__cast-item';
          li.appendChild(personChip(c, 'actor'));
          detailCast.appendChild(li);
        });
      }
    }

    // 评分列表（IMDB 黄 / 豆瓣 绿 / TMDB 蓝）
    var ratingItems = [];
    if (r.imdb && r.imdb.score != null) ratingItems.push(['imdb', 'IMDb', num(r.imdb.score)]);
    if (r.douban && r.douban.score != null) ratingItems.push(['douban', '\u8c46\u74e3', num(r.douban.score)]);
    if (r.tmdb && r.tmdb.score != null) ratingItems.push(['tmdb', 'TMDB', num(r.tmdb.score)]);
    if (ratingsBlock) ratingsBlock.hidden = ratingItems.length === 0;
    if (ratingList) {
      ratingList.innerHTML = '';
      ratingItems.forEach(function (it) {
        var li = document.createElement('li');
        li.className = 'rating-item rating-item--' + it[0];
        li.innerHTML =
          '<span class="rating-item__label">' + esc(it[1]) + '</span>' +
          '<span class="rating-item__value">' + esc(it[2]) + '</span>';
        ratingList.appendChild(li);
      });
    }

    // Jeremy 说：星级 + 一句话评价（任一缺失则隐藏对应部分）
    var hasRating = personal.rating != null;
    var hasComment = !!(personal.comment);
    if (personalBlock) personalBlock.hidden = !(hasRating || hasComment);
    if (detailStars) detailStars.innerHTML = hasRating ? starsHTML(personal.rating) : '';
    if (detailComment) {
      detailComment.textContent = hasComment ? personal.comment : '';
      detailComment.hidden = !hasComment;
    }
  }

  /* ======================================================================
     10. 拟火展开动画：原点 / 覆盖半径计算
     ====================================================================== */
  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function coverFrom(fx, fy) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var R = Math.max(
      dist(fx, fy, 0, 0),
      dist(fx, fy, vw, 0),
      dist(fx, fy, 0, vh),
      dist(fx, fy, vw, vh)
    );
    return Math.ceil(R * 1.35); // 保证火带完全移出视口
  }

  function fireMetrics(card) {
    var media = card.querySelector('.poster-card__media');
    var fx, fy;
    if (media) {
      var r = media.getBoundingClientRect();
      fx = r.left + r.width / 2;
      fy = r.top + r.height / 2;
    } else {
      fx = window.innerWidth / 2;
      fy = window.innerHeight / 2;
    }
    return { fx: fx, fy: fy, cover: coverFrom(fx, fy) };
  }

  function centerMetrics() {
    var fx = window.innerWidth / 2, fy = window.innerHeight / 2;
    return { fx: fx, fy: fy, cover: coverFrom(fx, fy) };
  }

  // 共享元素飞入：计算触发海报中心相对详情页 hero 的 transform-origin 与初始 scale
  function setFlyMetrics(card) {
    var hero = detail ? detail.querySelector('.detail__hero') : null;
    if (!hero || !detailBackdrop) return;
    var media = card ? card.querySelector('.poster-card__media') : null;
    var srcRect = media ? media.getBoundingClientRect() : null;
    var heroRect = hero.getBoundingClientRect();

    if (!srcRect || srcRect.width === 0 || heroRect.width === 0) {
      // 无海报源（如直达加载）：禁用飞入，回退默认
      detailBackdrop.style.setProperty('--fly-x', '50%');
      detailBackdrop.style.setProperty('--fly-y', '50%');
      detailBackdrop.style.setProperty('--fly-scale', '1');
      return;
    }

    // 海报中心 → 相对 hero 左上角的坐标（百分比）
    var sx = (srcRect.left + srcRect.width / 2) - heroRect.left;
    var sy = (srcRect.top + srcRect.height / 2) - heroRect.top;
    var ox = (sx / heroRect.width) * 100;
    var oy = (sy / heroRect.height) * 100;

    // 初始 scale = 海报宽度 / hero 宽度（让剧照从海报尺寸放大铺满）
    var scale = srcRect.width / heroRect.width;

    detailBackdrop.style.setProperty('--fly-x', ox + '%');
    detailBackdrop.style.setProperty('--fly-y', oy + '%');
    detailBackdrop.style.setProperty('--fly-scale', scale);
  }

  function setFireOrigin(m) {
    [fireEl, detail, glow].forEach(function (el) {
      if (!el) return;
      el.style.setProperty('--fx', m.fx + 'px');
      el.style.setProperty('--fy', m.fy + 'px');
      el.style.setProperty('--cover', m.cover + 'px');
    });
  }

  /* ======================================================================
     11. 详情页打开 / 关闭 + URL 同步 + 无障碍
     ====================================================================== */
  function openDetail(card, movie, opts) {
    opts = opts || {};
    if (detailOpen) return;
    detailOpen = true;
    currentMovieId = String(movie.id);

    hidePreview();

    var m = (opts.fromCenter || !card) ? centerMetrics() : fireMetrics(card);
    setFireOrigin(m);

    populateDetail(movie);
    if (detail) detail.scrollTop = 0;

    // 共享元素飞入：从触发海报位置放大铺满
    setFlyMetrics(opts.fromCenter ? null : card);

    body.classList.remove('is-detail-closing');
    if (detail) detail.hidden = false;
    if (fireEl) fireEl.style.display = '';
    void (detail ? detail.offsetWidth : 0); // 强制 reflow，提交展开起点
    body.classList.add('is-detail-open');

    if (card) {
      lastTriggerCard = card;
      card.setAttribute('aria-expanded', 'true');
    } else {
      lastTriggerCard = null;
    }

    lastFocused = document.activeElement;
    document.documentElement.style.overflow = 'hidden'; // 滚动锁
    if (backButton) backButton.focus();

    // URL 同步：点击打开 push，直达加载不 push
    if (!opts.noPush) {
      didPush = true;
      history.pushState({ movie: currentMovieId }, '', '#movie=' + currentMovieId);
    } else {
      didPush = false;
    }

    // 展开结束：隐藏 .fire，释放滤镜渲染
    clearTimeout(openTimer);
    openTimer = setTimeout(function () {
      if (fireEl) fireEl.style.display = 'none';
    }, OPEN_MS);
  }

  function runClose() {
    if (!detailOpen) return;
    detailOpen = false;
    currentMovieId = null;
    didPush = false;

    clearTimeout(openTimer);

    // 关闭时重新计算飞入终点（海报当前位置），让剧照缩回海报
    if (lastTriggerCard) setFlyMetrics(lastTriggerCard);

    if (fireEl) fireEl.style.display = '';
    void (fireEl ? fireEl.offsetWidth : 0); // 提交火收缩起点（当前展开态）
    body.classList.remove('is-detail-open');
    body.classList.add('is-detail-closing');

    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      body.classList.remove('is-detail-closing');
      if (detail) detail.hidden = true;
      if (fireEl) fireEl.style.display = 'none';
      document.documentElement.style.overflow = ''; // 恢复滚动
      if (lastTriggerCard) lastTriggerCard.setAttribute('aria-expanded', 'false');
      if (lastFocused && lastFocused.focus) {
        try { lastFocused.focus(); } catch (e) { /* ignore */ }
      }
      lastTriggerCard = null;
    }, CLOSE_MS);
  }

  function requestClose() {
    if (!detailOpen) return;
    if (didPush) {
      // 回到 push 前的 URL，触发 popstate/hashchange 走统一关闭
      history.back();
      // 兜底：极端情况下 popstate 未触发时强制关闭
      setTimeout(function () { if (detailOpen) runClose(); }, 100);
    } else {
      // 直达加载：无历史记录可退，直接清理 URL 并关闭
      history.replaceState(null, '', location.pathname + location.search);
      runClose();
    }
  }

  function onHashStateChange() {
    var id = parseHash();
    if (detailOpen && String(id) !== String(currentMovieId)) {
      runClose();
    }
  }

  function trapFocus(e) {
    if (!detail) return;
    var focusables = detail.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function initDetail() {
    if (backButton) backButton.addEventListener('click', requestClose);

    // 预告片：点击占位按钮 → 懒加载 YouTube iframe（隐私/性能友好）
    if (trailerBtn) {
      trailerBtn.addEventListener('click', function () {
        if (!currentTrailerId) return;
        if (trailerPlaceholder) trailerPlaceholder.hidden = true;
        if (trailerPlayer) {
          trailerPlayer.hidden = false;
          var iframe = document.createElement('iframe');
          iframe.className = 'detail__trailer-iframe';
          iframe.src = 'https://www.youtube-nocookie.com/embed/' + currentTrailerId + '?rel=0&modestbranding=1';
          iframe.title = '预告片';
          iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
          iframe.allowFullscreen = true;
          iframe.referrerPolicy = 'strict-origin-when-cross-origin';
          iframe.loading = 'lazy';
          trailerPlayer.appendChild(iframe);
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (!detailOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      } else if (e.key === 'Tab') {
        trapFocus(e);
      }
    });

    window.addEventListener('popstate', onHashStateChange);
    window.addEventListener('hashchange', onHashStateChange);
  }

  function maybeOpenFromHash() {
    var id = parseHash();
    if (!id) return;
    var movie = findMovie(id);
    if (movie) openDetail(null, movie, { fromCenter: true, noPush: true });
  }

  /* ======================================================================
     11.5 预览态事件：触屏两段式点按 + 桌面滚动/缩放时收起
     ====================================================================== */
  function initPreview() {
    // 触屏：预览态下点海报克隆 → 进详情；点背景空白 → 退回海报墙
    if (previewCard) {
      previewCard.addEventListener('click', function () {
        if (!touchMode || !previewActive) return;
        var card = previewSourceCard;
        var movie = previewMovie;
        if (card && movie) openDetail(card, movie, {});
      });
    }
    if (previewBg) {
      previewBg.addEventListener('click', function () {
        if (!touchMode || !previewActive) return;
        hidePreview();
      });
    }

    // 桌面悬停是瞬态：滚动/缩放会使海报移位，直接收起预览
    window.addEventListener('scroll', function () {
      if (previewActive && !touchMode) hidePreview();
    });
    window.addEventListener('resize', function () {
      hidePreview();
    });
  }

  /* ======================================================================
     12. 工具栏事件
     ====================================================================== */
  function initToolbar() {
    filterButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        filterButtons.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        currentFilter = btn.getAttribute('data-filter');
        render();
      });
    });

    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        currentSort = sortSelect.value;
        render();
      });
    }
  }

  /* ======================================================================
     13. 移动端汉堡菜单
     ====================================================================== */
  function initNav() {
    if (!nav || !burger) return;
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    Array.prototype.forEach.call(nav.querySelectorAll('.nav-link'), function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });

    var mq = window.matchMedia('(max-width: 640px)');
    var onMqChange = function (e) {
      if (!e.matches) {
        nav.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onMqChange);
    else if (mq.addListener) mq.addListener(onMqChange);
  }

  /* ======================================================================
     14. JSON-LD 动态生成（与 movies.json 同源，避免双份维护）
     ====================================================================== */
  function buildJsonLd() {
    var itemListElement = movies.map(function (m, i) {
      var item = {
        '@type': 'Movie',
        name: m.title,
        datePublished: String(m.year),
        image: BASE_URL + String(m.poster).replace(/^\//, '')
      };
      if (m.originalTitle && m.originalTitle !== m.title) {
        item.alternateName = m.originalTitle;
      }
      if (m.directors && m.directors.length) {
        item.director = { '@type': 'Person', name: nameOf(m.directors[0]) };
      }
      if (m.genres && m.genres.length) {
        item.genre = m.genres;
      }
      var r = m.ratings || {};
      if (r.tmdb && r.tmdb.score != null) {
        item.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: String(r.tmdb.score),
          ratingCount: r.tmdb.votes || 0,
          bestRating: 10,
          worstRating: 0
        };
      }
      return { '@type': 'ListItem', position: i + 1, item: item };
    });

    var ld = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: SITE_NAME,
      description: SITE_DESC,
      numberOfItems: movies.length,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      itemListElement: itemListElement
    };

    var script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'jsonld-movies';
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);
  }

  /* ======================================================================
     15. 数据加载与启动
     ====================================================================== */
  function loadData() {
    // 并行加载：movies.json（基础） + people.json（头像/预告片增强层，可选）
    var p1 = fetch('movies.json', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
    var p2 = fetch('people.json', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) return null;   // people.json 缺失不阻塞（优雅降级）
      return res.json();
    }).catch(function () { return null; });

    Promise.all([p1, p2])
      .then(function (results) {
        var data = results[0];
        var people = results[1] || {};
        movies = Array.isArray(data) ? data : (data && data.movies) || [];

        // 合并增强层：按 movie.id 挂载 directors(对象数组)/cast(对象数组)/trailer
        if (people) {
          movies.forEach(function (m) {
            var rich = people[String(m.id)];
            if (!rich) return;
            // 头像数据：people 里 directors/cast 是对象数组，含 name/photo/personId/character
            if (Array.isArray(rich.directors) && rich.directors.length) {
              m._richDirectors = rich.directors;
            }
            if (Array.isArray(rich.cast) && rich.cast.length) {
              m._richCast = rich.cast;
            }
            if (rich.trailer && rich.trailer.youtubeId) {
              m.trailer = rich.trailer;
            }
          });
        }

        render();
        buildJsonLd();
        maybeOpenFromHash();
      })
      .catch(function () {
        if (grid) grid.innerHTML = '';
        showEmpty('\u6570\u636e\u52a0\u8f7d\u5931\u8d25', '\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u65b0\u52a0\u8f7d');
      });
  }

  initTheme();
  initNav();
  initToolbar();
  initDetail();
  initPreview();
  loadData();
})();
