// QA Capture - 영역 선택 오버레이

(function () {
  const OVERLAY_ID = 'qa-capture-overlay';
  const SELECTION_ID = 'qa-capture-selection';
  const LABEL_ID = 'qa-capture-label';
  const GUIDE_ID = 'qa-capture-guide';

  // 이미 오버레이가 있으면 전부 제거 (토글 취소)
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    [OVERLAY_ID, SELECTION_ID, LABEL_ID, GUIDE_ID].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    return;
  }

  let startX = 0;
  let startY = 0;
  let isSelecting = false;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '2147483647',
    cursor: 'crosshair',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    margin: '0',
    padding: '0',
  });

  const selectionBox = document.createElement('div');
  selectionBox.id = SELECTION_ID;
  Object.assign(selectionBox.style, {
    position: 'fixed',
    border: '2px solid #4A90FF',
    backgroundColor: 'transparent',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
    zIndex: '2147483647',
    display: 'none',
    pointerEvents: 'none',
  });

  const sizeLabel = document.createElement('div');
  sizeLabel.id = LABEL_ID;
  Object.assign(sizeLabel.style, {
    position: 'fixed',
    backgroundColor: '#4A90FF',
    color: '#fff',
    fontSize: '12px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '2px 8px',
    borderRadius: '3px',
    zIndex: '2147483647',
    pointerEvents: 'none',
    display: 'none',
    whiteSpace: 'nowrap',
  });

  const guide = document.createElement('div');
  guide.id = GUIDE_ID;
  Object.assign(guide.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#fff',
    fontSize: '18px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: '500',
    textAlign: 'center',
    pointerEvents: 'none',
    zIndex: '2147483647',
    textShadow: '0 1px 4px rgba(0,0,0,0.5)',
    lineHeight: '1.6',
    whiteSpace: 'pre-line',
  });
  guide.textContent = '드래그하여 캡처 영역을 선택하세요\nESC로 취소';

  document.body.appendChild(overlay);
  document.body.appendChild(selectionBox);
  document.body.appendChild(sizeLabel);
  document.body.appendChild(guide);

  function collectEnvInfo() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
    if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;

    let os = 'Unknown';
    if (ua.includes('Mac OS X')) {
      const ver = ua.match(/Mac OS X ([\d_]+)/);
      os = `macOS ${ver ? ver[1].replace(/_/g, '.') : ''}`;
    } else if (ua.includes('Windows NT')) {
      const ver = ua.match(/Windows NT ([\d.]+)/);
      os = `Windows ${ver ? ver[1] : ''}`;
    } else if (ua.includes('Linux')) {
      os = 'Linux';
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = new Date().getTimezoneOffset();
    const offsetHours = -(offset / 60);
    const tzStr = `${tz} (UTC${offsetHours >= 0 ? '+' : ''}${offsetHours})`;

    return {
      browser,
      os,
      screenResolution: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timezone: tzStr,
      language: navigator.language,
    };
  }

  function cleanup() {
    [OVERLAY_ID, SELECTION_ID, LABEL_ID, GUIDE_ID].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function onMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    guide.style.display = 'none';
    overlay.style.backgroundColor = 'transparent';
    selectionBox.style.display = 'block';
    sizeLabel.style.display = 'block';
  }

  function onMouseMove(e) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();

    const left = Math.min(startX, e.clientX);
    const top = Math.min(startY, e.clientY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);

    Object.assign(selectionBox.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });

    Object.assign(sizeLabel.style, {
      left: `${left}px`,
      top: `${top + height + 6}px`,
    });
    sizeLabel.textContent = `${width} \u00d7 ${height}`;
  }

  function onMouseUp(e) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();
    isSelecting = false;

    const left = Math.min(startX, e.clientX);
    const top = Math.min(startY, e.clientY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);

    if (width < 10 || height < 10) {
      cleanup();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const envInfo = collectEnvInfo();
    const pageUrl = window.location.href;
    const pageTitle = document.title;

    // 오버레이 제거
    cleanup();

    // 브라우저가 repaint할 시간을 확보한 뒤 캡처 요청
    requestAnimationFrame(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'area-selected',
          selection: {
            x: Math.round(left * dpr),
            y: Math.round(top * dpr),
            width: Math.round(width * dpr),
            height: Math.round(height * dpr),
            devicePixelRatio: dpr,
          },
          envInfo,
          pageUrl,
          pageTitle,
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

  overlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keydown', onKeyDown, true);
})();
