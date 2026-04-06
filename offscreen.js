// QA Capture - Offscreen Document (이미지 크롭 + 압축)

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'crop-image') {
    handleCrop(message.dataUrl, message.selection);
  }
  if (message.action === 'compress-image') {
    handleCompress(message.dataUrl);
  }
});

async function handleCrop(dataUrl, selection) {
  try {
    const img = await loadImage(dataUrl);
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = selection.width;
    canvas.height = selection.height;

    ctx.drawImage(
      img,
      selection.x, selection.y, selection.width, selection.height,
      0, 0, selection.width, selection.height
    );

    const croppedDataUrl = canvas.toDataURL('image/png');

    chrome.runtime.sendMessage({
      action: 'crop-complete',
      success: true,
      croppedDataUrl,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      action: 'crop-complete',
      success: false,
      error: err.message,
    });
  }
}

async function handleCompress(dataUrl) {
  try {
    const img = await loadImage(dataUrl);
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    // JPEG 0.8 품질로 압축
    const compressed = canvas.toDataURL('image/jpeg', 0.8);

    chrome.runtime.sendMessage({
      action: 'compress-complete',
      compressedDataUrl: compressed,
    });
  } catch {
    chrome.runtime.sendMessage({
      action: 'compress-complete',
      compressedDataUrl: dataUrl,
    });
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = dataUrl;
  });
}
