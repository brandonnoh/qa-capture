// QA Capture - Background Service Worker

// 아이콘 클릭 시 Side Panel 열기 (팝업 메뉴 대신)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function checkLoggedIn() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      resolve(!!token && !chrome.runtime.lastError);
    });
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  // 확장 페이지가 아닌 일반 웹 탭 반환
  return tabs.find((t) => t.url && !t.url.startsWith('chrome-extension://')) || tabs[0];
}

function isCapturableTab(tab) {
  return tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://');
}

async function showLoginRequiredToast(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const t = document.createElement('div');
    Object.assign(t.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '12px 24px', borderRadius: '8px',
      background: '#dc2626', color: '#fff', fontSize: '14px', fontWeight: '600',
      fontFamily: '-apple-system, sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    });
    t.textContent = 'QA Capture: 먼저 Google 로그인이 필요합니다.';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }});
}

async function showCaptureCompleteToast(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      if (document.getElementById('qa-capture-toast')) return;
      const t = document.createElement('div');
      t.id = 'qa-capture-toast';
      Object.assign(t.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '2147483647', padding: '12px 24px', borderRadius: '8px',
        background: '#16a34a', color: '#fff', fontSize: '14px', fontWeight: '600',
        fontFamily: '-apple-system, sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        cursor: 'pointer',
      });
      t.textContent = '✓ 캡처 완료! QA 아이콘을 클릭하여 결과를 확인하세요.';
      t.addEventListener('click', () => t.remove());
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 4000);
    }});
  } catch { /* 무시 */ }
}

function notifySidePanel(action, data) {
  chrome.runtime.sendMessage({ action, ...data }).catch(() => {});
}

function injectScript(tabId, file, sendResponse) {
  if (!tabId) { sendResponse({ ok: false, error: 'No tabId' }); return; }
  chrome.scripting.executeScript({ target: { tabId }, files: [file] })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
}

async function handleShortcut(scriptFile) {
  const tab = await getActiveTab();
  if (!isCapturableTab(tab)) return;
  if (!(await checkLoggedIn())) { await showLoginRequiredToast(tab.id); return; }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [scriptFile] });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-qa') await handleShortcut('content.js');
  else if (command === 'inspect-element') await handleShortcut('content-inspector.js');
});

async function handleCaptureComplete(message, sender, selectionKey) {
  const tab = sender.tab;
  const windowId = tab.windowId;
  const isElementSelect = message.action === 'element-selected';
  const existing = (await chrome.storage.session.get('captureData')).captureData;

  // Element selection with existing screenshot: merge element info without replacing screenshot
  if (isElementSelect && existing && existing.screenshot) {
    existing.elementInfo = message.elementInfo || null;
    existing.timestamp = new Date().toISOString();
    await chrome.storage.session.set({ captureData: existing });
    notifySidePanel('capture-updated', { timestamp: existing.timestamp });
    showCaptureCompleteToast(tab.id);
    return;
  }

  // Area capture or first capture: take screenshot and build full captureData
  const screenshot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const cropped = await cropImage(screenshot, message[selectionKey]);
  const compressed = await compressImage(cropped);
  const captureData = {
    screenshot: compressed, selection: message[selectionKey],
    envInfo: message.envInfo, pageUrl: message.pageUrl,
    pageTitle: message.pageTitle, timestamp: new Date().toISOString(),
  };
  if (message.elementInfo) captureData.elementInfo = message.elementInfo;
  await chrome.storage.session.set({ captureData });
  notifySidePanel('capture-updated', { timestamp: captureData.timestamp });

  // Side Panel이 열려있지 않으면 페이지에 토스트로 안내
  showCaptureCompleteToast(tab.id);
}

const IGNORED_ACTIONS = ['crop-image', 'crop-complete', 'compress-complete'];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (IGNORED_ACTIONS.includes(message.action)) return false;
  switch (message.action) {
    case 'start-capture':
    case 'start-area-capture':
      injectScript(message.tabId, 'content.js', sendResponse);
      return true;
    case 'start-element-inspect':
      injectScript(message.tabId, 'content-inspector.js', sendResponse);
      return true;
    case 'area-selected':
      handleCaptureComplete(message, sender, 'selection')
        .then(() => sendResponse({ ok: true }))
        .catch((err) => { console.error('캡처 실패:', err); sendResponse({ ok: false, error: err.message }); });
      return true;
    case 'element-selected':
      handleCaptureComplete(message, sender, 'selection')
        .then(() => sendResponse({ ok: true }))
        .catch((err) => { console.error('요소 검사 실패:', err); sendResponse({ ok: false, error: err.message }); });
      return true;
    case 'get-capture-data':
      chrome.storage.session.get('captureData').then((s) => sendResponse(s.captureData || null));
      return true;
    case 'submit-qa':
      handleSubmitQA(message.formData)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    default:
      return false;
  }
});

