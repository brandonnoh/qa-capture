// QA Capture - 팝업 메뉴 스크립트

const authLoggedOut = document.getElementById('auth-logged-out');
const authLoggedIn = document.getElementById('auth-logged-in');
const authAvatar = document.getElementById('auth-avatar');
const authEmail = document.getElementById('auth-email');
const btnLogin = document.getElementById('btn-login');

// 로그인 상태 확인
async function checkAuth() {
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError || !token) reject();
        else resolve(token);
      });
    });
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const user = await res.json();
    authLoggedOut.classList.add('hidden');
    authLoggedIn.classList.remove('hidden');
    authEmail.textContent = user.email;
    if (user.picture) {
      authAvatar.style.backgroundImage = `url(${user.picture})`;
    }
  } catch {
    authLoggedOut.classList.remove('hidden');
    authLoggedIn.classList.add('hidden');
  }
}

// 로그인 버튼
btnLogin.addEventListener('click', () => {
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (!chrome.runtime.lastError && token) {
      checkAuth();
    }
  });
});

// 캡처 시작 - 탭 정보를 먼저 확보한 뒤 메시지 전송
document.getElementById('btn-capture').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) {
      console.error('활성 탭을 찾을 수 없습니다.');
      return;
    }
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      console.warn('이 페이지에서는 캡처할 수 없습니다.');
      return;
    }
    const tabId = tab.id;
    await chrome.runtime.sendMessage({ action: 'start-capture', tabId });
    window.close();
  } catch (err) {
    console.error('캡처 시작 실패:', err);
  }
});

// 설정
document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// 상태 확인
(async () => {
  await checkAuth();
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const settings = await chrome.storage.sync.get(['spreadsheetId', 'driveFolderId']);
  if (settings.spreadsheetId && settings.driveFolderId) {
    dot.classList.add('active');
    text.textContent = '연결됨';
  } else {
    text.textContent = '설정 필요';
  }
})();
