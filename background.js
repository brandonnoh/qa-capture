// QA Capture - Background Service Worker

// --- 로그인 상태 확인 ---
function checkLoggedIn() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      resolve(!!token && !chrome.runtime.lastError);
    });
  });
}

// --- 단축키 리스너 ---
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-qa') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }

  const loggedIn = await checkLoggedIn();
  if (!loggedIn) {
    // 로그인 안 됨 → 탭에 알림 표시
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const toast = document.createElement('div');
        Object.assign(toast.style, {
          position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
          zIndex: '2147483647', padding: '12px 24px', borderRadius: '8px',
          background: '#dc2626', color: '#fff', fontSize: '14px', fontWeight: '600',
          fontFamily: '-apple-system, sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        });
        toast.textContent = 'QA Capture: 먼저 Google 로그인이 필요합니다.';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
      },
    });
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  });
});

// --- 메시지 핸들러 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // offscreen 전용 메시지 — background에서 무시
  if (message.action === 'crop-image' || message.action === 'crop-complete') {
    return false;
  }

  if (message.action === 'start-capture') {
    const tabId = message.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: 'No tabId' });
      return false;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === 'area-selected') {
    handleAreaSelected(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('캡처 실패:', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'get-capture-data') {
    chrome.storage.session.get('captureData').then((stored) => {
      sendResponse(stored.captureData || null);
    });
    return true;
  }

  if (message.action === 'submit-qa') {
    handleSubmitQA(message.formData)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

// --- 영역 선택 완료 처리 ---
async function handleAreaSelected(message, sender) {
  const tabId = sender.tab.id;

  // content.js가 오버레이 제거 후 repaint 대기한 뒤 메시지를 보내므로
  // captureVisibleTab 시점에는 오버레이가 없음
  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: 'png',
  });

  const croppedDataUrl = await cropImage(screenshotDataUrl, message.selection);

  // JPEG로 변환하여 용량 축소 (session storage 1MB 제한 대응)
  const compressedDataUrl = await compressImage(croppedDataUrl);

  const captureData = {
    screenshot: compressedDataUrl,
    selection: message.selection,
    envInfo: message.envInfo,
    pageUrl: message.pageUrl,
    pageTitle: message.pageTitle,
    timestamp: new Date().toISOString(),
  };

  await chrome.storage.session.set({ captureData });

  chrome.windows.create({
    url: 'popup/popup.html',
    type: 'popup',
    width: 520,
    height: 720,
    focused: true,
  });
}

// --- 이미지 크롭 (OffscreenDocument) ---
async function cropImage(dataUrl, selection) {
  await ensureOffscreen();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      reject(new Error('크롭 타임아웃'));
    }, 10000);

    function handler(msg) {
      if (msg.action !== 'crop-complete') return;
      chrome.runtime.onMessage.removeListener(handler);
      clearTimeout(timeout);
      if (msg.success) {
        resolve(msg.croppedDataUrl);
      } else {
        reject(new Error(msg.error || '크롭 실패'));
      }
    }

    chrome.runtime.onMessage.addListener(handler);

    // offscreen에 크롭 요청 — sendMessage는 background 자신도 받으므로
    // offscreen.js에서 onMessage로 수신
    chrome.runtime.sendMessage({
      action: 'crop-image',
      dataUrl,
      selection,
    });
  });
}

// --- 이미지 JPEG 압축 (용량 절감) ---
async function compressImage(dataUrl) {
  await ensureOffscreen();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      resolve(dataUrl); // 압축 실패 시 원본 사용
    }, 5000);

    function handler(msg) {
      if (msg.action !== 'compress-complete') return;
      chrome.runtime.onMessage.removeListener(handler);
      clearTimeout(timeout);
      resolve(msg.compressedDataUrl || dataUrl);
    }

    chrome.runtime.onMessage.addListener(handler);
    chrome.runtime.sendMessage({ action: 'compress-image', dataUrl });
  });
}

