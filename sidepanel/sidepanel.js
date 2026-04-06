// QA Capture - Side Panel Script
document.addEventListener('DOMContentLoaded', () => {
  initPanel().catch((err) => showStatus(err.message, 'error'));
});

async function initPanel() {
  await checkSettings();
  await loadCaptureData();
  await loadElementInfo();
  await fillAssignee();
  await restoreSavedTags();
  bindTagGroups();
  bindActionButtons();
  bindEnvToggle();
  bindFormSubmit();
  bindKeyboardShortcut();
  listenForBackgroundMessages();
}

// --- 설정 확인 ---
async function checkSettings() {
  const settings = await chrome.storage.sync.get(['spreadsheetId', 'driveFolderId']);
  if (!settings.spreadsheetId || !settings.driveFolderId) {
    showStatus('먼저 설정에서 프로젝트를 연결해주세요.', 'error');
    getEl('btn-submit').disabled = true;
  }
}

// --- 캡처 데이터 로드 ---
async function loadCaptureData() {
  let captureData = null;
  try {
    const stored = await chrome.storage.session.get('captureData');
    captureData = stored.captureData;
  } catch (e) {
    captureData = await sendMessage({ action: 'get-capture-data' });
  }
  if (captureData && captureData.screenshot) {
    displayScreenshot(captureData.screenshot);
    displayEnvInfo(captureData.envInfo);
  }
}

// --- 스크린샷 표시 ---
function displayScreenshot(dataUrl) {
  const img = getEl('preview-image');
  img.src = dataUrl;
  img.classList.add('visible');
  getEl('preview-empty').classList.add('hidden');
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
  ].filter((item) => item.value);
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
async function loadElementInfo() {
  const stored = await chrome.storage.session.get('elementInfo');
  if (stored.elementInfo) displayElementInfo(stored.elementInfo);
}

function displayElementInfo(info) {
  if (!info) return;
  getEl('el-tag').textContent = info.tagName || '';
  getEl('el-id').textContent = info.id || '(없음)';
  getEl('el-class').textContent = info.className || '(없음)';
  getEl('el-text').textContent = truncate(info.textContent || '', 80);
  getEl('el-selector').textContent = info.selector || '';
  getEl('element-info').classList.remove('hidden');
}

function clearElementInfo() {
  getEl('element-info').classList.add('hidden');
  chrome.storage.session.remove('elementInfo').catch((err) => {
    showStatus('요소 정보 초기화 실패: ' + err.message, 'error');
  });
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
        if (chrome.runtime.lastError || !t) resolve(null);
        else resolve(t);
      });
    });
    if (!token) return;
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return;
    const user = await res.json();
    if (user.email) getEl('assignee').value = user.email;
  } catch (e) {
    // 로그인 안 된 상태 — 빈칸 유지
  }
}

// --- 저장된 태그 복원 ---
async function restoreSavedTags() {
  const saved = await chrome.storage.sync.get(['lastCategory', 'lastSeverity']);
  if (saved.lastCategory) activateTag('category-tags', 'category', saved.lastCategory);
  if (saved.lastSeverity) activateTag('severity-tags', 'severity', saved.lastSeverity);
}

function activateTag(groupId, hiddenId, value) {
  const group = getEl(groupId);
  const match = group.querySelector('.tag[data-value="' + value + '"]');
  if (match) {
    match.classList.add('active');
    getEl(hiddenId).value = value;
  }
}

// --- 태그 그룹 클릭 ---
function bindTagGroups() {
  setupTagGroup('category-tags', 'category');
  setupTagGroup('severity-tags', 'severity');
}

function setupTagGroup(groupId, hiddenId) {
  const group = getEl(groupId);
  group.addEventListener('click', (e) => {
    const tag = e.target.closest('.tag');
    if (!tag) return;
    group.querySelectorAll('.tag').forEach((t) => t.classList.remove('active'));
    tag.classList.add('active');
    getEl(hiddenId).value = tag.dataset.value;
  });
}

// --- 액션 버튼 ---
function bindActionButtons() {
  getEl('btn-area-capture').addEventListener('click', () => {
    sendMessage({ action: 'start-area-capture' }).catch((err) => {
      showStatus('캡처 시작 실패: ' + err.message, 'error');
    });
  });
  getEl('btn-element-inspect').addEventListener('click', () => {
    sendMessage({ action: 'start-element-inspect' }).catch((err) => {
      showStatus('요소 선택 시작 실패: ' + err.message, 'error');
    });
  });
  getEl('btn-clear-element').addEventListener('click', clearElementInfo);
  getEl('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

// --- 환경 정보 토글 ---
function bindEnvToggle() {
  getEl('env-toggle').addEventListener('click', () => {
    const details = getEl('env-details');
    const isHidden = details.classList.contains('hidden');
    details.classList.toggle('hidden', !isHidden);
    getEl('env-toggle').querySelector('.chevron').classList.toggle('open', isHidden);
  });
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
    showStatus('QA 이슈가 성공적으로 기록되었습니다.', 'success');
    getEl('btn-text').textContent = '완료';
    getEl('qa-form').reset();
  } else {
    throw new Error((response && response.error) || '제출에 실패했습니다.');
  }
}

function setSubmitLoading(loading) {
  getEl('btn-submit').disabled = loading;
  getEl('btn-text').textContent = loading ? '제출 중...' : '제출하기';
  getEl('btn-loader').classList.toggle('hidden', !loading);
}

// --- 백그라운드 메시지 수신 ---
function listenForBackgroundMessages() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'capture-complete' && message.screenshot) {
      displayScreenshot(message.screenshot);
      if (message.envInfo) displayEnvInfo(message.envInfo);
    }
    if (message.action === 'element-selected' && message.elementInfo) {
      displayElementInfo(message.elementInfo);
    }
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
function getEl(id) {
  return document.getElementById(id);
}

function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max) + '...';
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
