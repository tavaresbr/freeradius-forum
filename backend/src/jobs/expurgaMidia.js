// Expurgo de midia do atendimento WhatsApp: apaga do disco os arquivos mais antigos que MIDIA_RETENCAO_DIAS
// (padrao 90; 0 desliga) e marca a mensagem (midia_path NULL + midia_expirada_em). A mensagem e o texto ficam.
// Roda 1x por dia (cron do server.js). So toca em arquivos dentro de uploads/whatsapp (caminhoAbsoluto).
const fs = require("fs");
const db = require("../../db");
const { temColuna } = require("../utils/schemaCache");
const midiaUtil = require("../utils/whatsappMidia");

const LOTE = 500;
const MAX_LOTES = 40;
let emExecucao = false;

const diasDeRetencao = () => {
  const bruto = process.env.MIDIA_RETENCAO_DIAS;
  const n = bruto === undefined || bruto === "" ? 90 : parseInt(bruto, 10);
  return Number.isInteger(n) && n >= 0 ? n : 90;
};

async function expurgaMidia() {
  if (emExecucao) return { pulado: true };
  const dias = diasDeRetencao();
  if (dias === 0) return { desligado: true };
  emExecucao = true;
  let apagadas = 0;
  try {
    if (!(await temColuna("whatsapp_mensagens", "midia_expirada_em"))) return { sem_migration: true };
    for (let i = 0; i < MAX_LOTES; i++) {
      const [rows] = await db.query(
        `SELECT id, empresa_id, midia_path FROM whatsapp_mensagens
          WHERE midia_path IS NOT NULL AND criado_em < DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY id LIMIT ${LOTE}`,
        [dias]
      );
      if (!rows.length) break;
      for (const r of rows) {
        const abs = midiaUtil.caminhoAbsoluto(r.midia_path);
        if (abs) {
          try { await fs.promises.unlink(abs); }
          catch (err) { if (err.code !== "ENOENT") { console.warn(`[expurgo-midia] ${r.id}:`, err.message); continue; } }
        }
        await db.query("UPDATE whatsapp_mensagens SET midia_path = NULL, midia_expirada_em = NOW() WHERE id = ? AND empresa_id = ?", [r.id, r.empresa_id]);
        apagadas++;
      }
      if (rows.length < LOTE) break;
    }
    return { apagadas };
  } finally {
    emExecucao = false;
  }
}

module.exports = expurgaMidia;
module.exports.diasDeRetencao = diasDeRetencao;

if (require.main === module) {
  expurgaMidia().then((r) => { console.log(r); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
}
