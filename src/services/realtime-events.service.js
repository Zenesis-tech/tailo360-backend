const clients = new Map();

function connect(studioId, res) {
  const key = studioId.toString();
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ studioId: key })}\n\n`);
  const studioClients = clients.get(key) || new Set();
  studioClients.add(res);
  clients.set(key, studioClients);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  res.on('close', () => {
    clearInterval(heartbeat);
    studioClients.delete(res);
    if (!studioClients.size) clients.delete(key);
  });
}

function publish(studioId, payload = {}) {
  const studioClients = clients.get(studioId.toString());
  if (!studioClients) return;
  const event = `event: crm_changed\ndata: ${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n\n`;
  studioClients.forEach((res) => res.write(event));
}

module.exports = { connect, publish };
