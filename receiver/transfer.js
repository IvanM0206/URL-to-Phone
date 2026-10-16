// Shared by qr-extension/ and receiver/ (identical copies: the receiver is hosted separately). Keep both in sync.
window.QRTransfer = (() => {
  const CHUNK = 16 * 1024;
  const BLOCK = 1024 * 1024;
  const MAX_BUFFERED = 4 * 1024 * 1024;

  // Event-driven (not setTimeout) so background tabs don't get throttled; the timeout only covers a dead channel.
  function waitDrain(dc) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        dc.removeEventListener('bufferedamountlow', done);
        dc.removeEventListener('close', done);
        resolve();
      };
      const t = setTimeout(done, 2000);
      dc.addEventListener('bufferedamountlow', done);
      dc.addEventListener('close', done);
    });
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
  }

  function safeName(name) {
    const cleaned = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return cleaned || 'archivo';
  }

  function randomId(prefix) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Streams `file` over a raw PeerJS connection and finishes with a "done" message.
  // Resolves false if the connection died or isAlive() turned false midway.
  async function sendFile(c, file, isAlive, onProgress) {
    const dc = c.dataChannel;
    const alive = () => isAlive() && dc.readyState === 'open';
    dc.bufferedAmountLowThreshold = MAX_BUFFERED / 2;
    let sent = 0;
    while (sent < file.size) {
      const block = await file.slice(sent, sent + BLOCK).arrayBuffer();
      for (let o = 0; o < block.byteLength; o += CHUNK) {
        while (dc.bufferedAmount > MAX_BUFFERED) {
          if (!alive()) return false;
          onProgress(Math.max(0, sent + o - dc.bufferedAmount) / file.size);
          await waitDrain(dc);
        }
        if (!alive()) return false;
        c.send(block.slice(o, o + CHUNK));
      }
      sent += block.byteLength;
      onProgress(Math.max(0, sent - dc.bufferedAmount) / file.size);
    }
    if (!alive()) return false;
    c.send(JSON.stringify({ type: 'done' }));
    return true;
  }

  // Collects incoming binary chunks; the blob is always octet-stream so it can never render inline.
  function createReceiver(size, onProgress) {
    let chunks = [];
    let received = 0;
    return {
      push(data) {
        received += data.byteLength;
        if (received > size) throw new Error('Se recibieron más datos de los esperados.');
        chunks.push(data);
        onProgress(size ? received / size : 1);
      },
      finish() {
        if (received !== size) throw new Error('La transferencia terminó incompleta. Probá de nuevo.');
        const blob = new Blob(chunks, { type: 'application/octet-stream' });
        chunks = [];
        return blob;
      },
      abort() { chunks = []; },
    };
  }

  return { formatBytes, safeName, randomId, sendFile, createReceiver };
})();
