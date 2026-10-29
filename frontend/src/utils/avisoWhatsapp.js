// Aviso de mensagem nova no WhatsApp: beep (WebAudio, sem arquivo) e notificacao do navegador.
// A preferencia fica so neste navegador (localStorage); padrao: ligado.
const CHAVE = "wa_aviso";

export function avisoAtivo() {
  try { return localStorage.getItem(CHAVE) !== "0"; } catch { return true; }
}

export function definirAviso(ligado) {
  try { localStorage.setItem(CHAVE, ligado ? "1" : "0"); } catch { /* sem armazenamento */ }
}

export function tocarAviso() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.18].forEach((atraso, i) => {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1175;
      ganho.gain.setValueAtTime(0.0001, ctx.currentTime + atraso);
      ganho.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + atraso + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + atraso + 0.16);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(ctx.currentTime + atraso);
      osc.stop(ctx.currentTime + atraso + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* navegador sem audio ou bloqueado: so nao toca */ }
}

// So notifica com a aba em segundo plano (com ela aberta o beep e o contador ja avisam).
export function notificar(titulo, corpo) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || !document.hidden) return;
    new Notification(titulo, { body: corpo, tag: "wa-novas" });
  } catch { /* ignora */ }
}

export async function pedirPermissaoNotificacao() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
  } catch { /* ignora */ }
}
