const http = require('http');
const fs   = require('fs');
const path = require('path');

// Load agent list from agents.json
const AGENTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8')
);

// Where the controller exposes its own status
const CONTROLLER_PORT = process.env.CONTROLLER_PORT || 4100;

// How often to poll agents (ms)
const POLL_INTERVAL_MS = 10000; // 10 seconds

function fetchAgentStatus(agent, timeoutMs = 5000) {
  const options = {
    hostname: agent.host,
    port: agent.port,
    path: '/status',
    method: 'GET',
    timeout: timeoutMs,
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({
            ok: true,
            agent: agent.name,
            host: agent.host,
            port: agent.port,
            status: data,
          });
        } catch (err) {
          resolve({
            ok: false,
            agent: agent.name,
            host: agent.host,
            port: agent.port,
            error: 'Invalid JSON response',
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        agent: agent.name,
        host: agent.host,
        port: agent.port,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        agent: agent.name,
        host: agent.host,
        port: agent.port,
        error: 'timeout',
      });
    });

    req.end();
  });
}

let lastSnapshot = {
  controller: {
    host: '198.18.100.50',
    port: CONTROLLER_PORT,
  },
  updatedAt: null,
  agents: [],
};

async function pollAgents() {
  try {
    const results = await Promise.all(AGENTS.map(fetchAgentStatus));
    lastSnapshot = {
      controller: lastSnapshot.controller,
      updatedAt: new Date().toISOString(),
      agents: results,
    };

    fs.writeFileSync(
      path.join(__dirname, 'status.json'),
      JSON.stringify(lastSnapshot, null, 2)
    );

    console.log('[controller] Updated snapshot: ', lastSnapshot.updatedAt);
    results.forEach((r) => {
      if (r.ok) {
        console.log(`  ✓ ${r.agent} (${r.host}:${r.port}) OK`);
      } else {
        console.log(`  ✗ ${r.agent} ERROR: ${r.error}`);
      }
    });
  } catch (err) {
    console.error('[controller] Poll error:', err.message);
  }
}

// HTTP status API
const server = http.createServer((req, res) => {
  if (req.url === '/status' || req.url === '/fleet') {
    const body = JSON.stringify(lastSnapshot, null, 2);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });

    return res.end(body);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('controller-01: not found\n');
});

server.listen(CONTROLLER_PORT, '0.0.0.0', () => {
  console.log(`[controller] Listening on port ${CONTROLLER_PORT}`);
});

// Start polling loop
pollAgents();
setInterval(pollAgents, POLL_INTERVAL_MS);

