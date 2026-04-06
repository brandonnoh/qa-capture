// QA Capture - Background Service Worker

// --- 상태 관리 ---
let captureData = null; // { screenshot, selection, envInfo, pageUrl, pageTitle }

// --- 단축키 리스너 ---
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-qa') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      console.warn('이 페이지에서는 캡처할 수 없습니다.');
      return;
    }
    // content.js 주입
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  }
});

// --- 메시지 핸들러 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 팝업 메뉴에서 캡처 시작
  if (message.action === 'start-capture') {
    const tabId = message.tabId;
    if (tabId) {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      }).catch((err) => console.error('content.js 주입 실패:', err));
    }
    return false;
  }

  if (message.action === 'area-selected') {
    handleAreaSelected(message, sender);
    return false;
  }

  if (message.action === 'get-capture-data') {
    sendResponse(captureData);
    return false;
  }

  if (message.action === 'submit-qa') {
    handleSubmitQA(message.formData)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }

  if (message.action === 'crop-complete') {
    handleCropComplete(message);
    return false;
  }
});

// --- 영역 선택 완료 처리 ---
async function handleAreaSelected(message, sender) {
  try {
    const tabId = sender.tab.id;

    // 현재 탭 스크린샷 캡처
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
    });

    // offscreen document에서 크롭 수행
    const croppedDataUrl = await cropImage(screenshotDataUrl, message.selection);

    // 캡처 데이터 저장
    captureData = {
      screenshot: croppedDataUrl,
      selection: message.selection,
      envInfo: message.envInfo,
      pageUrl: message.pageUrl,
      pageTitle: message.pageTitle,
      timestamp: new Date().toISOString(),
    };

    // session storage에도 저장 (팝업에서 접근용)
    await chrome.storage.session.set({ captureData });

    // QA 폼 팝업 창 열기
    chrome.windows.create({
      url: 'popup/popup.html',
      type: 'popup',
      width: 520,
      height: 720,
      focused: true,
    });
  } catch (err) {
    console.error('캡처 처리 실패:', err);
  }
}

// --- 이미지 크롭 (OffscreenDocument 사용) ---
async function cropImage(dataUrl, selection) {
  // offscreen document 생성 (이미 있으면 재사용)
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CANVAS'],
      justification: '스크린샷을 선택 영역으로 크롭',
    });
  } catch (e) {
    // 이미 존재하는 경우 무시
    if (!e.message.includes('Only a single offscreen')) {
      throw e;
    }
  }

  return new Promise((resolve, reject) => {
    const handler = (msg) => {
      if (msg.action === 'crop-complete') {
        chrome.runtime.onMessage.removeListener(handler);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg.croppedDataUrl);
        }
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    // offscreen document에 크롭 요청
    chrome.runtime.sendMessage({
      action: 'crop-image',
      dataUrl,
      selection,
    });
  });
}

// --- QA 제출 처리 ---
async function handleSubmitQA(formData) {
  const settings = await chrome.storage.sync.get([
    'spreadsheetId',
    'driveFolderId',
    'sheetName',
  ]);

  if (!settings.spreadsheetId || !settings.driveFolderId) {
    throw new Error('설정에서 스프레드시트 ID와 Drive 폴더 ID를 먼저 입력해주세요.');
  }

  const sheetName = settings.sheetName || 'Sheet1';

  // OAuth 토큰 가져오기
  const token = await getAuthToken();

  // 1. Google Drive에 이미지 업로드
  const imageBlob = dataUrlToBlob(captureData.screenshot);
  const fileName = `QA_${Date.now()}.png`;
  const driveResult = await uploadToDrive(imageBlob, fileName, settings.driveFolderId, token);

  // 2. 파일 공개 설정
  await makeFilePublic(driveResult.id, token);

  // 3. Google Sheets에 행 추가
  const webViewLink = `https://drive.google.com/file/d/${driveResult.id}/view`;
  const rowData = buildRowData(formData, captureData, webViewLink);
  await appendToSheet(settings.spreadsheetId, sheetName, rowData, token);

  // 캡처 데이터 초기화
  captureData = null;
  await chrome.storage.session.remove('captureData');

  return { success: true, driveLink: webViewLink };
}

// --- OAuth 토큰 ---
function getAuthToken(interactive = true) {
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

// 토큰 갱신 (401 에러 시)
async function refreshToken(oldToken) {
  return new Promise((resolve, reject) => {
    chrome.identity.removeCachedAuthToken({ token: oldToken }, () => {
      chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(newToken);
        }
      });
    });
  });
}

// --- Google Drive 업로드 ---
async function uploadToDrive(blob, fileName, folderId, token) {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'image/png',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob);

  let response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );

  // 토큰 만료 시 갱신 후 재시도
  if (response.status === 401) {
    const newToken = await refreshToken(token);
    response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${newToken}` },
        body: form,
      }
    );
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Drive 업로드 실패: ${err}`);
  }

  return response.json();
}

// --- Drive 파일 공개 설정 ---
async function makeFilePublic(fileId, token) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    }
  );

  if (!response.ok) {
    console.warn('파일 공개 설정 실패 (계속 진행):', await response.text());
  }
}

// --- Google Sheets 행 추가 ---
async function appendToSheet(spreadsheetId, sheetName, rowData, token) {
  const range = `${sheetName}!A:P`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [rowData],
    }),
  });

  if (response.status === 401) {
    const newToken = await refreshToken(token);
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${newToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [rowData],
      }),
    });
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Sheets 저장 실패: ${err}`);
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

  return [
    '=ROW()-1',                                               // A: 번호
    dateStr,                                                   // B: 날짜/시간
    captureData.pageUrl || '',                                 // C: 페이지URL
    formData.category || '',                                   // D: 분류
    formData.comment || '',                                    // E: 코멘트
    `=HYPERLINK("${webViewLink}", "스크린샷 보기")`,           // F: 이미지링크
    'Open',                                                    // G: 상태
    formData.assignee || '',                                   // H: 담당자
    formData.severity || '',                                   // I: 심각도
    formData.reproSteps || '',                                 // J: 재현단계
    env.browser || '',                                         // K: 브라우저
    env.os || '',                                              // L: OS/기기
    env.screenResolution || '',                                // M: 화면해상도
    env.viewport || '',                                        // N: 뷰포트
    env.timezone || '',                                        // O: 시간대
    env.language || '',                                        // P: 언어
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
