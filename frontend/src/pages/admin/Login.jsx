import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import SiteHeader from '../../components/public/SiteHeader'
import useBranding from '../../hooks/useBranding'

export default function Login() {
  const { nome } = useBranding()
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(null)

  const handleLogin = async (e) => {
    e.preventDefault()

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      })

      const data = await res.json()

      if (res.ok) {
        login(data.token, data.user, data.empresas, data.permissoes)
        const slug = data.user?.empresa_slug || 'default'
        navigate(`/admin/${slug}`)
      } else {
        setErro(data.message || data.error || 'Erro ao fazer login')
      }
    } catch (err) {
      setErro('Erro de conexão com o servidor')
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen pt-16 bg-[#0f111a]">
      <SiteHeader />
      <form onSubmit={handleLogin} className="bg-[#1a1d27] border border-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-sm">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-white">{nome}</h2>
        </div>
        {erro && <p className="text-red-400 text-sm mb-4">{erro}</p>}

        <div className="mb-4">
          <label className="block text-gray-400 mb-2 text-sm">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <div className="mb-6">
          <label className="block text-gray-400 mb-2 text-sm">Senha</label>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="w-full bg-[#0d1117] border border-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            required
          />
        </div>

        <button
          type="submit"
          className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-500 transition-colors duration-200 cursor-pointer font-medium"
        >
          Entrar
        </button>

      </form>
    </div>
  )
}
