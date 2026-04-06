// QA Capture - 팝업 메뉴 스크립트

const authLoggedOut = document.getElementById('auth-logged-out');
const authLoggedIn = document.getElementById('auth-logged-in');
const authAvatar = document.getElementById('auth-avatar');
const authEmail = document.getElementById('auth-email');
const btnLogin = document.getElementById('btn-login');
const popupToast = document.getElementById('popup-toast');

function showToast(msg) {
  if (!popupToast) return;
  popupToast.textContent = msg;
  popupToast.classList.remove('hidden');
  setTimeout(() => popupToast.classList.add('hidden'), 3000);
}

async function checkAuth() {
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError || !t) {
          reject(new Error(chrome.runtime.lastError?.message || 'No token'));
        } else {
          resolve(t);
        }
      });
    });
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
    const user = await res.json();
    authLoggedOut.classList.add('hidden');
    authLoggedIn.classList.remove('hidden');
    authEmail.textContent = user.email || '';
    if (user.picture) {
      authAvatar.style.backgroundImage = `url("${user.picture.replace(/["\\]/g, '')}")`;
    }
  } catch {
    authLoggedOut.classList.remove('hidden');
    authLoggedIn.classList.add('hidden');
  }
}

btnLogin.addEventListener('click', () => {
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (!chrome.runtime.lastError && token) {
      checkAuth();
    } else {
      showToast('로그인에 실패했습니다.');
    }
  });
});

document.getElementById('btn-capture').addEventListener('click', async () => {
  try {
    // 로그인 체크
    const loggedIn = await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        resolve(!!t && !chrome.runtime.lastError);
      });
    });
    if (!loggedIn) {
      showToast('먼저 Google 로그인이 필요합니다.');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      showToast('탭을 찾을 수 없습니다.');
      return;
    }
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      showToast('이 페이지에서는 캡처할 수 없습니다.');
      return;
    }
    const result = await chrome.runtime.sendMessage({ action: 'start-capture', tabId: tab.id });
    if (result?.ok) {
      window.close();
    } else {
      showToast(result?.error || '캡처를 시작할 수 없습니다.');
    }
  } catch (err) {
    showToast('캡처 시작 실패: ' + err.message);
  }
});

// 요소 선택
document.getElementById('btn-inspect').addEventListener('click', async () => {
  try {
    const loggedIn = await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        resolve(!!t && !chrome.runtime.lastError);
      });
    });
    if (!loggedIn) {
      showToast('먼저 Google 로그인이 필요합니다.');
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) { showToast('탭을 찾을 수 없습니다.'); return; }
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      showToast('이 페이지에서는 사용할 수 없습니다.');
      return;
    }
    const result = await chrome.runtime.sendMessage({ action: 'start-element-inspect', tabId: tab.id });
    if (result?.ok) {
      window.close();
    } else {
      showToast(result?.error || '요소 선택을 시작할 수 없습니다.');
    }
  } catch (err) {
    showToast('요소 선택 실패: ' + err.message);
  }
});

document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

(async () => {
  try {
    await checkAuth();
  } catch {
    // 인증 확인 실패해도 상태바는 업데이트
  }
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
