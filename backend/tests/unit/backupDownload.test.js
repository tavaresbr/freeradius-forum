const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { criarDb, carregar, criarRes, criarReq } = require('../helpers/mocks');

process.env.JWT_SECRET = 'segredo-de-teste';
const BACKUPS = '/var/www/hotspot/backups';

function ctl({ backup, dono = true } = {}) {
  const db = criarDb((sql) => {
    if (/FROM system_backups WHERE id/i.test(sql)) return [backup ? [backup] : []];
  });
  return carregar('src/controllers/systemBackupController.js', {
    db,
    extras: { 'src/utils/donoPlataforma.js': { ehDonoPlataforma: async () => dono, limparCacheDono() {} } },
  });
}
const tok = (extra = {}, opts = { expiresIn: 60 }) =>
  jwt.sign({ proposito: 'backup-download', backup_id: 1, tipo: 'db', admin_id: 9, ...extra }, process.env.JWT_SECRET, opts);

test('download-token: tipo invalido, backup inexistente e caminho fora da pasta', async () => {
  const c = ctl({ backup: { id: 1, db_dump_path: '/etc/passwd', files_zip_path: null } });
  let res = criarRes();
  await c.gerarTokenDownload(criarReq({ params: { id: '1' }, body: { tipo: 'x' }, user: { id: 9 } }), res);
  assert.equal(res.statusCode, 400);
  res = criarRes();
  await c.gerarTokenDownload(criarReq({ params: { id: '1' }, body: { tipo: 'db' }, user: { id: 9 } }), res);
  assert.equal(res.statusCode, 400); // /etc/passwd esta fora de BACKUPS_DIR
  const c2 = ctl({});
  res = criarRes();
  await c2.gerarTokenDownload(criarReq({ params: { id: '1' }, body: { tipo: 'db' }, user: { id: 9 } }), res);
  assert.equal(res.statusCode, 404);
});

test('download-token: arquivo ausente em disco = 404', async () => {
  const c = ctl({ backup: { id: 1, db_dump_path: `${BACKUPS}/b1/db.sql`, files_zip_path: null } });
  const res = criarRes();
  await c.gerarTokenDownload(criarReq({ params: { id: '1' }, body: { tipo: 'db' }, user: { id: 9 } }), res);
  assert.equal(res.statusCode, 404);
});

test('download: token invalido, expirado, de outro proposito ou adulterado = 401', async () => {
  const c = ctl({ backup: { id: 1, db_dump_path: `${BACKUPS}/b1/db.sql` } });
  const casos = [
    'lixo',
    tok({}, { expiresIn: -10 }),
    tok({ proposito: 'login' }),
    tok({ tipo: 'outro' }),
    jwt.sign({ proposito: 'backup-download', backup_id: 1, tipo: 'db', admin_id: 9 }, 'outro-segredo'),
  ];
  for (const t of casos) {
    const res = criarRes();
    await c.baixarBackup(criarReq({ query: { t } }), res);
    assert.equal(res.statusCode, 401, String(t).slice(0, 20));
  }
});

test('download: quem deixou de ser dono recebe 403', async () => {
  const c = ctl({ backup: { id: 1, db_dump_path: `${BACKUPS}/b1/db.sql` }, dono: false });
  const res = criarRes();
  await c.baixarBackup(criarReq({ query: { t: tok() } }), res);
  assert.equal(res.statusCode, 403);
});

test('download: caminho fora da pasta = 400 e arquivo ausente = 404', async () => {
  let c = ctl({ backup: { id: 1, db_dump_path: path.join(os.tmpdir(), 'x.sql') } });
  let res = criarRes();
  await c.baixarBackup(criarReq({ query: { t: tok() } }), res);
  assert.equal(res.statusCode, 400);
  c = ctl({ backup: { id: 1, db_dump_path: `${BACKUPS}/b1/nao-existe.sql` } });
  res = criarRes();
  await c.baixarBackup(criarReq({ query: { t: tok() } }), res);
  assert.equal(res.statusCode, 404);
});
