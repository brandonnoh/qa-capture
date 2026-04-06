// QA Capture - Offscreen Document (이미지 크롭)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'crop-image') {
    cropImage(message.dataUrl, message.selection).then(sendResponse);
    return true; // async response
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

    ctx.drawImage(
      img,
      selection.x, selection.y, selection.width, selection.height,
      0, 0, selection.width, selection.height
    );

    const croppedDataUrl = canvas.toDataURL('image/png');
    return { success: true, croppedDataUrl };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
