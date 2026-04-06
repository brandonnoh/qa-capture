// QA Capture - 영역 선택 오버레이
// content.js는 background.js에서 주입되며, 사용자가 드래그로 영역을 선택할 수 있게 합니다.

(function () {
  // 이미 오버레이가 있으면 제거
  const existing = document.getElementById('qa-capture-overlay');
  if (existing) {
    existing.remove();
    return;
  }

  let startX, startY, isSelecting = false;

  // 오버레이 컨테이너
  const overlay = document.createElement('div');
  overlay.id = 'qa-capture-overlay';
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

  // 선택 영역 표시 박스
  const selectionBox = document.createElement('div');
  Object.assign(selectionBox.style, {
    position: 'fixed',
    border: '2px solid #4A90FF',
    backgroundColor: 'transparent',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
    zIndex: '2147483647',
    display: 'none',
    pointerEvents: 'none',
  });

  // 크기 표시 라벨
  const sizeLabel = document.createElement('div');
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

  // 안내 텍스트
  const guide = document.createElement('div');
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
  });
  guide.textContent = '드래그하여 캡처 영역을 선택하세요\nESC로 취소';
  guide.style.whiteSpace = 'pre-line';

  document.body.appendChild(overlay);
  document.body.appendChild(selectionBox);
  document.body.appendChild(sizeLabel);
  document.body.appendChild(guide);

  // 환경 정보 수집
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
    const tzString = `${tz} (UTC${offsetHours >= 0 ? '+' : ''}${offsetHours})`;

    return {
      browser,
      os,
      screenResolution: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timezone: tzString,
      language: navigator.language,
    };
  }

  function cleanup() {
    overlay.remove();
    selectionBox.remove();
    sizeLabel.remove();
    guide.remove();
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function onMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    guide.style.display = 'none';

    // 오버레이 투명하게 만들고 selectionBox의 box-shadow로 어두운 영역 표현
    overlay.style.backgroundColor = 'transparent';
    selectionBox.style.display = 'block';
    sizeLabel.style.display = 'block';
  }

  function onMouseMove(e) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    Object.assign(selectionBox.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });

    // 크기 라벨 위치 (선택 영역 아래)
    Object.assign(sizeLabel.style, {
      left: `${left}px`,
      top: `${top + height + 6}px`,
    });
    sizeLabel.textContent = `${width} × ${height}`;
  }

  function onMouseUp(e) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation();
    isSelecting = false;

    const endX = e.clientX;
    const endY = e.clientY;

    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    // 너무 작은 선택은 무시 (실수 클릭 방지)
    if (width < 10 || height < 10) {
      cleanup();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const envInfo = collectEnvInfo();

    cleanup();

    // background.js로 좌표 + 환경정보 전송
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
      pageUrl: window.location.href,
      pageTitle: document.title,
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
