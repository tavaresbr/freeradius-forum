import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import SiteHeader from "../../components/public/SiteHeader";
import CamposEmpresa, { CAMPOS_EMPRESA_VAZIOS } from "../../components/CamposEmpresa";

export default function Registro() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const planoId = searchParams.get("plano");
  const [form, setForm] = useState({
    nome: "",
    cnpj: "",
    email: "",
    telefone: "",
    senha: "",
    confirmarSenha: "",
    ...CAMPOS_EMPRESA_VAZIOS,
  });
  const [erro, setErro] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro(null);

    if (form.senha !== form.confirmarSenha) {
      setErro("As senhas não coincidem");
      return;
    }

    if (form.senha.length < 6) {
      setErro("A senha deve ter pelo menos 6 caracteres");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: form.nome,
          cnpj: form.cnpj,
          email: form.email,
          telefone: form.telefone,
          ...Object.fromEntries(Object.keys(CAMPOS_EMPRESA_VAZIOS).map((k) => [k, form[k]])),
          senha: form.senha,
          plano_id: planoId || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        login(data.token, data.user, data.empresas);
        navigate(`/admin/${data.user.empresa_slug}`);
      } else {
        setErro(data.message || "Erro ao registrar empresa");
      }
    } catch (err) {
      setErro("Erro de conexão com o servidor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f111a] p-4 pt-24">
      <SiteHeader />
      <form
        onSubmit={handleSubmit}
        className="bg-[#1a1d27] border border-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-md"
      >
        <h2 className="text-2xl font-bold mb-6 text-center text-white">
          Cadastre sua Empresa
        </h2>
        <p className="text-sm text-center text-gray-400 -mt-4 mb-6">Teste grátis por 7 dias, sem cartão.</p>

        {erro && (
          <p className="text-red-400 text-sm mb-4 text-center">{erro}</p>
        )}

        <div className="space-y-4 mb-4">
          <CamposEmpresa
            form={form}
            setForm={setForm}
            labelClass="block text-gray-400 mb-2 text-sm"
            inputClass="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-400 mb-2 text-sm">
            Nome da Empresa
          </label>
          <input
            type="text"
            name="nome"
            value={form.nome}
            onChange={handleChange}
            className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-400 mb-2 text-sm">Email</label>
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-400 mb-2 text-sm">Telefone</label>
          <input
            type="text"
            name="telefone"
            value={form.telefone}
            onChange={handleChange}
            className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            placeholder="(00) 00000-0000"
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-400 mb-2 text-sm">Senha</label>
          <input
            type="password"
            name="senha"
            value={form.senha}
            onChange={handleChange}
            className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <div className="mb-6">
          <label className="block text-gray-400 mb-2 text-sm">
            Confirmar Senha
          </label>
          <input
            type="password"
            name="confirmarSenha"
            value={form.confirmarSenha}
            onChange={handleChange}
            className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-500 transition-colors duration-200 cursor-pointer font-medium disabled:opacity-50"
        >
          {loading ? "Cadastrando..." : "Cadastrar Empresa"}
        </button>

        <p className="text-center text-gray-500 text-sm mt-4">
          Já tem conta?{" "}
          <Link to="/login" className="text-blue-400 hover:text-blue-300">
            Fazer login
          </Link>
        </p>
      </form>
    </div>
  );
}
