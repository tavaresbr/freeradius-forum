import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import SiteHeader from '../../components/public/SiteHeader'
import useBranding from '../../hooks/useBranding'
import MarcaApex from '../../components/public/MarcaApex'

export default function Login() {
  const { nome, logoUrl } = useBranding()
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(null)
  const [verSenha, setVerSenha] = useState(false)

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

  const inp = 'w-full bg-white border border-gray-300 text-gray-900 rounded-lg px-3 py-3 text-base focus:outline-none focus:border-apex-500 focus:ring-2 focus:ring-apex-200'
  return (
    <div className="tema-site min-h-screen pt-24 bg-white flex">
      <SiteHeader />
      <div className="hidden lg:flex flex-1 flex-col justify-center px-16 bg-gradient-to-br from-apex-50 to-apex-200 text-apex-900">
        <h1 className="text-4xl font-extrabold leading-tight">Gerencie seu Wi-Fi <span className="text-apex-600">em um só lugar</span></h1>
        <ul className="mt-6 space-y-3 text-apex-700">
          <li>✓ Portal de acesso com PIX e cartão</li>
          <li>✓ LGPD e Marco Civil em dia</li>
          <li>✓ MikroTik, Omada, UniFi e Grandstream</li>
        </ul>
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-white border border-apex-100 p-6 sm:p-8 rounded-2xl shadow-xl shadow-apex-500/10 w-full max-w-sm">
          <div className="mb-6 text-center">
            {logoUrl
              ? <div className="flex justify-center"><MarcaApex local="login" /></div>
              : <h2 className="text-2xl font-bold text-apex-900">{nome}</h2>}
            <p className="text-sm text-gray-500 mt-1">Entre na sua conta</p>
          </div>
          {erro && <p className="text-red-600 text-sm mb-4">{erro}</p>}

          <div className="mb-4">
            <label className="block text-gray-600 mb-2 text-sm">Email</label>
            <input type="email" name="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" enterKeyHint="next" value={email} onChange={(e) => setEmail(e.target.value)} className={inp} required />
          </div>

          <div className="mb-6">
            <label className="block text-gray-600 mb-2 text-sm">Senha</label>
            <div className="relative">
              <input type={verSenha ? "text" : "password"} name="password" autoComplete="current-password" enterKeyHint="go" value={senha} onChange={(e) => setSenha(e.target.value)} className={`${inp} pr-16`} required />
              <button type="button" onClick={() => setVerSenha((v) => !v)} className="absolute inset-y-0 right-0 px-3 text-sm text-apex-600 cursor-pointer" aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}>
                {verSenha ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>

          <button type="submit" className="w-full bg-apex-500 text-white py-3 rounded-lg hover:bg-apex-600 transition-colors duration-200 cursor-pointer font-medium">
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}
