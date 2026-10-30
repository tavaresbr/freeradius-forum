// Grafico de barras simples em SVG (sem biblioteca). dados: [{ rotulo, valor }].
// Escala pelo maior valor; o valor exato aparece no hover (<title>) e rotulos so de alguns em alguns.
export default function GraficoBarras({ dados, formato = (v) => String(v), cor = "#3b82f6", altura = 140, titulo }) {
  const lista = Array.isArray(dados) ? dados : [];
  if (lista.length === 0) return null;

  const largura = 600;
  const margemBaixo = 22;
  const area = altura - margemBaixo;
  const maximo = Math.max(...lista.map((d) => Number(d.valor) || 0), 0);
  const passo = largura / lista.length;
  const larguraBarra = Math.max(Math.min(passo * 0.7, 40), 2);
  const cadaRotulo = Math.max(1, Math.ceil(lista.length / 8));
  const semDados = maximo === 0;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        className="w-full h-auto"
        role="img"
        aria-label={titulo || "Gráfico de barras"}
      >
        <line x1="0" y1={area} x2={largura} y2={area} stroke="currentColor" strokeOpacity="0.2" />
        {lista.map((d, i) => {
          const v = Number(d.valor) || 0;
          const h = maximo > 0 ? Math.max((v / maximo) * (area - 6), v > 0 ? 2 : 0) : 0;
          const x = i * passo + (passo - larguraBarra) / 2;
          return (
            <g key={`${d.rotulo}-${i}`}>
              <rect x={x} y={area - h} width={larguraBarra} height={h} rx="2" fill={cor}>
                <title>{`${d.rotulo}: ${formato(v)}`}</title>
              </rect>
              {i % cadaRotulo === 0 && (
                <text x={x + larguraBarra / 2} y={altura - 6} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">
                  {d.rotulo}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {semDados && <p className="text-xs text-gray-600 text-center -mt-1">Sem dados no período.</p>}
    </div>
  );
}
