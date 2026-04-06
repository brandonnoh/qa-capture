// QA Capture - DOM 요소 검사 모드

(function () {
  const PREFIX = 'qa-inspector-';
  const TOOLTIP_ID = PREFIX + 'tooltip';
  const HIGHLIGHT_ID = PREFIX + 'highlight';
  const LABEL_ID = PREFIX + 'label';
  const Z_INDEX = '2147483646';

  // 이미 검사 모드가 활성화되어 있으면 제거 (토글 취소)
  if (document.getElementById(TOOLTIP_ID)) {
    cleanup();
    return;
  }

  let hoveredEl = null;

  function collectEnvInfo() {
    const ua = navigator.userAgent;
    const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
    const browser = chromeMatch ? `Chrome ${chromeMatch[1]}` : 'Unknown';
    let os = 'Unknown';
    if (ua.includes('Mac OS X')) {
      const v = ua.match(/Mac OS X ([\d_]+)/);
      os = `macOS ${v ? v[1].replace(/_/g, '.') : ''}`;
    } else if (ua.includes('Windows NT')) {
      const v = ua.match(/Windows NT ([\d.]+)/);
      os = `Windows ${v ? v[1] : ''}`;
    } else if (ua.includes('Linux')) { os = 'Linux'; }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = -(new Date().getTimezoneOffset() / 60);
    return {
      browser, os,
      screenResolution: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timezone: `${tz} (UTC${off >= 0 ? '+' : ''}${off})`,
      language: navigator.language,
    };
  }

  // --- 툴팁 생성 ---
  const tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  Object.assign(tooltip.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: Z_INDEX,
    padding: '8px 18px',
    borderRadius: '8px',
    backgroundColor: '#222',
    color: '#fff',
    fontSize: '14px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: '500',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  });
  tooltip.textContent = '요소를 클릭하여 선택하세요 (ESC로 취소)';

  // --- 하이라이트 오버레이 ---
  const highlight = document.createElement('div');
  highlight.id = HIGHLIGHT_ID;
  Object.assign(highlight.style, {
    position: 'fixed',
    border: '2px solid #4A90FF',
    backgroundColor: 'rgba(74, 144, 255, 0.08)',
    zIndex: Z_INDEX,
    pointerEvents: 'none',
    display: 'none',
    borderRadius: '2px',
    transition: 'top 0.05s, left 0.05s, width 0.05s, height 0.05s',
  });

  // --- 요소 정보 라벨 ---
  const label = document.createElement('div');
  label.id = LABEL_ID;
  Object.assign(label.style, {
    position: 'fixed',
    zIndex: Z_INDEX,
    padding: '2px 8px',
    borderRadius: '3px',
    backgroundColor: '#4A90FF',
    color: '#fff',
    fontSize: '11px',
    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
    pointerEvents: 'none',
    display: 'none',
    whiteSpace: 'nowrap',
    maxWidth: '400px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  document.body.appendChild(tooltip);
  document.body.appendChild(highlight);
  document.body.appendChild(label);

  // --- 자체 UI 요소인지 확인 ---
  function isInspectorElement(el) {
    if (!el || !el.id) return false;
    return el.id.startsWith(PREFIX);
  }

  // --- 요소 설명 문자열 (tag.class1.class2) ---
  function describeElement(el) {
    let desc = el.tagName.toLowerCase();
    if (el.id) {
      desc += '#' + el.id;
    } else if (el.classList.length > 0) {
      desc += '.' + Array.from(el.classList).join('.');
    }
    return desc;
  }

  // --- 고유 CSS 셀렉터 구축 ---
  function buildSelector(el) {
    if (el.id) {
      return '#' + el.id;
    }

    const base = buildBaseSelector(el);
    if (isUnique(base)) return base;

    return buildAncestorSelector(el, base);
  }

  function buildBaseSelector(el) {
    let sel = el.tagName.toLowerCase();
    if (el.classList.length > 0) {
      sel += '.' + Array.from(el.classList).join('.');
    }
    return sel;
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (_e) {
      return false;
    }
  }

  function buildAncestorSelector(el, childSel) {
    let current = el.parentElement;
    let path = childSel;
    let depth = 0;

    while (current && current !== document.body && depth < 3) {
      const parentSel = current.id
        ? '#' + current.id
        : buildBaseSelector(current);
      path = parentSel + ' > ' + path;
      if (isUnique(path)) return path;
      if (current.id) break;
      current = current.parentElement;
      depth++;
    }

    return path;
  }

  // --- 요소 정보 수집 ---
  function collectElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const computed = window.getComputedStyle(el);
    const text = (el.textContent || '').trim().slice(0, 100);

    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || '',
      classList: Array.from(el.classList),
      selector: buildSelector(el),
      textContent: text,
      boundingRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      computedStyles: {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontSize: computed.fontSize,
        fontFamily: computed.fontFamily,
        padding: computed.padding,
        margin: computed.margin,
      },
    };
  }

  // --- 스케일된 선택 영역 계산 ---
  function buildSelection(rect) {
    const dpr = window.devicePixelRatio || 1;
    return {
      x: Math.round(rect.x * dpr),
      y: Math.round(rect.y * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr),
      devicePixelRatio: dpr,
    };
  }

  // --- 하이라이트 위치 업데이트 ---
  function updateHighlight(el) {
    const rect = el.getBoundingClientRect();

    Object.assign(highlight.style, {
      display: 'block',
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });

    label.textContent = describeElement(el);
    const labelTop = rect.top > 24 ? (rect.top - 22) + 'px' : (rect.bottom + 4) + 'px';
    Object.assign(label.style, {
      display: 'block',
      top: labelTop,
      left: rect.left + 'px',
    });
  }

  // --- 하이라이트 숨기기 ---
  function hideHighlight() {
    highlight.style.display = 'none';
    label.style.display = 'none';
    hoveredEl = null;
  }

  // --- 이벤트 핸들러 ---
  function onMouseOver(e) {
    const target = e.target;
    if (isInspectorElement(target)) return;
    if (target === hoveredEl) return;
    hoveredEl = target;
    updateHighlight(target);
  }

  function onMouseOut(e) {
    const related = e.relatedTarget;
    if (related && !isInspectorElement(related)) return;
    hideHighlight();
  }

  function onClick(e) {
    const target = e.target;
    if (isInspectorElement(target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const elementInfo = collectElementInfo(target);
    const selection = buildSelection(target.getBoundingClientRect());
    const envInfo = collectEnvInfo();

    cleanup();

    requestAnimationFrame(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'element-selected',
          elementInfo,
          selection,
          envInfo,
          pageUrl: window.location.href,
          pageTitle: document.title,
        });
      }, 150);
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  }

  // --- 정리 ---
  function cleanup() {
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    [TOOLTIP_ID, HIGHLIGHT_ID, LABEL_ID].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  // --- 이벤트 등록 ---
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
})();
