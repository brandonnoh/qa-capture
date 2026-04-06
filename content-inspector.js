// QA Capture - DOM 요소 검사 모드

(function () {
  const PREFIX = 'qa-inspector-';
  const TOOLTIP_ID = PREFIX + 'tooltip';
  const HIGHLIGHT_ID = PREFIX + 'highlight';
  const LABEL_ID = PREFIX + 'label';
  const Z_INDEX = '2147483646';
  const MAX_SELECTOR_DEPTH = 6;
  const SKIP_CLASSES = new Set([
    'active', 'hover', 'focus', 'visited', 'disabled', 'selected',
    'open', 'closed', 'show', 'hide', 'hidden', 'visible',
    'fade', 'in', 'out', 'collapse', 'collapsing',
  ]);

  // 이미 검사 모드가 활성화되어 있으면 제거 (토글 취소)
  if (document.getElementById(TOOLTIP_ID)) {
    cleanup();
    return;
  }

  let hoveredEl = null;

  // --- 환경 정보 수집 ---
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

  // --- 의미 있는 클래스 필터링 ---
  function getMeaningfulClasses(el) {
    return Array.from(el.classList).filter(function (c) {
      return !SKIP_CLASSES.has(c) && !c.startsWith(PREFIX);
    });
  }

  // --- 단일 요소의 셀렉터 조각 생성 ---
  function buildSegment(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !el.id.startsWith(PREFIX)) return tag + '#' + el.id;
    const classes = getMeaningfulClasses(el);
    let seg = tag;
    if (classes.length > 0) seg += '.' + classes.join('.');
    return seg;
  }

  // --- nth-child 인덱스 계산 ---
  function getNthChild(el) {
    const parent = el.parentElement;
    if (!parent) return null;
    const siblings = Array.from(parent.children);
    if (siblings.length <= 1) return null;
    const tag = el.tagName;
    const sameTag = siblings.filter(function (s) { return s.tagName === tag; });
    if (sameTag.length <= 1) return null;
    const index = siblings.indexOf(el) + 1;
    return ':nth-child(' + index + ')';
  }

  // --- 전체 CSS 경로 빌드 (body부터 대상까지, 최대 6단계) ---
  function buildSelector(el) {
    const parts = [];
    let current = el;
    let depth = 0;

    while (current && current !== document.documentElement && depth < MAX_SELECTOR_DEPTH) {
      if (current === document.body) { parts.unshift('body'); break; }
      let seg = buildSegment(current);
      const nth = getNthChild(current);
      if (nth) seg += nth;
      parts.unshift(seg);
      if (current.id && !current.id.startsWith(PREFIX)) break;
      current = current.parentElement;
      depth++;
    }

    return parts.join(' > ');
  }

  // --- XPath 빌드 ---
  function buildXPath(el) {
    const parts = [];
    let current = el;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      if (current === document.documentElement) { parts.unshift('/html'); break; }
      const parent = current.parentElement;
      if (!parent) { parts.unshift('/' + tag); break; }
      const siblings = Array.from(parent.children).filter(function (s) {
        return s.tagName === current.tagName;
      });
      const idx = siblings.indexOf(current) + 1;
      parts.unshift('/' + tag + (siblings.length > 1 ? '[' + idx + ']' : ''));
      current = parent;
    }

    return parts.join('');
  }

  // --- 요소 설명 문자열 (tag#id 또는 tag.class) ---
  function describeElement(el) {
    let desc = el.tagName.toLowerCase();
    if (el.id) return desc + '#' + el.id;
    const classes = getMeaningfulClasses(el);
    if (classes.length > 0) desc += '.' + classes.join('.');
    return desc;
  }

  // --- QA 관련 계산 스타일 수집 ---
  function getQAStyles(el) {
    const computed = window.getComputedStyle(el);
    return {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      zIndex: computed.zIndex,
      overflow: computed.overflow,
    };
  }

  // --- 요소 정보 수집 ---
  function collectElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const text = (el.textContent || '').trim().slice(0, 100);
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || '',
      classList: Array.from(el.classList),
      selector: buildSelector(el),
      xpath: buildXPath(el),
      dimensions: Math.round(rect.width) + 'x' + Math.round(rect.height) + 'px',
      position: 'x:' + Math.round(rect.left) + ', y:' + Math.round(rect.top),
      textContent: text,
      boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      computedStyles: getQAStyles(el),
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

  // --- UI 요소 생성 ---
  const tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  Object.assign(tooltip.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
    zIndex: Z_INDEX, padding: '8px 18px', borderRadius: '8px',
    backgroundColor: '#222', color: '#fff', fontSize: '14px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: '500', pointerEvents: 'none', whiteSpace: 'nowrap',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  });
  tooltip.textContent = '요소를 클릭하여 선택하세요 (ESC로 취소)';

  const highlight = document.createElement('div');
  highlight.id = HIGHLIGHT_ID;
  Object.assign(highlight.style, {
    position: 'fixed', border: '2px solid #4A90FF',
    backgroundColor: 'rgba(74, 144, 255, 0.08)', zIndex: Z_INDEX,
    pointerEvents: 'none', display: 'none', borderRadius: '2px',
    transition: 'top 0.05s, left 0.05s, width 0.05s, height 0.05s',
  });

  const label = document.createElement('div');
  label.id = LABEL_ID;
  Object.assign(label.style, {
    position: 'fixed', zIndex: Z_INDEX, padding: '2px 8px', borderRadius: '3px',
    backgroundColor: '#4A90FF', color: '#fff', fontSize: '11px',
    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
    pointerEvents: 'none', display: 'none', whiteSpace: 'nowrap',
    maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis',
  });

  document.body.appendChild(tooltip);
  document.body.appendChild(highlight);
  document.body.appendChild(label);

  // --- 자체 UI 요소인지 확인 ---
  function isInspectorElement(el) {
    return el && el.id && el.id.startsWith(PREFIX);
  }

  // --- 하이라이트 위치 업데이트 ---
  function updateHighlight(el) {
    const rect = el.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: 'block', top: rect.top + 'px', left: rect.left + 'px',
      width: rect.width + 'px', height: rect.height + 'px',
    });
    label.textContent = describeElement(el);
    const labelTop = rect.top > 24 ? (rect.top - 22) + 'px' : (rect.bottom + 4) + 'px';
    Object.assign(label.style, { display: 'block', top: labelTop, left: rect.left + 'px' });
  }

  // --- 하이라이트 숨기기 ---
  function hideHighlight() {
    highlight.style.display = 'none';
    label.style.display = 'none';
    hoveredEl = null;
  }

  // --- 이벤트 핸들러 ---
  function onMouseOver(e) {
    if (isInspectorElement(e.target) || e.target === hoveredEl) return;
    hoveredEl = e.target;
    updateHighlight(e.target);
  }

  function onMouseOut(e) {
    if (e.relatedTarget && !isInspectorElement(e.relatedTarget)) return;
    hideHighlight();
  }

  function onClick(e) {
    if (isInspectorElement(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const elementInfo = collectElementInfo(e.target);
    const selection = buildSelection(e.target.getBoundingClientRect());
    const envInfo = collectEnvInfo();

    cleanup();

    requestAnimationFrame(function () {
      setTimeout(function () {
        try {
          chrome.runtime.sendMessage({
            action: 'element-selected',
            elementInfo, selection, envInfo,
            pageUrl: window.location.href,
            pageTitle: document.title,
          });
        } catch {
          // Extension context invalidated (확장 새로고침 후 발생) — 무시
        }
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

  // --- 정리: 모든 리스너 및 요소 제거 ---
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
