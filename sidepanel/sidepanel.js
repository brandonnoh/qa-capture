// QA Capture - Side Panel Script

document.addEventListener('DOMContentLoaded', () => {
  initPanel().catch((err) => showStatus(err.message, 'error'));
});

async function initPanel() {
  await checkSettings();
  await loadCaptureData();
  await fillAssignee();
  await restoreSavedTags();
  bindTagGroups();
  bindActionButtons();
  bindEnvToggle();
  bindFormSubmit();
  bindKeyboardShortcut();
  listenForUpdates();
}

// --- 설정 확인 ---
async function checkSettings() {
  const s = await chrome.storage.sync.get(['spreadsheetId', 'driveFolderId']);
  if (!s.spreadsheetId || !s.driveFolderId) {
    showStatus('먼저 설정에서 프로젝트를 연결해주세요.', 'error');
    getEl('btn-submit').disabled = true;
  }
}

// --- 캡처 데이터 로드 ---
async function loadCaptureData() {
  const stored = await chrome.storage.session.get('captureData');
  const data = stored.captureData;
  if (data && data.screenshot) {
    displayScreenshot(data.screenshot);
    if (data.envInfo) displayEnvInfo(data.envInfo);
    if (data.elementInfo) displayElementInfo(data.elementInfo);
    else hideElementInfo();
  } else {
    resetPreview();
  }
}

function displayScreenshot(dataUrl) {
  const img = getEl('preview-image');
  img.src = dataUrl;
  img.classList.add('visible');
  getEl('preview-empty').classList.add('hidden');
}

function resetPreview() {
  getEl('preview-image').classList.remove('visible');
  getEl('preview-empty').classList.remove('hidden');
  hideElementInfo();
}

// --- 환경 정보 표시 ---
function displayEnvInfo(envInfo) {
  if (!envInfo) return;
  const content = getEl('env-content');
  const items = [
    { label: '브라우저', value: envInfo.browser },
    { label: 'OS', value: envInfo.os },
    { label: '해상도', value: envInfo.screenResolution },
    { label: '뷰포트', value: envInfo.viewport },
    { label: '시간대', value: envInfo.timezone },
    { label: '언어', value: envInfo.language },
  ].filter((i) => i.value);
  content.textContent = '';
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'env-item';
    const lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = item.label;
    const val = document.createElement('span');
    val.textContent = item.value;
    row.append(lbl, val);
    content.appendChild(row);
  });
  getEl('env-info').classList.remove('hidden');
}

// --- DOM 요소 정보 ---
function displayElementInfo(info) {
  if (!info) return;
  getEl('el-tag').textContent = info.tagName || '';
  getEl('el-id').textContent = info.id || '(없음)';
  const cls = Array.isArray(info.classList) ? info.classList.join(' ') : '';
  getEl('el-class').textContent = cls || '(없음)';
  getEl('el-text').textContent = truncate(info.textContent || '', 80);
  getEl('el-selector').textContent = info.selector || '';
  getEl('element-info').classList.remove('hidden');
}

function hideElementInfo() {
  getEl('element-info').classList.add('hidden');
}

// --- 담당자 자동 입력 ---
async function fillAssignee() {
  const defaults = await chrome.storage.sync.get(['defaultAssignee']);
  if (defaults.defaultAssignee) {
    getEl('assignee').value = defaults.defaultAssignee;
    return;
  }
  try {
    const token = await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        resolve(chrome.runtime.lastError ? null : t);
      });
    });
    if (!token) return;
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return;
    const user = await res.json();
    if (user.email) getEl('assignee').value = user.email;
  } catch {
    // 로그인 안 된 상태
  }
}

// --- 태그 복원 + 바인딩 ---
async function restoreSavedTags() {
  const saved = await chrome.storage.sync.get(['lastCategory', 'lastSeverity']);
  if (saved.lastCategory) activateTag('category-tags', 'category', saved.lastCategory);
  if (saved.lastSeverity) activateTag('severity-tags', 'severity', saved.lastSeverity);
}

function activateTag(groupId, hiddenId, value) {
  const match = getEl(groupId).querySelector('.tag[data-value="' + value + '"]');
  if (match) {
    match.classList.add('active');
    getEl(hiddenId).value = value;
  }
}

