(() => {
  const SESSION_TTL_MS = 10 * 60 * 1000;
  const { formatBytes, safeName, randomId, sendFile, createReceiver } = QRTransfer;

  const $ = (id) => document.getElementById(id);
  const stepPick = $('step-pick');
  const stepSession = $('step-session');
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  const recvBtn = $('recv-btn');
  const fileChip = $('file-chip');
  const qrBox = $('qr-box');
  const qrWrap = $('qr-wrap');
  const statusEl = $('status');
  const progress = $('progress');
  const progressBar = $('progress-bar');
  const acceptBtn = $('accept-btn');
  const declineBtn = $('decline-btn');
  const saveLink = $('save-link');
  const cancelBtn = $('cancel-btn');
  const againBtn = $('again-btn');

  // 'to-phone': this computer sends a file. 'to-computer': the phone sends one here.
  let mode = null;
  let peer = null;
  let conn = null;
  let file = null;
  let receiver = null;
  let meta = null;
  let expiryTimer = null;
  let finished = false;
  let failed = false;
  let lastProgressKey = -1;

  function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setProgress(fraction) {
    const key = Math.floor(fraction * 1000);
    if (key === lastProgressKey) return;
    lastProgressKey = key;
    progressBar.style.width = `${Math.min(100, fraction * 100)}%`;
  }

  function showFile(name, size) {
    $('file-name').textContent = name;
    $('file-size').textContent = formatBytes(size);
    fileChip.hidden = false;
  }

  function cleanup() {
    clearTimeout(expiryTimer);
    window.onbeforeunload = null;
    try { conn?.close(); } catch {}
    try { peer?.destroy(); } catch {}
    receiver?.abort();
    conn = null;
    peer = null;
  }

  function reset() {
    cleanup();
    mode = null;
    file = null;
    meta = null;
    receiver = null;
    finished = false;
    failed = false;
    lastProgressKey = -1;
    fileInput.value = '';
    qrWrap.textContent = '';
    if (saveLink.href.startsWith('blob:')) URL.revokeObjectURL(saveLink.href);
    saveLink.removeAttribute('href');
    for (const el of [fileChip, qrBox, progress, acceptBtn, declineBtn, saveLink, againBtn]) el.hidden = true;
    progressBar.style.width = '0';
    cancelBtn.hidden = false;
    stepSession.hidden = true;
    stepPick.hidden = false;
  }

  function endSession(message, kind, retryLabel) {
    qrBox.hidden = true;
    progress.hidden = true;
    acceptBtn.hidden = true;
    declineBtn.hidden = true;
    setStatus(message, kind);
    cancelBtn.hidden = true;
    againBtn.textContent = retryLabel;
    againBtn.hidden = false;
  }

  function fail(message) {
    if (finished || failed) return;
    failed = true;
    cleanup();
    endSession(message, 'error', 'Intentar de nuevo');
  }

  function succeed(message) {
    if (finished || failed) return;
    finished = true;
    setProgress(1);
    // Give the last ack time to flush before tearing the connection down.
    const p = peer;
    setTimeout(() => { if (peer === p) cleanup(); }, 1000);
    endSession(message, 'ok', 'Transferir otro archivo');
  }

  function renderQr(text) {
    qrWrap.textContent = '';
    new QRCode(qrWrap, {
      text,
      width: 220,
      height: 220,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
    qrBox.hidden = false;
  }

  async function sendToPhone(c) {
    setStatus('Enviando…');
    progress.hidden = false;
    try {
      const ok = await sendFile(c, file, () => c === conn, setProgress);
      if (ok) setStatus('Esperando confirmación del celular…');
    } catch (err) {
      fail(`Falló el envío: ${err.message || err}`);
    }
  }

  function onPhoneMeta(m) {
    if (meta || typeof m.name !== 'string' || !Number.isFinite(m.size) || m.size < 0) return;
    meta = { name: safeName(m.name), size: m.size };
    receiver = createReceiver(meta.size, setProgress);
    showFile(meta.name, meta.size);
    setStatus('El celular quiere enviarte este archivo.');
    acceptBtn.hidden = false;
    declineBtn.hidden = false;
  }

  function onPhoneDone(c) {
    let blob;
    try { blob = receiver.finish(); } catch (err) { fail(err.message); return; }
    saveLink.href = URL.createObjectURL(blob);
    saveLink.download = meta.name;
    saveLink.hidden = false;
    c.send(JSON.stringify({ type: 'received' }));
    succeed('Archivo recibido.');
  }

  function onData(c, raw) {
    if (typeof raw !== 'string') {
      if (mode !== 'to-computer' || !receiver || !meta) return;
      try { receiver.push(raw); } catch (err) { fail(err.message); }
      return;
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (mode === 'to-phone') {
      if (msg.type === 'accept') sendToPhone(c);
      else if (msg.type === 'decline') fail('El celular rechazó el archivo.');
      else if (msg.type === 'received') succeed('Archivo enviado.');
    } else {
      if (msg.type === 'meta') onPhoneMeta(msg);
      else if (msg.type === 'done') onPhoneDone(c);
    }
  }

  function onConnection(c) {
    if (conn) {
      c.on('open', () => c.close());
      return;
    }
    conn = c;
    clearTimeout(expiryTimer);

    c.on('open', () => {
      peer.disconnect();
      qrBox.hidden = true;
      c.send(JSON.stringify({ type: 'hello', mode }));
      if (mode === 'to-phone') {
        setStatus('Celular conectado. Esperando que acepte el archivo…');
        c.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size }));
      } else {
        setStatus('Celular conectado. Esperando que elija un archivo…');
      }
    });

    c.on('data', (raw) => onData(c, raw));
    c.on('close', () => { if (c === conn) fail('El celular se desconectó antes de terminar.'); });
    c.on('error', (err) => { if (c === conn) fail(`Error de conexión: ${err.type || err.message}`); });
  }

  function startSession(newMode, f) {
    mode = newMode;
    file = f;
    if (f) showFile(f.name, f.size);
    stepPick.hidden = true;
    stepSession.hidden = false;
    setStatus('Creando sesión…');

    const p = new Peer(randomId('qrt-'));
    peer = p;
    window.onbeforeunload = (e) => { e.preventDefault(); };

    p.on('open', (id) => {
      renderQr(`${RECEIVER_URL.replace(/#.*$/, '')}#${id}`);
      setStatus('Escaneá el código con la cámara de tu celular.');
      expiryTimer = setTimeout(() => fail('La sesión expiró. Volvé a intentarlo.'), SESSION_TTL_MS);
    });
    p.on('connection', onConnection);
    p.on('error', (err) => { if (p === peer) fail(`No se pudo crear la sesión: ${err.type || err.message}`); });
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) startSession('to-phone', fileInput.files[0]);
  });

  recvBtn.addEventListener('click', () => startSession('to-computer', null));

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    if (e.dataTransfer.files[0]) startSession('to-phone', e.dataTransfer.files[0]);
  });

  acceptBtn.addEventListener('click', () => {
    acceptBtn.hidden = true;
    declineBtn.hidden = true;
    progress.hidden = false;
    setStatus('Recibiendo…');
    conn.send(JSON.stringify({ type: 'accept' }));
  });

  declineBtn.addEventListener('click', () => {
    conn.send(JSON.stringify({ type: 'decline' }));
    fail('Rechazaste el archivo.');
  });

  cancelBtn.addEventListener('click', reset);
  againBtn.addEventListener('click', reset);
})();
