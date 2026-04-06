// QA Capture - 설정 페이지 스크립트

document.addEventListener('DOMContentLoaded', async () => {
  // --- 요소 참조 ---
  const statusMessage = document.getElementById('status-message');

  // Step 1: 인증
  const btnAuth = document.getElementById('btn-auth');
  const btnLogout = document.getElementById('btn-logout');
  const accountEmail = document.getElementById('account-email');
  const accountStatus = document.getElementById('account-status');
  const accountAvatar = document.getElementById('account-avatar');

  // Step 2: 역할 선택
  const sectionRole = document.getElementById('section-role');
  const btnRoleAdmin = document.getElementById('btn-role-admin');
  const btnRoleMember = document.getElementById('btn-role-member');

  // 관리자 플로우
  const adminFlow = document.getElementById('admin-flow');
  const settingsForm = document.getElementById('settings-form');
  const spreadsheetUrlInput = document.getElementById('spreadsheet-url');
  const driveFolderUrlInput = document.getElementById('drive-folder-url');
  const spreadsheetIdPreview = document.getElementById('spreadsheet-id-preview');
  const spreadsheetIdValue = document.getElementById('spreadsheet-id-value');
  const driveFolderIdPreview = document.getElementById('drive-folder-id-preview');
  const driveFolderIdValue = document.getElementById('drive-folder-id-value');
  const btnInitSheet = document.getElementById('btn-init-sheet');
  const sectionInvite = document.getElementById('section-invite');
  const inviteCodeDisplay = document.getElementById('invite-code-display');
  const btnCopyInvite = document.getElementById('btn-copy-invite');

  // 팀원 플로우
  const memberFlow = document.getElementById('member-flow');
  const inviteCodeInput = document.getElementById('invite-code-input');
  const btnJoin = document.getElementById('btn-join');
  const joinResult = document.getElementById('join-result');
  const sectionMemberSettings = document.getElementById('section-member-settings');
  const memberAssignee = document.getElementById('member-assignee');
  const btnMemberSave = document.getElementById('btn-member-save');

  // 설정 완료 상태
  const sectionConfigured = document.getElementById('section-configured');
  const configuredDesc = document.getElementById('configured-desc');
  const configuredDetails = document.getElementById('configured-details');
  const btnReconfigure = document.getElementById('btn-reconfigure');
  const btnReset = document.getElementById('btn-reset');

  // =============================================
  // 초대코드 인코딩/디코딩
  // =============================================
  function generateInviteCode(config) {
    const json = JSON.stringify({
      s: config.spreadsheetId,   // 시트 ID
      f: config.driveFolderId,   // 폴더 ID
      n: config.sheetName,       // 시트 이름
      v: 1,                      // 버전
    });
    // base64 → URL-safe로 변환 + 'QA-' 접두사
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return 'QA-' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeInviteCode(code) {
    try {
      code = code.trim();
      if (code.startsWith('QA-')) code = code.slice(3);
      // URL-safe base64 → 일반 base64 복원
      let b64 = code.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const json = decodeURIComponent(escape(atob(b64)));
      const data = JSON.parse(json);
      if (!data.s || !data.f) throw new Error('invalid');
      return {
        spreadsheetId: data.s,
        driveFolderId: data.f,
        sheetName: data.n || 'Sheet1',
      };
    } catch {
      return null;
    }
  }

  // =============================================
  // URL → ID 추출
  // =============================================
  function extractSpreadsheetId(input) {
    input = input.trim();
    const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9_-]+$/.test(input) && input.length > 10) return input;
    return null;
  }

  function extractDriveFolderId(input) {
    input = input.trim();
    const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9_-]+$/.test(input) && input.length > 10) return input;
    return null;
  }

  function updateIdPreview(input, extractFn, previewEl, valueEl) {
    const raw = input.value.trim();
    if (!raw) {
      previewEl.style.display = 'none';
      return null;
    }
    const id = extractFn(raw);
    if (id) {
      previewEl.style.display = 'flex';
      previewEl.classList.remove('error');
      valueEl.textContent = id;
      previewEl.querySelector('.id-label').textContent = '추출된 ID:';
    } else {
      previewEl.style.display = 'flex';
      previewEl.classList.add('error');
      valueEl.textContent = 'URL 형식을 확인해주세요';
      previewEl.querySelector('.id-label').textContent = '오류:';
    }
    return id;
  }

  // 실시간 URL 파싱
  spreadsheetUrlInput.addEventListener('input', () => {
    updateIdPreview(spreadsheetUrlInput, extractSpreadsheetId, spreadsheetIdPreview, spreadsheetIdValue);
  });
  driveFolderUrlInput.addEventListener('input', () => {
    updateIdPreview(driveFolderUrlInput, extractDriveFolderId, driveFolderIdPreview, driveFolderIdValue);
  });

  // =============================================
  // 인증 처리
  // =============================================
  let isLoggedIn = false;

  async function checkAuthStatus() {
    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => {
          if (chrome.runtime.lastError || !t) reject(new Error('Not authenticated'));
          else resolve(t);
        });
      });

      const response = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) {
        // 토큰이 무효화됨 — 캐시에서 제거
        await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
        throw new Error('Token invalid');
      }
      const userInfo = await response.json();

      accountEmail.textContent = userInfo.email || '';
      accountStatus.textContent = '연결됨';
      accountStatus.classList.add('connected');
      btnAuth.style.display = 'none';

      if (userInfo.picture) {
        accountAvatar.style.backgroundImage = `url(${userInfo.picture})`;
        accountAvatar.style.display = 'block';
      }

      isLoggedIn = true;
      btnLogout.style.display = 'inline-block';
      return true;
    } catch {
      accountEmail.textContent = '로그인이 필요합니다';
      accountStatus.textContent = '';
      accountStatus.classList.remove('connected');
      accountAvatar.style.display = 'none';
      btnAuth.textContent = 'Google 로그인';
      btnAuth.style.display = 'inline-block';
      btnLogout.style.display = 'none';
      isLoggedIn = false;
      return false;
    }
  }

  btnAuth.addEventListener('click', async () => {
    if (isLoggedIn) return;
    // 무효 토큰이 캐시에 남아있을 수 있으므로 먼저 전부 제거
    await chrome.identity.clearAllCachedAuthTokens();
    chrome.identity.getAuthToken({
      interactive: true,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
    }, async (token) => {
      if (chrome.runtime.lastError) {
        showStatus('로그인 실패: ' + chrome.runtime.lastError.message, 'error');
      } else {
        await checkAuthStatus();
        updateView();
      }
    });
  });

  // --- 로그아웃 ---
  btnLogout.addEventListener('click', async () => {
    try {
      const token = await new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => resolve(t || null));
      });
      if (token) {
        // 토큰 무효화
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
        await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
      }
      await chrome.identity.clearAllCachedAuthTokens();
      await checkAuthStatus();
      updateView();
      showStatus('로그아웃되었습니다.', 'success');
    } catch (err) {
      showStatus('로그아웃 실패: ' + err.message, 'error');
    }
  });

  // =============================================
  // 화면 상태 관리
  // =============================================
  async function updateView() {
    const settings = await chrome.storage.sync.get([
      'spreadsheetId', 'driveFolderId', 'sheetName',
      'spreadsheetUrl', 'driveFolderUrl', 'defaultAssignee', 'role',
    ]);

    const isConfigured = settings.spreadsheetId && settings.driveFolderId;

    if (!isLoggedIn) {
      // 로그인 안 됨: Step 1만 보이기
      sectionRole.style.display = 'none';
      adminFlow.style.display = 'none';
      memberFlow.style.display = 'none';
      sectionConfigured.style.display = 'none';
      return;
    }

    if (isConfigured) {
      // 이미 설정 완료
      sectionRole.style.display = 'none';
      adminFlow.style.display = 'none';
      memberFlow.style.display = 'none';
      sectionConfigured.style.display = 'block';

      const role = settings.role === 'admin' ? '관리자' : '팀원';
      configuredDesc.textContent = `${role}로 설정되어 있습니다. Alt+Shift+Q로 캡처를 시작하세요.`;

      // XSS 방지: textContent로 안전하게 렌더링
      configuredDetails.textContent = '';
      const detailRows = [
        ['역할', role],
        ['시트 ID', settings.spreadsheetId],
        ['폴더 ID', settings.driveFolderId],
        ['시트명', settings.sheetName || 'Sheet1'],
        ['담당자', settings.defaultAssignee || '(미설정)'],
      ];

      if (settings.role === 'admin') {
        const code = generateInviteCode({
          spreadsheetId: settings.spreadsheetId,
          driveFolderId: settings.driveFolderId,
          sheetName: settings.sheetName || 'Sheet1',
        });
        detailRows.push(['초대코드', code]);
      }

      detailRows.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'detail-row';
        const lbl = document.createElement('span');
        lbl.className = 'detail-label';
        lbl.textContent = label;
        const val = document.createElement('span');
        val.className = 'detail-value';
        val.textContent = value;
        row.append(lbl, val);
        configuredDetails.appendChild(row);
      });
      return;
    }

    // 설정 안 됨: 역할 선택 화면
    sectionRole.style.display = 'block';
    adminFlow.style.display = 'none';
    memberFlow.style.display = 'none';
    sectionConfigured.style.display = 'none';
  }

  // =============================================
  // 역할 선택
  // =============================================
  btnRoleAdmin.addEventListener('click', () => {
    sectionRole.style.display = 'none';
    adminFlow.style.display = 'block';
    memberFlow.style.display = 'none';
  });

  btnRoleMember.addEventListener('click', () => {
    sectionRole.style.display = 'none';
    adminFlow.style.display = 'none';
    memberFlow.style.display = 'block';
  });

  // =============================================
  // 관리자: 설정 저장
  // =============================================
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const spreadsheetId = extractSpreadsheetId(spreadsheetUrlInput.value);
    const driveFolderId = extractDriveFolderId(driveFolderUrlInput.value);

    if (!spreadsheetId) {
      showStatus('Google Sheets 주소가 올바르지 않습니다.', 'error');
      return;
    }
    if (!driveFolderId) {
      showStatus('Google Drive 폴더 주소가 올바르지 않습니다.', 'error');
      return;
    }

    // 스프레드시트에서 첫 번째 시트 탭 이름 자동 가져오기
    let sheetName = 'Sheet1';
    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (t) => {
          if (chrome.runtime.lastError || !t) reject(new Error(chrome.runtime.lastError?.message || 'No token'));
          else resolve(t);
        });
      });
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        const firstSheet = data.sheets?.[0]?.properties?.title;
        if (firstSheet) sheetName = firstSheet;
      }
    } catch {
      // API 실패 시 Sheet1 기본값 사용
    }

    await chrome.storage.sync.set({
      spreadsheetId,
      driveFolderId,
      sheetName,
      spreadsheetUrl: spreadsheetUrlInput.value.trim(),
      driveFolderUrl: driveFolderUrlInput.value.trim(),
      role: 'admin',
    });

    // 초대코드 표시
    const inviteCode = generateInviteCode({ spreadsheetId, driveFolderId, sheetName });
    inviteCodeDisplay.textContent = inviteCode;
    sectionInvite.style.display = 'block';

    showStatus('설정이 저장되었습니다!', 'success');
  });

  // 초대코드 복사
  btnCopyInvite.addEventListener('click', async () => {
    const code = inviteCodeDisplay.textContent;
    await navigator.clipboard.writeText(code);
    btnCopyInvite.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => {
      btnCopyInvite.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    }, 2000);
  });

  // =============================================
  // 팀원: 초대코드로 참여
  // =============================================
  btnJoin.addEventListener('click', async () => {
    const code = inviteCodeInput.value.trim();
    if (!code) {
      showJoinResult('초대코드를 입력해주세요.', 'error');
      return;
    }

    const decoded = decodeInviteCode(code);
    if (!decoded) {
      showJoinResult('유효하지 않은 초대코드입니다. 코드를 다시 확인해주세요.', 'error');
      return;
    }

    // 연결 테스트: 시트에 접근 가능한지 확인
    btnJoin.disabled = true;
    btnJoin.textContent = '확인 중...';

    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({
          interactive: true,
          scopes: [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
        }, (token) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(token);
        });
      });

      // 시트 접근 테스트
      const sheetRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${decoded.spreadsheetId}?fields=properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!sheetRes.ok) {
        if (sheetRes.status === 404) {
          throw new Error('스프레드시트를 찾을 수 없습니다.');
        } else if (sheetRes.status === 403) {
          throw new Error('스프레드시트에 접근 권한이 없습니다. 관리자에게 공유를 요청하세요.');
        }
        throw new Error('스프레드시트 연결에 실패했습니다.');
      }

      const sheetData = await sheetRes.json();
      const sheetTitle = sheetData.properties?.title || '';

      // 폴더 접근 테스트 (공유 드라이브 지원)
      const folderRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${decoded.driveFolderId}?fields=name&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!folderRes.ok) {
        if (folderRes.status === 404) {
          throw new Error('Drive 폴더를 찾을 수 없습니다.');
        } else if (folderRes.status === 403) {
          throw new Error('Drive 폴더에 접근 권한이 없습니다. 관리자에게 공유를 요청하세요.');
        }
        throw new Error('Drive 폴더 연결에 실패했습니다.');
      }

      const folderData = await folderRes.json();

      // 설정 저장
      await chrome.storage.sync.set({
        spreadsheetId: decoded.spreadsheetId,
        driveFolderId: decoded.driveFolderId,
        sheetName: decoded.sheetName,
        role: 'member',
      });

      showJoinResult(
        `참여 완료! 시트: "${sheetTitle}" / 폴더: "${folderData.name}"`,
        'success'
      );

      // 개인 설정 섹션 표시
      sectionMemberSettings.style.display = 'block';

    } catch (err) {
      showJoinResult(err.message, 'error');
    } finally {
      btnJoin.disabled = false;
      btnJoin.textContent = '참여하기';
    }
  });

  // 팀원 개인 설정 저장
  btnMemberSave.addEventListener('click', async () => {
    await chrome.storage.sync.set({
      defaultAssignee: memberAssignee.value.trim(),
    });
    showStatus('저장되었습니다!', 'success');
    updateView();
  });

  function showJoinResult(message, type) {
    joinResult.textContent = message;
    joinResult.className = type;
    joinResult.style.display = 'block';
  }

  // =============================================
  // 설정 완료 화면 액션
  // =============================================
  btnReconfigure.addEventListener('click', async () => {
    const settings = await chrome.storage.sync.get(['role']);
    sectionConfigured.style.display = 'none';
    if (settings.role === 'admin') {
      adminFlow.style.display = 'block';
      // 기존 값 복원
      const s = await chrome.storage.sync.get(['spreadsheetUrl', 'driveFolderUrl', 'sheetName', 'defaultAssignee']);
      spreadsheetUrlInput.value = s.spreadsheetUrl || '';
      driveFolderUrlInput.value = s.driveFolderUrl || '';
      document.getElementById('sheet-name').value = s.sheetName || '';
      document.getElementById('default-assignee').value = s.defaultAssignee || '';
      // 미리보기 업데이트
      if (spreadsheetUrlInput.value) updateIdPreview(spreadsheetUrlInput, extractSpreadsheetId, spreadsheetIdPreview, spreadsheetIdValue);
      if (driveFolderUrlInput.value) updateIdPreview(driveFolderUrlInput, extractDriveFolderId, driveFolderIdPreview, driveFolderIdValue);
    } else {
      memberFlow.style.display = 'block';
      sectionMemberSettings.style.display = 'block';
      const s = await chrome.storage.sync.get(['defaultAssignee']);
      memberAssignee.value = s.defaultAssignee || '';
    }
  });

  btnReset.addEventListener('click', async () => {
    if (!confirm('모든 설정을 초기화하시겠습니까?')) return;
    await chrome.storage.sync.remove([
      'spreadsheetId', 'driveFolderId', 'sheetName',
      'spreadsheetUrl', 'driveFolderUrl', 'defaultAssignee', 'role',
      'lastCategory', 'lastSeverity',
    ]);
    sectionConfigured.style.display = 'none';
    adminFlow.style.display = 'none';
    memberFlow.style.display = 'none';
    updateView();
    showStatus('설정이 초기화되었습니다.', 'success');
  });

  // =============================================
  // 시트 헤더 초기화
  // =============================================
  btnInitSheet.addEventListener('click', async () => {
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrlInput.value);

    if (!spreadsheetId) {
      showStatus('먼저 올바른 스프레드시트 주소를 입력해주세요.', 'error');
      return;
    }

    btnInitSheet.disabled = true;
    btnInitSheet.textContent = '생성 중...';

    // 시트 이름 자동 조회
    let sheetName = 'Sheet1';
    try {
      const token2 = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (t) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      const nameRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
        { headers: { Authorization: `Bearer ${token2}` } }
      );
      if (nameRes.ok) {
        const nameData = await nameRes.json();
        const first = nameData.sheets?.[0]?.properties?.title;
        if (first) sheetName = first;
      }
    } catch { /* 조회 실패 시 Sheet1 기본값 */ }

    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(token);
        });
      });

      const headers = [
        '번호', '날짜/시간', '담당자', '분류', '심각도', '코멘트',
        '재현단계', '이미지링크', '상태', '페이지URL',
        '선택요소', 'CSS선택자', 'XPath',
        '브라우저', 'OS/기기', '화면해상도', '뷰포트', '시간대', '언어',
      ];

      const range = `${sheetName}!A1:S1`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ range, majorDimension: 'ROWS', values: [headers] }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error?.message || '헤더 행 생성에 실패했습니다.');
      }

      // 헤더 스타일링
      const sheetResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const sheetData = await sheetResponse.json();
      const sheet = sheetData.sheets?.find((s) => s.properties.title === sheetName);
      if (!sheet) {
        showStatus('헤더는 생성되었지만 스타일링 실패: 시트 이름을 확인하세요.', 'error');
        return;
      }
      const sheetId = sheet.properties.sheetId;

      // 컬럼별 적정 너비 (px) — 내용에 맞춰 설정, 최대 350
      const colWidths = [
        50,   // A: 번호
        140,  // B: 날짜/시간
        160,  // C: 담당자
        70,   // D: 분류
        70,   // E: 심각도
        300,  // F: 코멘트
        300,  // G: 재현단계
        110,  // H: 이미지링크
        70,   // I: 상태
        350,  // J: 페이지URL
        150,  // K: 선택요소
        350,  // L: CSS선택자
        350,  // M: XPath
        130,  // N: 브라우저
        130,  // O: OS/기기
        120,  // P: 화면해상도
        100,  // Q: 뷰포트
        160,  // R: 시간대
        60,   // S: 언어
      ];

      const columnWidthRequests = colWidths.map((width, i) => ({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: width },
          fields: 'pixelSize',
        },
      }));

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [
              // 헤더 스타일
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 19 },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.29, green: 0.56, blue: 1.0 },
                      textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                      horizontalAlignment: 'CENTER',
                      verticalAlignment: 'MIDDLE',
                      wrapStrategy: 'WRAP',
                    },
                  },
                  fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
                },
              },
              // 전체 시트 자동 줄바꿈 + 수직 가운데 정렬
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 19 },
                  cell: {
                    userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' },
                  },
                  fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)',
                },
              },
              // 1행 고정
              {
                updateSheetProperties: {
                  properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                  fields: 'gridProperties.frozenRowCount',
                },
              },
              // H열(이미지링크, index 7) 전체를 "자동" 서식으로 — HYPERLINK 수식 인식
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 1, startColumnIndex: 7, endColumnIndex: 8 },
                  cell: {
                    userEnteredFormat: {
                      numberFormat: { type: 'NUMBER_FORMAT_TYPE_UNSPECIFIED' },
                    },
                  },
                  fields: 'userEnteredFormat.numberFormat',
                },
              },
              // A열(번호) 서식도 "자동"으로 — =ROW()-1 수식 인식
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
                  cell: {
                    userEnteredFormat: {
                      numberFormat: { type: 'NUMBER_FORMAT_TYPE_UNSPECIFIED' },
                    },
                  },
                  fields: 'userEnteredFormat.numberFormat',
                },
              },
              // 컬럼 너비 설정
              ...columnWidthRequests,
            ],
          }),
        }
      );

      showStatus('헤더 행이 생성되었습니다!', 'success');
    } catch (err) {
      showStatus('헤더 생성 실패: ' + err.message, 'error');
    } finally {
      btnInitSheet.disabled = false;
      btnInitSheet.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> 헤더 행 생성';
    }
  });

  // =============================================
  // 유틸
  // =============================================
  let statusTimeout = null;
  function showStatus(message, type) {
    if (statusTimeout) clearTimeout(statusTimeout);
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    statusTimeout = setTimeout(() => { statusMessage.style.display = 'none'; }, 4000);
  }

  // =============================================
  // 초기 로드
  // =============================================
  const loggedIn = await checkAuthStatus();
  if (loggedIn) updateView();
});