function bindTagGroups() {
  setupTagGroup('category-tags', 'category');
  setupTagGroup('severity-tags', 'severity');
}

function setupTagGroup(groupId, hiddenId) {
  getEl(groupId).addEventListener('click', (e) => {
    const tag = e.target.closest('.tag');
    if (!tag) return;
    getEl(groupId).querySelectorAll('.tag').forEach((t) => t.classList.remove('active'));
    tag.classList.add('active');
    getEl(hiddenId).value = tag.dataset.value;
  });
}

// --- 액션 버튼 (캡처/요소선택) ---
function bindActionButtons() {
  getEl('btn-area-capture').addEventListener('click', () => startCapture('content.js'));
  getEl('btn-element-inspect').addEventListener('click', () => startCapture('content-inspector.js'));
  getEl('btn-clear-element').addEventListener('click', hideElementInfo);
  getEl('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

async function startCapture(scriptFile) {
  try {
    // 로그인 체크
    const loggedIn = await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        resolve(!!t && !chrome.runtime.lastError);
      });
    });
    if (!loggedIn) {
      showStatus('먼저 Google 로그인이 필요합니다.', 'error');
      return;
    }
    // 현재 활성 탭에 스크립트 주입
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url) {
      showStatus('탭을 찾을 수 없습니다.', 'error');
      return;
    }
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      showStatus('이 페이지에서는 사용할 수 없습니다.', 'error');
      return;
    }
    // background에 tabId 포함하여 전송
    const action = scriptFile === 'content.js' ? 'start-area-capture' : 'start-element-inspect';
    const result = await sendMessage({ action, tabId: tab.id });
    if (!result || !result.ok) {
      showStatus(result?.error || '시작할 수 없습니다.', 'error');
    }
  } catch (err) {
    showStatus('실패: ' + err.message, 'error');
  }
}

// --- 키보드 단축키 ---
function bindKeyboardShortcut() {
  getEl('qa-form').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      getEl('qa-form').requestSubmit();
    }
  });
}

// --- 폼 제출 ---
function bindFormSubmit() {
  getEl('qa-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm().catch((err) => {
      showStatus(err.message, 'error');
      setSubmitLoading(false);
    });
  });
}

async function submitForm() {
  setSubmitLoading(true);
  hideStatus();
  const formData = {
    category: getEl('category').value,
    severity: getEl('severity').value,
    assignee: getEl('assignee').value,
    comment: getEl('comment').value,
    reproSteps: getEl('repro-steps').value,
  };
  await chrome.storage.sync.set({
    lastCategory: formData.category,
    lastSeverity: formData.severity,
  });
  const response = await sendMessage({ action: 'submit-qa', formData });
  if (response && response.success) {
    showStatus('QA 이슈가 성공적으로 기록되었습니다!', 'success');
    getEl('btn-text').textContent = '완료!';
    resetPreview();
    setTimeout(() => setSubmitLoading(false), 2000);
  } else {
    throw new Error((response && response.error) || '제출에 실패했습니다.');
  }
}

function setSubmitLoading(loading) {
  getEl('btn-submit').disabled = loading;
  getEl('btn-text').textContent = loading ? '제출 중...' : '제출하기';
  const loader = getEl('btn-loader');
  if (loader) loader.classList.toggle('hidden', !loading);
}

// --- 스토리지 변경 감지로 자동 갱신 ---
function listenForUpdates() {
  // storage 변경 감지 (캡처 완료 시 background가 저장)
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.captureData) loadCaptureData();
  });
  // background 메시지도 수신 (fallback)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'capture-updated') loadCaptureData();
  });
}

// --- 상태 메시지 ---
function showStatus(message, type) {
  const el = getEl('status-message');
  el.textContent = message;
  el.className = 'status-message ' + type;
  el.classList.remove('hidden');
}

function hideStatus() {
  getEl('status-message').classList.add('hidden');
}

// --- 유틸 ---
function getEl(id) { return document.getElementById(id); }
function truncate(str, max) { return str.length <= max ? str : str.slice(0, max) + '...'; }

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}
