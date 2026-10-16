(() => {
  const CONNECT_TIMEOUT_MS = 20000;
  const SESSION_RE = /^qrt-[0-9a-f]{24}$/;
  const { formatBytes, safeName, randomId, sendFile, createReceiver } = QRTransfer;

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const fileChip = $('file-chip');
  const progress = $('progress');
  const progressBar = $('progress-bar');
  const pickBtn = $('pick-btn');
  const fileInput = $('file-input');
  const acceptBtn = $('accept-btn');
  const declineBtn = $('decline-btn');
  const saveLink = $('save-link');

  // 'to-phone': the computer sends a file here. 'to-computer': this phone sends one there.
  let mode = null;
  let peer = null;
  let conn = null;
  let meta = null;
  let receiver = null;
  let done = false;
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

  function hideActions() {
    pickBtn.hidden = true;
    acceptBtn.hidden = true;
    declineBtn.hidden = true;
  }

  function fail(message) {
    if (done || failed) return;
    failed = true;
    receiver?.abort();
    hideActions();
    progress.hidden = true;
    setStatus(message, 'error');
    try { conn?.close(); } catch {}
    try { peer?.destroy(); } catch {}
  }

  function succeed(message) {
    if (done || failed) return;
    done = true;
    progress.hidden = true;
    setStatus(message, 'ok');
  }

  function onHello(m) {
    if (mode || (m.mode !== 'to-phone' && m.mode !== 'to-computer')) return;
    mode = m.mode;
    if (mode === 'to-computer') {
      setStatus('Elegí el archivo que querés enviar a la computadora.');
      pickBtn.hidden = false;
    } else {
      setStatus('Conectado. Esperando el archivo…');
    }
  }

  function onMeta(m) {
    if (mode !== 'to-phone' || meta || typeof m.name !== 'string' || !Number.isFinite(m.size) || m.size < 0) return;
    meta = { name: safeName(m.name), size: m.size };
    receiver = createReceiver(meta.size, setProgress);
    showFile(meta.name, meta.size);
    setStatus('Tu computadora quiere enviarte este archivo.');
    acceptBtn.hidden = false;
    declineBtn.hidden = false;
  }

  function onDone() {
    let blob;
    try { blob = receiver.finish(); } catch (err) { fail(err.message); return; }
    saveLink.href = URL.createObjectURL(blob);
    saveLink.download = meta.name;
    saveLink.hidden = false;
    succeed('Archivo recibido.');
    conn.send(JSON.stringify({ type: 'received' }));
  }

  async function streamToComputer(file) {
    setStatus('Enviando…');
    progress.hidden = false;
    try {
      const ok = await sendFile(conn, file, () => !failed && !done, setProgress);
      if (ok) setStatus('Esperando confirmación de la computadora…');
    } catch (err) {
      fail(`Falló el envío: ${err.message || err}`);
    }
  }

  function onData(data) {
    if (typeof data !== 'string') {
      if (mode !== 'to-phone' || !receiver || !meta) return;
      try { receiver.push(data); } catch (err) { fail(err.message); }
      return;
    }
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'hello') onHello(msg);
    else if (mode === 'to-phone') {
      if (msg.type === 'meta') onMeta(msg);
      else if (msg.type === 'done') onDone();
    } else if (mode === 'to-computer') {
      if (msg.type === 'accept') streamToComputer(fileInput.files[0]);
      else if (msg.type === 'decline') fail('La computadora rechazó el archivo.');
      else if (msg.type === 'received') succeed('Archivo enviado.');
    }
  }

  function start() {
    const sessionId = location.hash.slice(1);
    if (!SESSION_RE.test(sessionId)) {
      setStatus('Link inválido. Escaneá de nuevo el código QR.', 'error');
      return;
    }

    peer = new Peer(randomId('qrr-'));

    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        fail('La sesión expiró o ya no está disponible. Generá un código nuevo en la computadora.');
      } else {
        fail(`Error de conexión: ${err.type || err.message}`);
      }
    });

    peer.on('open', () => {
      conn = peer.connect(sessionId, { serialization: 'raw', reliable: true });
      const timer = setTimeout(
        () => fail('No se pudo conectar con la computadora. Revisá que la pestaña siga abierta.'),
        CONNECT_TIMEOUT_MS
      );
      conn.on('open', () => {
        clearTimeout(timer);
        setStatus('Conectado. Esperando a la computadora…');
      });
      conn.on('data', onData);
      conn.on('close', () => fail('La computadora se desconectó antes de terminar.'));
      conn.on('error', (err) => fail(`Error de conexión: ${err.type || err.message}`));
    });
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file || mode !== 'to-computer') return;
    pickBtn.hidden = true;
    showFile(safeName(file.name), file.size);
    setStatus('Esperando que la computadora acepte el archivo…');
    conn.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size }));
  });

  acceptBtn.addEventListener('click', () => {
    hideActions();
    progress.hidden = false;
    setStatus('Recibiendo…');
    conn.send(JSON.stringify({ type: 'accept' }));
  });

  declineBtn.addEventListener('click', () => {
    conn.send(JSON.stringify({ type: 'decline' }));
    fail('Rechazaste el archivo.');
  });

  start();
})();