// --- Offscreen Document 관리 ---
async function ensureOffscreen() {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: '이미지 크롭 및 압축',
    });
  } catch (e) {
    if (!e.message.includes('Only a single offscreen')) {
      throw e;
    }
  }
}

// --- OAuth 토큰 관리 ---
async function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function fetchWithAuth(url, options = {}) {
  let token = await getAuthToken(true);

  let response = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    await new Promise((resolve) =>
      chrome.identity.removeCachedAuthToken({ token }, resolve)
    );
    token = await getAuthToken(true);
    response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });
  }

  return response;
}

// --- QA 제출 ---
async function handleSubmitQA(formData) {
  const settings = await chrome.storage.sync.get([
    'spreadsheetId',
    'driveFolderId',
    'sheetName',
  ]);

  if (!settings.spreadsheetId || !settings.driveFolderId) {
    throw new Error('설정에서 스프레드시트 ID와 Drive 폴더 ID를 먼저 입력해주세요.');
  }

  const stored = await chrome.storage.session.get('captureData');
  const captureData = stored.captureData;
  if (!captureData || !captureData.screenshot) {
    throw new Error('캡처 데이터가 없습니다. 다시 캡처해주세요.');
  }

  const sheetName = settings.sheetName || 'Sheet1';

  // 1. Drive 업로드
  const imageBlob = dataUrlToBlob(captureData.screenshot);
  const fileName = `QA_${Date.now()}.png`;
  const driveResult = await uploadToDrive(imageBlob, fileName, settings.driveFolderId);

  // 2. 파일 공개 설정
  await makeFilePublic(driveResult.id);

  // 3. Sheets에 행 추가
  const webViewLink = `https://drive.google.com/file/d/${driveResult.id}/view`;
  const rowData = buildRowData(formData, captureData, webViewLink);
  await appendToSheet(settings.spreadsheetId, sheetName, rowData);

  // 캡처 데이터 초기화
  await chrome.storage.session.remove('captureData');

  return { success: true, driveLink: webViewLink };
}

// --- Google Drive 업로드 ---
async function uploadToDrive(blob, fileName, folderId) {
  const token = await getAuthToken(true);
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'image/png',
  };

  function buildForm() {
    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );
    form.append('file', blob);
    return form;
  }

  let response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: buildForm(),
    }
  );

  if (response.status === 401) {
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
    const newToken = await getAuthToken(true);
    response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${newToken}` },
        body: buildForm(),
      }
    );
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error?.message || `Drive 업로드 실패 (${response.status})`);
  }

  return response.json();
}

// --- Drive 파일 공개 설정 ---
async function makeFilePublic(fileId) {
  const response = await fetchWithAuth(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    }
  );

  if (!response.ok) {
    console.warn('파일 공개 설정 실패 (계속 진행):', response.status);
  }
}

// --- Google Sheets 행 추가 ---
async function appendToSheet(spreadsheetId, sheetName, rowData) {
  const escapedName = sheetName.replace(/'/g, "''");
  const range = `'${escapedName}'!A:P`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetchWithAuth(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [rowData] }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error?.message || `Sheets 저장 실패 (${response.status})`);
  }

  return response.json();
}

// --- 행 데이터 구성 (16개 컬럼) ---
function buildRowData(formData, captureData, webViewLink) {
  const now = new Date();
  const dateStr = now.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const env = captureData.envInfo || {};
  const safeLink = webViewLink.replace(/"/g, '""');

  return [
    '=ROW()-1',
    dateStr,
    captureData.pageUrl || '',
    formData.category || '',
    formData.comment || '',
    `=HYPERLINK("${safeLink}", "스크린샷 보기")`,
    'Open',
    formData.assignee || '',
    formData.severity || '',
    formData.reproSteps || '',
    env.browser || '',
    env.os || '',
    env.screenResolution || '',
    env.viewport || '',
    env.timezone || '',
    env.language || '',
  ];
}

// --- 유틸: DataURL → Blob ---
function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}
