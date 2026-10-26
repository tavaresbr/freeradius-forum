import { useState } from "react";

export const CAMPOS_EMPRESA_VAZIOS = {
  tipo_pessoa: "PJ", cpf: "",
  razao_social: "", nome_fantasia: "", cep: "", logradouro: "", numero: "",
  complemento: "", bairro: "", cidade: "", uf: "",
};

const soDigitos = (v) => String(v || "").replace(/\D/g, "");

export function mascaraCnpj(v) {
  const d = soDigitos(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function mascaraCpf(v) {
  const d = soDigitos(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function cpfValido(v) {
  const n = soDigitos(v);
  if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(n[i]) * (t + 1 - i);
    const resto = (soma * 10) % 11 % 10;
    if (resto !== Number(n[t])) return false;
  }
  return true;
}

function mascaraCep(v) {
  const d = soDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * CNPJ com busca na Receita (GET /api/cnpj/:cnpj) + endereco da empresa.
 * `form`/`setForm` do pai: usa cnpj, nome, email, telefone e os CAMPOS_EMPRESA_VAZIOS.
 * Dados vindos da busca sobrescrevem o formulario, mas continuam editaveis.
 */
export default function CamposEmpresa({ form, setForm, inputClass, labelClass }) {
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const pf = form.tipo_pessoa === "PF";
  const cpfDigitos = soDigitos(form.cpf);
  const trocarTipo = (tipo) => {
    setAviso(null);
    setForm((f) => ({ ...f, tipo_pessoa: tipo }));
  };

  const buscar = async (valorCnpj) => {
    const cnpj = soDigitos(valorCnpj);
    if (cnpj.length !== 14) {
      setAviso({ tipo: "erro", texto: "Informe os 14 dígitos do CNPJ" });
      return;
    }
    setBuscando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/cnpj/${cnpj}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || d.error || "Erro ao consultar CNPJ");
      setForm((f) => ({
        ...f,
        cnpj: mascaraCnpj(d.cnpj),
        nome: d.nome_fantasia || d.razao_social || f.nome,
        email: d.email || f.email,
        telefone: d.telefone || f.telefone,
        razao_social: d.razao_social || "",
        nome_fantasia: d.nome_fantasia || "",
        cep: d.cep || "",
        logradouro: d.logradouro || "",
        numero: d.numero || "",
        complemento: d.complemento || "",
        bairro: d.bairro || "",
        cidade: d.cidade || "",
        uf: d.uf || "",
      }));
      setAviso({ tipo: "ok", texto: "Dados preenchidos pela Receita Federal. Confira antes de salvar." });
    } catch (err) {
      setAviso({ tipo: "erro", texto: err.message });
    } finally {
      setBuscando(false);
    }
  };

  const onCnpj = (e) => {
    const v = mascaraCnpj(e.target.value);
    set("cnpj", v);
    if (soDigitos(v).length === 14) buscar(v);
  };

  const campo = (rotulo, nome, extra = {}) => (
    <div className={extra.className}>
      <label className={labelClass}>{rotulo}</label>
      <input
        type="text"
        value={form[nome] || ""}
        onChange={(e) => set(nome, extra.mascara ? extra.mascara(e.target.value) : e.target.value)}
        maxLength={extra.maxLength}
        className={inputClass}
      />
    </div>
  );

  const abaCls = (ativa) =>
    `flex-1 px-3 py-2 text-sm rounded border ${ativa ? "bg-apex-500 border-apex-500 text-white" : "border-gray-300 text-gray-600 hover:bg-apex-50"}`;

  if (pf) {
    return (
      <>
        <div className="flex gap-2">
          <button type="button" onClick={() => trocarTipo("PJ")} className={abaCls(false)}>Empresa (CNPJ)</button>
          <button type="button" onClick={() => trocarTipo("PF")} className={abaCls(true)}>Pessoa física (CPF)</button>
        </div>
        <div>
          <label className={labelClass}>CPF</label>
          <input
            type="text"
            inputMode="numeric"
            name="cpf"
            value={mascaraCpf(form.cpf)}
            onChange={(e) => set("cpf", mascaraCpf(e.target.value))}
            className={inputClass}
            placeholder="000.000.000-00"
          />
          {cpfDigitos.length === 11 && !cpfValido(cpfDigitos) && (
            <p className="text-xs mt-1 text-red-400">CPF inválido</p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {campo("CEP", "cep", { mascara: mascaraCep, maxLength: 9 })}
          {campo("Endereço", "logradouro", { className: "col-span-2" })}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {campo("Número", "numero")}
          {campo("Complemento", "complemento", { className: "col-span-2" })}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {campo("Bairro", "bairro")}
          {campo("Cidade", "cidade")}
          {campo("UF", "uf", { maxLength: 2 })}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex gap-2">
        <button type="button" onClick={() => trocarTipo("PJ")} className={abaCls(true)}>Empresa (CNPJ)</button>
        <button type="button" onClick={() => trocarTipo("PF")} className={abaCls(false)}>Pessoa física (CPF)</button>
      </div>
      <div>
        <label className={labelClass}>CNPJ</label>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            name="cnpj"
            value={form.cnpj || ""}
            onChange={onCnpj}
            className={inputClass}
            placeholder="00.000.000/0000-00"
          />
          <button
            type="button"
            onClick={() => buscar(form.cnpj)}
            disabled={buscando}
            className="px-3 rounded bg-blue-600 text-white text-sm hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
          >
            {buscando ? "Buscando..." : "Buscar"}
          </button>
        </div>
        {aviso && (
          <p className={`text-xs mt-1 ${aviso.tipo === "ok" ? "text-green-400" : "text-red-400"}`}>{aviso.texto}</p>
        )}
      </div>

      {campo("Razão social", "razao_social")}
      {campo("Nome fantasia", "nome_fantasia")}
      <div className="grid grid-cols-3 gap-3">
        {campo("CEP", "cep", { mascara: mascaraCep, maxLength: 9 })}
        {campo("Endereço", "logradouro", { className: "col-span-2" })}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {campo("Número", "numero")}
        {campo("Complemento", "complemento", { className: "col-span-2" })}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {campo("Bairro", "bairro")}
        {campo("Cidade", "cidade")}
        {campo("UF", "uf", { maxLength: 2 })}
      </div>
    </>
  );
}
