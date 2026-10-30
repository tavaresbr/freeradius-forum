// Manutencoes programadas: validacao, etapas de aviso e mensagem. Funcoes puras (sem banco).
const ANTECEDENCIAS = [15, 30, 60, 180, 720, 1440, 2880]; // minutos antes do inicio
const MAX_TITULO = 150;
const MAX_MENSAGEM = 1000;
const MAX_DURACAO_MIN = 7 * 24 * 60;
const DATA = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/;

const MENSAGEM_FIM_PADRAO = "Olá, {{nome}}! A manutenção terminou e a internet já está normalizada. Obrigado pela compreensão.";

/** "2026-11-02T22:00" -> "2026-11-02 22:00:00" (sem fuso: vale o relogio do servidor/MySQL). null se invalida. */
function normalizarData(v) {
  const m = DATA.exec(String(v || "").trim());
  if (!m) return null;
  const [, a, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const t = new Date(Date.UTC(a, mo - 1, d, h, mi));
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null; // 31 de fevereiro etc.
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:00`;
}
const minutosEntre = (ini, fim) => Math.round((Date.UTC(...fim.slice(0, 16).split(/[- :]/).map((x, i) => (i === 1 ? Number(x) - 1 : Number(x)))) - Date.UTC(...ini.slice(0, 16).split(/[- :]/).map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))))) / 60000);

/** Valida o corpo. Retorna { ok, erro } ou { ok:true, valor }. */
function validarManutencao(body) {
  const b = body && typeof body === "object" ? body : {};
  const titulo = String(b.titulo || "").trim();
  const mensagem = String(b.mensagem || "").trim();
  if (!titulo) return { ok: false, erro: "Informe o título da manutenção" };
  if (titulo.length > MAX_TITULO) return { ok: false, erro: `O título deve ter no máximo ${MAX_TITULO} caracteres` };
  const avisar_clientes = b.avisar_clientes === undefined ? true : !!b.avisar_clientes;
  if (avisar_clientes && !mensagem) return { ok: false, erro: "Escreva a mensagem do aviso" };
  if (mensagem.length > MAX_MENSAGEM) return { ok: false, erro: `A mensagem deve ter no máximo ${MAX_MENSAGEM} caracteres` };
  const mensagem_fim = String(b.mensagem_fim || "").trim();
  if (mensagem_fim.length > MAX_MENSAGEM) return { ok: false, erro: `A mensagem final deve ter no máximo ${MAX_MENSAGEM} caracteres` };
  const inicio_em = normalizarData(b.inicio_em);
  const fim_em = normalizarData(b.fim_em);
  if (!inicio_em || !fim_em) return { ok: false, erro: "Informe início e fim válidos" };
  const dur = minutosEntre(inicio_em, fim_em);
  if (dur <= 0) return { ok: false, erro: "O fim deve ser depois do início" };
  if (dur > MAX_DURACAO_MIN) return { ok: false, erro: "A manutenção pode durar no máximo 7 dias" };
  let equipamento_id = null;
  if (b.equipamento_id !== undefined && b.equipamento_id !== null && b.equipamento_id !== "") {
    equipamento_id = Number(b.equipamento_id);
    if (!Number.isInteger(equipamento_id) || equipamento_id <= 0) return { ok: false, erro: "Equipamento inválido" };
  }
  const bruto = Array.isArray(b.antecedencias) ? b.antecedencias : [1440, 60];
  const antecedencias = [...new Set(bruto.map(Number))].filter((a) => ANTECEDENCIAS.includes(a)).sort((x, y) => y - x);
  if (bruto.length && bruto.some((a) => !ANTECEDENCIAS.includes(Number(a)))) return { ok: false, erro: "Antecedência inválida" };
  if (antecedencias.length > 3) return { ok: false, erro: "Escolha no máximo 3 avisos antes" };
  const janela_dias = b.janela_dias === undefined || b.janela_dias === "" ? 30 : Number(b.janela_dias);
  if (!Number.isInteger(janela_dias) || janela_dias < 1 || janela_dias > 365) return { ok: false, erro: "Janela de uso inválida (1 a 365 dias)" };
  return { ok: true, valor: { titulo, mensagem, mensagem_fim, equipamento_id, inicio_em, fim_em, antecedencias, aviso_fim: !!b.aviso_fim, avisar_clientes, janela_dias } };
}

/** "02/11 22:00" a partir de "2026-11-02 22:00:00" ou Date. */
function formatarDataHora(v) {
  const s = v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")} ${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}` : String(v || "");
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : "";
}

/** Troca {{inicio}} {{fim}} {{equipamento}} (o {{nome}} fica para o worker, por destinatario). */
function renderizarMensagem(modelo, { inicio, fim, equipamento }) {
  return String(modelo || "")
    .replace(/\{\{\s*inicio\s*\}\}/gi, formatarDataHora(inicio))
    .replace(/\{\{\s*fim\s*\}\}/gi, formatarDataHora(fim))
    .replace(/\{\{\s*equipamento\s*\}\}/gi, equipamento || "sua rede")
    .trim();
}

/**
 * Etapas devidas agora. `minAteInicio`/`minAteFim` = minutos ate o inicio/fim (negativo = ja passou).
 * Antes do inicio: etapa `a<min>` quando faltam <= min (a mais proxima ainda nao enviada vale; as mais distantes
 * ja vencidas sao puladas para nao mandar 3 avisos de uma vez). Depois do fim: `fim` (ate 6 h depois).
 */
function etapasDevidas(m, minAteInicio, minAteFim, jaFeitas = []) {
  const feitas = new Set(jaFeitas);
  const out = [];
  if (m.avisar_clientes === 0 || m.avisar_clientes === false) return out;
  if (minAteInicio > 0) {
    const ants = (Array.isArray(m.antecedencias) ? m.antecedencias : []).slice().sort((a, b) => a - b); // da mais proxima para a mais distante
    const devidas = ants.filter((a) => minAteInicio <= a && !feitas.has(`a${a}`));
    if (devidas.length) out.push(`a${devidas[0]}`); // so a mais proxima; as mais distantes ficam implicitamente vencidas
    // marca as demais vencidas como feitas para nao dispararem depois
    for (const a of devidas.slice(1)) out.push(`pula:a${a}`);
  }
  if (m.aviso_fim && minAteFim <= 0 && minAteFim >= -360 && !feitas.has("fim")) out.push("fim");
  return out;
}

module.exports = { ANTECEDENCIAS, MAX_MENSAGEM, MENSAGEM_FIM_PADRAO, normalizarData, validarManutencao, formatarDataHora, renderizarMensagem, etapasDevidas };
