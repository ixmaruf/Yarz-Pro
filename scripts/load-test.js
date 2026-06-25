/**
 * YARZ Load Test — 50+ concurrent (sequential batches)
 */
require('dotenv').config();

const CONCURRENCY = 10;
const TOTAL = 60;
const URL = 'https://yarzclothing.xyz/';
const KEY = 'AIzaSyApMtjj2baO6u19AvppjLtJ1GT1G61qo9k';

const endpoints = [
  { name: 'products', method: 'GET' },
  { name: 'delivery_charges', method: 'GET' },
  { name: 'product&name=Aza', method: 'GET' },
  { name: 'store_info', method: 'GET' },
  { name: 'health', method: 'GET' },
  { name: 'categories', method: 'GET' }
];

async function fireOne(endpoint) {
  const url = URL + '?action=' + endpoint.name + '&key=' + KEY + '&_t=' + Date.now() + Math.random();
  const start = Date.now();
  try {
    const r = await fetch(url, { method: endpoint.method, headers: { 'Cache-Control': 'no-cache' } });
    const text = await r.text();
    return { ok: r.ok, status: r.status, len: text.length, ms: Date.now() - start, endpoint: endpoint.name };
  } catch (e) {
    return { ok: false, error: e.message, ms: Date.now() - start, endpoint: endpoint.name };
  }
}

(async function main() {
  console.log('=== YARZ LOAD TEST ===');
  console.log('Concurrency: ' + CONCURRENCY + ', Total: ' + TOTAL);

  // Warm up
  for (const ep of endpoints) {
    const r = await fireOne(ep);
    console.log('Warmup ' + ep.name + ': ' + r.status + ' ' + r.ms + 'ms');
  }

  const results = { total: 0, ok: 0, err: 0, byStatus: {}, byEndpoint: {}, latencies: [] };

  for (let batch = 0; batch < TOTAL / CONCURRENCY; batch++) {
    const promises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
      promises.push(fireOne(ep));
    }
    const batchResults = await Promise.all(promises);
    for (const r of batchResults) {
      results.total++;
      if (r.ok) results.ok++; else results.err++;
      results.byStatus[r.status] = (results.byStatus[r.status] || 0) + 1;
      results.byEndpoint[r.endpoint] = results.byEndpoint[r.endpoint] || { ok: 0, err: 0, totalMs: 0 };
      results.byEndpoint[r.endpoint][r.ok ? 'ok' : 'err']++;
      results.byEndpoint[r.endpoint].totalMs += r.ms;
      results.latencies.push(r.ms);
    }
    process.stdout.write('.');
  }
  console.log('\n---');

  const lat = results.latencies.sort((a, b) => a - b);
  const p50 = lat[Math.floor(lat.length * 0.5)];
  const p95 = lat[Math.floor(lat.length * 0.95)];
  const p99 = lat[Math.floor(lat.length * 0.99)];
  const max = lat[lat.length - 1];
  const min = lat[0];

  console.log('Total: ' + results.total);
  console.log('OK: ' + results.ok + ' (' + ((results.ok / results.total) * 100).toFixed(1) + '%)');
  console.log('Err: ' + results.err);
  console.log('By status: ' + JSON.stringify(results.byStatus));
  console.log('Latency (ms): min=' + min + ' p50=' + p50 + ' p95=' + p95 + ' p99=' + p99 + ' max=' + max);
  console.log('---');
  console.log('By endpoint:');
  for (const [ep, s] of Object.entries(results.byEndpoint)) {
    const avg = (s.totalMs / (s.ok + s.err)).toFixed(0);
    console.log('  ' + ep + ': ok=' + s.ok + ' err=' + s.err + ' avg=' + avg + 'ms');
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
