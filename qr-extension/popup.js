(async () => {
  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';

  // Show truncated URL in the chip
  const urlText = document.getElementById('url-text');
  urlText.textContent = url;
  urlText.title = url;

  // Generate QR code into the container div
  // QRCode.js renders a <canvas> inside the target element
  const wrap = document.getElementById('qr-canvas-wrap');

  new QRCode(wrap, {
    text: url,
    width: 200,
    height: 200,
    colorDark: '#FFFFFF',
    colorLight: '#18181c',   // matches --surface
    correctLevel: QRCode.CorrectLevel.M,
  });

  // The popup closes when the file dialog opens, so the transfer lives in its own tab.
  document.getElementById('send-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('send.html') });
    window.close();
  });

  // Copy URL button
  const copyBtn = document.getElementById('copy-btn');
  const copyLabel = document.getElementById('copy-label');

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      copyLabel.textContent = '¡Copiada!';
      copyBtn.classList.add('success');
      setTimeout(() => {
        copyLabel.textContent = 'Copiar URL';
        copyBtn.classList.remove('success');
      }, 2000);
    } catch {
      copyLabel.textContent = 'Error';
    }
  });
})();
