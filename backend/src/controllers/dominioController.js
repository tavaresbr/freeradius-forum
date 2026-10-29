const db = require("../../db");
const dom = require("../utils/dominioPortal");

const sistema = () => String(process.env.SYSTEM_DOMAIN || "").trim().toLowerCase();

const colunaAusente = (e) => e && (e.code === "ER_BAD_FIELD_ERROR" || e.errno === 1054);
const MSG_MIGRATION = "Rode a migration 046 (node migrations/046_dominio_proprio.js) no servidor.";

async function carregar(empresaId) {
  const [[e]] = await db.execute(
    "SELECT dominio_portal, dominio_status, dominio_erro, dominio_ativado_em FROM empresas WHERE id = ?",
    [empresaId]
  );
  return e || {};
}

function resposta(e) {
  const sys = sistema();
  return {
    dominio: e.dominio_portal || null,
    status: e.dominio_status || null,
    erro: e.dominio_erro || null,
    ativado_em: e.dominio_ativado_em || null,
    alvo: sys, // CNAME aponta para este host
    portal_base: e.dominio_portal && e.dominio_status === "ativo" ? `https://${e.dominio_portal}` : (sys ? `https://${sys}` : null),
    automatico: process.env.DOMINIO_AUTOMATICO !== "0",
  };
}

exports.obter = async (req, res) => {
  try {
    res.json(resposta(await carregar(req.empresa_id)));
  } catch (err) {
    if (colunaAusente(err)) return res.status(500).json({ message: MSG_MIGRATION });
    console.error("[dominio] obter:", err.message);
    res.status(500).json({ message: "Erro ao carregar o domínio." });
  }
};

exports.salvar = async (req, res) => {
  const v = dom.validarDominio(req.body && req.body.dominio);
  if (v.erro) return res.status(400).json({ message: v.erro });
  try {
    const atual = await carregar(req.empresa_id);
    const [[outro]] = await db.execute("SELECT id FROM empresas WHERE dominio_portal = ? AND id <> ? LIMIT 1", [v.host, req.empresa_id]);
    if (outro) return res.status(409).json({ message: "Este domínio já está em uso por outra empresa." });
    if (atual.dominio_portal && atual.dominio_portal !== v.host) await dom.removerDominio(atual.dominio_portal);
    await db.execute(
      "UPDATE empresas SET dominio_portal = ?, dominio_status = 'pendente', dominio_erro = NULL, dominio_ativado_em = NULL WHERE id = ?",
      [v.host, req.empresa_id]
    );
    dom.invalidarPortalHost(req.empresa_id);
    res.json(resposta(await carregar(req.empresa_id)));
  } catch (err) {
    if (colunaAusente(err)) return res.status(500).json({ message: MSG_MIGRATION });
    console.error("[dominio] salvar:", err.message);
    res.status(500).json({ message: "Erro ao salvar o domínio." });
  }
};

exports.verificar = async (req, res) => {
  try {
    const e = await carregar(req.empresa_id);
    if (!e.dominio_portal) return res.status(400).json({ message: "Cadastre um domínio primeiro." });
    const r = await dom.verificarDns(e.dominio_portal);
    if (r.ok) {
      if (e.dominio_status !== "ativo") {
        await db.execute("UPDATE empresas SET dominio_status = 'dns_ok', dominio_erro = NULL WHERE id = ?", [req.empresa_id]);
      }
      return res.json({ ok: true, tipo: r.tipo, ...resposta(await carregar(req.empresa_id)) });
    }
    res.json({ ok: false, mensagem: r.mensagem, encontrado: r.encontrado || [], ...resposta(e) });
  } catch (err) {
    console.error("[dominio] verificar:", err.message);
    res.status(500).json({ message: "Erro ao verificar o DNS." });
  }
};

exports.ativar = async (req, res) => {
  if (process.env.DOMINIO_AUTOMATICO === "0") return res.status(409).json({ message: "A ativação automática não está disponível neste servidor." });
  try {
    const e = await carregar(req.empresa_id);
    if (!e.dominio_portal) return res.status(400).json({ message: "Cadastre um domínio primeiro." });
    if (!["dns_ok", "erro", "ativo"].includes(e.dominio_status)) return res.status(409).json({ message: "Verifique o DNS antes de ativar." });
    // Reconfere o DNS: o estado gravado pode estar velho e o certbot falharia com limite de tentativas.
    const r = await dom.verificarDns(e.dominio_portal);
    if (!r.ok) return res.status(409).json({ message: r.mensagem });
    try {
      await dom.garantirDesafioHttp(e.dominio_portal);
      await dom.emitirCertificado(e.dominio_portal);
      await dom.escreverVhost(e.dominio_portal);
    } catch (err) {
      const msg = err.seguro ? err.message : "Erro ao ativar o HTTPS do domínio.";
      await db.execute("UPDATE empresas SET dominio_status = 'erro', dominio_erro = ? WHERE id = ?", [msg.slice(0, 250), req.empresa_id]);
      dom.invalidarPortalHost(req.empresa_id);
      return res.status(502).json({ message: msg });
    }
    await db.execute("UPDATE empresas SET dominio_status = 'ativo', dominio_erro = NULL, dominio_ativado_em = NOW() WHERE id = ?", [req.empresa_id]);
    dom.invalidarPortalHost(req.empresa_id);
    res.json(resposta(await carregar(req.empresa_id)));
  } catch (err) {
    console.error("[dominio] ativar:", err.message);
    res.status(500).json({ message: "Erro ao ativar o domínio." });
  }
};

exports.remover = async (req, res) => {
  try {
    const e = await carregar(req.empresa_id);
    if (e.dominio_portal) await dom.removerDominio(e.dominio_portal);
    await db.execute("UPDATE empresas SET dominio_portal = NULL, dominio_status = NULL, dominio_erro = NULL, dominio_ativado_em = NULL WHERE id = ?", [req.empresa_id]);
    dom.invalidarPortalHost(req.empresa_id);
    res.json(resposta(await carregar(req.empresa_id)));
  } catch (err) {
    console.error("[dominio] remover:", err.message);
    res.status(500).json({ message: "Erro ao remover o domínio." });
  }
};
