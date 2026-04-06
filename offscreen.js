// QA Capture - Offscreen Document (이미지 크롭)

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'crop-image') {
    cropImage(message.dataUrl, message.selection);
  }
});

async function cropImage(dataUrl, selection) {
  try {
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = selection.width;
    canvas.height = selection.height;

    // 선택 영역만 크롭하여 그리기
    ctx.drawImage(
      img,
      selection.x, selection.y, selection.width, selection.height, // source
      0, 0, selection.width, selection.height                      // destination
    );

    const croppedDataUrl = canvas.toDataURL('image/png');

    chrome.runtime.sendMessage({
      action: 'crop-complete',
      croppedDataUrl,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      action: 'crop-complete',
      error: err.message,
    });
  }
}