// --- 이미지 크롭 (OffscreenDocument) ---
async function cropImage(dataUrl, selection) {
  await ensureOffscreen();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(handler); reject(new Error('크롭 타임아웃')); }, 10000);
    function handler(msg) {
      if (msg.action !== 'crop-complete') return;
      chrome.runtime.onMessage.removeListener(handler);
      clearTimeout(timeout);
      msg.success ? resolve(msg.croppedDataUrl) : reject(new Error(msg.error || '크롭 실패'));
    }
    chrome.runtime.onMessage.addListener(handler);
    chrome.runtime.sendMessage({ action: 'crop-image', dataUrl, selection });
  });
}

// --- 이미지 JPEG 압축 ---
async function compressImage(dataUrl) {
  await ensureOffscreen();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { chrome.runtime.onMessage.removeListener(handler); resolve(dataUrl); }, 5000);
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

async function ensureOffscreen() {
  try {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: '이미지 크롭 및 압축' });
  } catch (e) {
    if (!e.message.includes('Only a single offscreen')) throw e;
  }
}

// --- OAuth 토큰 관리 ---
let scopeVerified = false;

async function getAuthToken(interactive = true) {
  // 최초 interactive 호출 시 캐시 삭제 → 최신 manifest 스코프로 토큰 재발급
  if (interactive && !scopeVerified) {
    await chrome.identity.clearAllCachedAuthTokens();
    scopeVerified = true;
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

async function fetchWithAuth(url, options = {}) {
  let token = await getAuthToken(true);
  let resp = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  if (resp.status === 401) {
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
    token = await getAuthToken(true);
    resp = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  }
  return resp;
}

// --- QA 제출 ---
async function handleSubmitQA(formData) {
  const settings = await chrome.storage.sync.get(['spreadsheetId', 'driveFolderId', 'sheetName']);
  if (!settings.spreadsheetId || !settings.driveFolderId) {
    throw new Error('설정에서 스프레드시트 ID와 Drive 폴더 ID를 먼저 입력해주세요.');
  }
  const captureData = (await chrome.storage.session.get('captureData')).captureData;
  if (!captureData || !captureData.screenshot) {
    throw new Error('캡처 데이터가 없습니다. 다시 캡처해주세요.');
  }
  const sheetName = settings.sheetName || 'Sheet1';
  const driveResult = await uploadToDrive(dataUrlToBlob(captureData.screenshot), `QA_${Date.now()}.png`, settings.driveFolderId);
  await makeFilePublic(driveResult.id);
  const webViewLink = `https://drive.google.com/file/d/${driveResult.id}/view`;
  await appendToSheet(settings.spreadsheetId, sheetName, buildRowData(formData, captureData, webViewLink));
  await chrome.storage.session.remove('captureData');
  return { success: true, driveLink: webViewLink };
}

// --- Google Drive 업로드 ---
async function uploadToDrive(blob, fileName, folderId) {
  const token = await getAuthToken(true);
  const metadata = { name: fileName, parents: [folderId], mimeType: 'image/png' };
  const buildForm = () => {
    const f = new FormData();
    f.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    f.append('file', blob);
    return f;
  };
  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
  let resp = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: buildForm() });
  if (resp.status === 401) {
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
    const t2 = await getAuthToken(true);
    resp = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${t2}` }, body: buildForm() });
  }
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error?.message || `Drive 업로드 실패 (${resp.status})`);
  }
  return resp.json();
}

async function makeFilePublic(fileId) {
  const resp = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!resp.ok) console.warn('파일 공개 설정 실패 (계속 진행):', resp.status);
}

async function appendToSheet(spreadsheetId, sheetName, rowData) {
  const range = `'${sheetName.replace(/'/g, "''")}'!A:P`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await fetchWithAuth(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [rowData] }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error?.message || `Sheets 저장 실패 (${resp.status})`);
  }
  return resp.json();
}

function buildRowData(formData, captureData, webViewLink) {
  const dateStr = new Date().toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const env = captureData.envInfo || {};
  const safe = webViewLink.replace(/"/g, '""');
  return [
    '=ROW()-1', dateStr, captureData.pageUrl || '', formData.category || '',
    formData.comment || '', `=HYPERLINK("${safe}", "스크린샷 보기")`, 'Open',
    formData.assignee || '', formData.severity || '', formData.reproSteps || '',
    env.browser || '', env.os || '', env.screenResolution || '',
    env.viewport || '', env.timezone || '', env.language || '',
  ];
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
