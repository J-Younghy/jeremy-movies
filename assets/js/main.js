/* ==========================================================================
   Jeremy's Movies — 前端主脚本
   职责：数据驱动渲染 + 翻转卡 + 悬停换背景 + 筛选排序 + 三态主题 + 无障碍
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

  // 主色兜底调色板（数据无 accentColor 字段时，按 id 稳定映射出占位主色）
  var ACCENTS = [
    '#31435c', '#4c2f3a', '#2f4a42', '#3f3550',
    '#4a3b2a', '#24324a', '#52333f', '#2c4a3a'
  ];

  var movies = [];
  var currentFilter = 'all';
  var currentSort = 'default';

  // 设备能力探测
  var pointerFine = window.matchMedia('(pointer: fine)').matches;

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
  var bgLayer = document.querySelector('.bg-layer');
  var bgImages = bgLayer
    ? Array.prototype.slice.call(bgLayer.querySelectorAll('.bg-image'))
    : [];
  var bgActive = -1;

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

  function accentFor(id) {
    var s = String(id);
    var h = 7;
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return ACCENTS[h % ACCENTS.length];
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
     5. 卡片模板
     ====================================================================== */
  function starsHTML(rating) {
    var n = Math.max(0, Math.min(5, Math.round(rating)));
    var out = '';
    for (var i = 0; i < 5; i++) {
      out += i < n ? '\u2605' : '<span class="star-empty">\u2606</span>';
    }
    return out;
  }

  function statHTML(key, label, value) {
    return '<div class="stat stat--' + key + '">' +
      '<div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value">' + value + '</div>' +
      '</div>';
  }

  function cardHTML(m) {
    var title = m.title || '';
    var year = m.year != null ? m.year : '';
    var r = m.ratings || {};
    var personal = m.personal || {};

    var badge = '';
    if (m.status === 'watched') {
      badge = '<span class="status-badge status--watched">\u5df2\u770b</span>';
    } else if (m.status === 'towatch') {
      badge = '<span class="status-badge status--towatch">\u5f85\u770b</span>';
    }

    var rating = personal.rating != null ? personal.rating : null;
    var comment = personal.comment || null;

    // 正面信息条：星级小字 + 年份
    var infoRow = '';
    if (rating != null) {
      infoRow += '<span class="stars stars--sm" aria-label="\u4e2a\u4eba\u8bc4\u5206 ' + rating + '/5">' +
        starsHTML(rating) + '</span>';
    }
    if (year) infoRow += '<span class="year">' + year + '</span>';

    // 背面数据区：IMDB / 豆瓣 / 票房（缺数据整项隐藏）
    var stats = [];
    if (r.imdb && r.imdb.score != null) stats.push(statHTML('imdb', 'IMDB', num(r.imdb.score)));
    if (r.douban && r.douban.score != null) stats.push(statHTML('douban', '\u8c46\u74e3', num(r.douban.score)));
    if (m.boxOffice && m.boxOffice.amount) {
      var boLabel = m.boxOffice.note ? '\u7968\u623f\u00b7' + m.boxOffice.note : '\u7968\u623f';
      stats.push(statHTML('boxoffice', boLabel, esc(m.boxOffice.amount)));
    }

    // 背面元信息：导演 · 年份
    var metaBits = [];
    if (m.directors && m.directors.length) metaBits.push(esc(m.directors[0]));
    if (year) metaBits.push(year);
    var metaLine = metaBits.length
      ? '<div class="meta-line">' + metaBits.join(' \u00b7 ') + '</div>'
      : '';

    var dataZone = (stats.length || metaLine)
      ? '<div class="data-zone">' +
          (stats.length ? '<div class="stats">' + stats.join('') + '</div>' : '') +
          metaLine +
        '</div>'
      : '';

    // Jeremy 说：星级 + 一句话评价（rating 或 comment 任一存在才渲染）
    var reviewZone = '';
    if (rating != null || comment) {
      reviewZone = '<div class="review-zone">' +
        '<div class="review-label">Jeremy \u8bf4</div>' +
        (rating != null
          ? '<div class="stars" aria-label="\u4e2a\u4eba\u8bc4\u5206 ' + rating + '/5">' + starsHTML(rating) + '</div>'
          : '') +
        (comment ? '<p class="comment">' + esc(comment) + '</p>' : '') +
        '</div>';
    }

    return (
      '<article class="poster-card" role="button" tabindex="0" aria-expanded="false"' +
      ' aria-label="\u67e5\u770b\u300a' + esc(title) + '\u300b\u8be6\u60c5"' +
      ' data-card data-id="' + esc(m.id) + '">' +
        '<div class="card-inner">' +
          '<div class="card-face card-front">' +
            '<img src="' + esc(m.poster) + '" alt="' + esc(title) + '" loading="lazy" decoding="async">' +
            badge +
            '<div class="info">' +
              '<div class="title">' + esc(title) + '</div>' +
              '<div class="info-row">' + infoRow + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="card-face card-back">' +
            '<div class="back-title">' + esc(title) + '</div>' +
            dataZone +
            reviewZone +
          '</div>' +
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

    hideBackdrop();

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
     7. 翻转卡交互（点击 / tap / 键盘）
     ====================================================================== */
  function toggleFlip(card) {
    var flipped = card.classList.toggle('is-flipped');
    card.setAttribute('aria-expanded', flipped ? 'true' : 'false');
  }

  function onCardClick(e) {
    toggleFlip(e.currentTarget);
  }

  function onCardKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggleFlip(e.currentTarget);
    }
  }

  function bindCards() {
    Array.prototype.forEach.call(grid.querySelectorAll('[data-card]'), function (card) {
      card.addEventListener('click', onCardClick);
      card.addEventListener('keydown', onCardKeydown);
      if (pointerFine) {
        card.addEventListener('mouseenter', onCardEnter);
        card.addEventListener('mouseleave', onCardLeave);
      }
    });
  }

  /* ======================================================================
     8. 悬停换背景（仅 pointer: fine）
     ====================================================================== */
  function setBackdrop(el, movie) {
    var accent = accentFor(movie.id);
    var fallback = 'linear-gradient(135deg, ' + accent + ' 0%, #0b0b10 100%)';
    el.style.backgroundColor = accent;
    el.style.backgroundImage = fallback;
    el.setAttribute('data-current-id', String(movie.id));

    var url = movie.backdrop;
    if (!url) return;

    var img = new Image();
    img.onload = function () {
      if (el.getAttribute('data-current-id') === String(movie.id)) {
        el.style.backgroundImage = 'url("' + url + '"), ' + fallback;
      }
    };
    img.onerror = function () { /* 剧照缺失则保留主色渐变兜底 */ };
    img.src = url;
  }

  function showBackdrop(movie) {
    if (bgImages.length === 0) return;
    var nextIdx = bgActive === 0 ? 1 : 0;
    var next = bgImages[nextIdx];
    setBackdrop(next, movie);
    next.classList.add('is-active');
    if (bgActive !== -1 && bgImages[bgActive]) bgImages[bgActive].classList.remove('is-active');
    bgActive = nextIdx;
    if (bgLayer) bgLayer.classList.add('is-showing');
  }

  function hideBackdrop() {
    if (bgActive !== -1 && bgImages[bgActive]) bgImages[bgActive].classList.remove('is-active');
    bgActive = -1;
    if (bgLayer) bgLayer.classList.remove('is-showing');
  }

  function onCardEnter(e) {
    var card = e.currentTarget;
    var id = card.getAttribute('data-id');
    for (var i = 0; i < movies.length; i++) {
      if (String(movies[i].id) === String(id)) {
        showBackdrop(movies[i]);
        break;
      }
    }
  }

  function onCardLeave() {
    hideBackdrop();
  }

  /* ======================================================================
     9. 工具栏事件
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
     10. 移动端汉堡菜单
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

    // 离开移动端视口时收起菜单，避免状态残留
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
     11. JSON-LD 动态生成（与 movies.json 同源，避免双份维护）
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
        item.director = { '@type': 'Person', name: m.directors[0] };
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
     12. 数据加载与启动
     ====================================================================== */
  function loadData() {
    fetch('movies.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        movies = Array.isArray(data) ? data : (data && data.movies) || [];
        render();
        buildJsonLd();
      })
      .catch(function () {
        if (grid) grid.innerHTML = '';
        showEmpty('\u6570\u636e\u52a0\u8f7d\u5931\u8d25', '\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u65b0\u52a0\u8f7d');
      });
  }

  initTheme();
  initNav();
  initToolbar();
  loadData();
})();
