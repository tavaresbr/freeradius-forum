// Patch do !empty (RouterOS 7) na node-routeros 1.6.8: sem ele uma listagem vazia trava a conexao.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { RouterOSAPI } = require('node-routeros');
require('../../src/utils/routerosPatch');

const palavra = (w) => { const b = Buffer.from(w); return Buffer.concat([Buffer.from([b.length]), b]); };
const frase = (...w) => Buffer.concat([...w.map(palavra), Buffer.from([0])]);

function roteadorFalso() {
  return net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const words = []; let i = 0; let completo = false;
        while (i < buf.length) {
          const len = buf[i];
          if (len === 0) { completo = true; i++; break; }
          if (i + 1 + len > buf.length) break;
          words.push(buf.slice(i + 1, i + 1 + len).toString()); i += 1 + len;
        }
        if (!completo) break;
        buf = buf.slice(i);
        const tag = (words.find((w) => w.startsWith('.tag=')) || '');
        const resp = (...w) => s.write(frase(...w, ...(tag ? [tag] : [])));
        if (words[0] === '/login') resp('!done');
        else if (words[0] === '/vazio/print') { resp('!empty'); resp('!done'); }
        else if (words[0] === '/cheio/print') { resp('!re', '=nome=a'); resp('!done'); }
        else resp('!done');
      }
    });
  });
}

test('listagem vazia (!empty) nao trava a conexao: os comandos seguintes respondem', async () => {
  const srv = roteadorFalso();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const conn = new RouterOSAPI({ host: '127.0.0.1', user: 'a', password: 'b', port: srv.address().port, timeout: 5 });
  conn.on('error', () => {});
  try {
    await conn.connect();
    const comPrazo = (p) => Promise.race([conn.write(p), new Promise((r) => setTimeout(() => r('TIMEOUT'), 2000))]);
    assert.deepStrictEqual(await comPrazo('/cheio/print'), [{ nome: 'a' }]);
    assert.deepStrictEqual(await comPrazo('/vazio/print'), []);
    assert.deepStrictEqual(await comPrazo('/cheio/print'), [{ nome: 'a' }]);
    assert.deepStrictEqual(await comPrazo('/vazio/print'), []);
  } finally {
    srv.close();
  }
});

test('o patch e aplicado uma unica vez', () => {
  const { aplicar } = require('../../src/utils/routerosPatch');
  assert.strictEqual(aplicar(), false);
});

test('todo modulo que cria RouterOSAPI carrega o patch', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['controllers/mikrotikAPIController.js', 'controllers/planController.js', 'utils/hotspotSetup.js', 'utils/sessaoAtiva.js', 'utils/mikrotikClient.js', 'routes/mikrotikRoutes.js']) {
    const fonte = fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
    assert.ok(fonte.includes('routerosPatch'), `${f} deve carregar routerosPatch`);
  }
});
