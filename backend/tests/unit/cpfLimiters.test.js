const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');
const { cpfLookupLimiters } = require('../../src/middleware/rateLimiters');

function subir() {
  const app = express();
  app.use(express.json());
  app.post('/consulta', ...cpfLookupLimiters, (req, res) => res.json({ ok: true }));
  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function post(srv, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/consulta', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ status: res.statusCode, corpo: JSON.parse(buf) }));
    });
    req.on('error', reject); req.end(data);
  });
}

test('limitadores: por CPF (10/h), mesmo mudando MAC; outro CPF segue liberado', async () => {
  const srv = await subir();
  try {
    const cpfAlvo = '529.982.247-25';
    for (let i = 0; i < 10; i++) {
      const r = await post(srv, { cpf: cpfAlvo, mac: `aa:bb:cc:dd:ee:${String(i).padStart(2, '0')}` });
      assert.strictEqual(r.status, 200, `tentativa ${i + 1}`);
    }
    const bloqueada = await post(srv, { cpf: cpfAlvo, mac: '11:22:33:44:55:66' });
    assert.strictEqual(bloqueada.status, 429);
    assert.match(bloqueada.corpo.error, /Muitas tentativas/);
    // O mesmo CPF com ou sem mascara conta na mesma chave
    assert.strictEqual((await post(srv, { cpf: '52998224725', mac: '99:99:99:99:99:99' })).status, 429);
    // Outro CPF (outro aparelho) nao e' afetado pelo bloqueio do primeiro
    assert.strictEqual((await post(srv, { cpf: '111.444.777-35', mac: '77:77:77:77:77:77' })).status, 200);
  } finally { srv.close(); }
});
