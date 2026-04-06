// QA Capture - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('qa-form');
  const previewImg = document.getElementById('preview-image');
  const previewEmpty = document.getElementById('preview-empty');
  const envInfoSection = document.getElementById('env-info');
  const envContent = document.getElementById('env-content');
  const envToggle = document.getElementById('env-toggle');
  const envDetails = document.getElementById('env-details');
  const btnSubmit = document.getElementById('btn-submit');
  const btnText = document.getElementById('btn-text');
  const btnLoader = document.getElementById('btn-loader');
  const statusMessage = document.getElementById('status-message');
  const btnSettings = document.getElementById('btn-settings');

  let captureData = null;

  // --- 설정 확인 ---
  const settings = await chrome.storage.sync.get(['spreadsheetId', 'driveFolderId']);
  if (!settings.spreadsheetId || !settings.driveFolderId) {
    showStatus('먼저 설정에서 프로젝트를 연결해주세요.', 'error');
    btnSettings.style.animation = 'pulse 1s ease infinite';
    btnSubmit.disabled = true;
  }

  // --- 캡처 데이터 로드 ---
  try {
    const stored = await chrome.storage.session.get('captureData');
    captureData = stored.captureData;
  } catch (e) {
    // background에서 직접 가져오기
    captureData = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'get-capture-data' }, resolve);
    });
  }

  if (captureData && captureData.screenshot) {
    previewImg.src = captureData.screenshot;
    previewImg.classList.add('visible');
    previewEmpty.style.display = 'none';

    // 환경 정보 표시
    if (captureData.envInfo) {
      envInfoSection.style.display = 'block';
      const env = captureData.envInfo;
      const items = [
        { label: '브라우저', value: env.browser },
        { label: 'OS', value: env.os },
        { label: '해상도', value: env.screenResolution },
        { label: '뷰포트', value: env.viewport },
        { label: '시간대', value: env.timezone },
        { label: '언어', value: env.language },
      ].filter((item) => item.value);

      envContent.textContent = '';
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'env-item';
        const lbl = document.createElement('span');
        lbl.className = 'label';
        lbl.textContent = item.label;
        const val = document.createElement('span');
        val.textContent = item.value;
        row.append(lbl, val);
        envContent.appendChild(row);
      });
    }
  }

  // --- 담당자: 로그인된 이메일로 기본 입력 ---
  const defaults = await chrome.storage.sync.get(['defaultAssignee', 'lastCategory', 'lastSeverity']);
  if (defaults.defaultAssignee) {
    document.getElementById('assignee').value = defaults.defaultAssignee;
  } else {
    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => {
          if (chrome.runtime.lastError || !t) reject();
          else resolve(t);
        });
      });
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const user = await res.json();
        if (user.email) {
          document.getElementById('assignee').value = user.email;
        }
      }
    } catch { /* 로그인 안 되어 있으면 무시 */ }
  }
  if (defaults.lastCategory) {
    document.getElementById('category').value = defaults.lastCategory;
  }
  if (defaults.lastSeverity) {
    document.getElementById('severity').value = defaults.lastSeverity;
  }

  // --- 환경 정보 토글 ---
  envToggle.addEventListener('click', () => {
    const isHidden = envDetails.style.display === 'none';
    envDetails.style.display = isHidden ? 'block' : 'none';
    envToggle.querySelector('.chevron').classList.toggle('open', isHidden);
  });

  // --- 설정 페이지 열기 ---
  btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // --- Ctrl+Enter 제출 ---
  form.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // --- 폼 제출 ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!captureData || !captureData.screenshot) {
      showStatus('먼저 Alt+Shift+Q로 캡처해주세요.', 'error');
      return;
    }

    // UI 상태: 로딩
    btnSubmit.disabled = true;
    btnText.textContent = '제출 중...';
    btnLoader.style.display = 'block';
    statusMessage.style.display = 'none';

    const formData = {
      category: document.getElementById('category').value,
      severity: document.getElementById('severity').value,
      assignee: document.getElementById('assignee').value,
      comment: document.getElementById('comment').value,
      reproSteps: document.getElementById('repro-steps').value,
    };

    // 마지막 사용 값 저장
    await chrome.storage.sync.set({
      lastCategory: formData.category,
      lastSeverity: formData.severity,
    });

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'submit-qa', formData },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response?.error || '알 수 없는 오류'));
            }
          }
        );
      });

      showStatus('QA 이슈가 성공적으로 기록되었습니다!', 'success');
      btnText.textContent = '완료!';

      // 2초 후 창 닫기
      setTimeout(() => window.close(), 2000);
    } catch (err) {
      showStatus(err.message, 'error');
      btnSubmit.disabled = false;
      btnText.textContent = '제출하기';
      btnLoader.style.display = 'none';
    }
  });

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    btnLoader.style.display = 'none';
  }
});
