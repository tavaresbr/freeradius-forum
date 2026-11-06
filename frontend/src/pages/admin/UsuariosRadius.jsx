// frontend/src/pages/admin/UsuariosRadius.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '@/components/admin/AdminLayout';

const UsuariosRadius = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [planos, setPlanos] = useState([]);
  const [planoSelecionado, setPlanoSelecionado] = useState('');
  const [status, setStatus] = useState('');
  const [usuarios, setUsuarios] = useState([]);
  const [mostrarModal, setMostrarModal] = useState(false);

  const token = localStorage.getItem('admin_token');

  const carregarUsuarios = async () => {
    try {
      const res = await axios.get('/api/radius/usuarios', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsuarios(res.data);
    } catch {
      setStatus('Erro ao carregar usuários.');
    }
  };

  useEffect(() => {
    axios.get('/api/planos', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setPlanos(res.data))
      .catch(() => setStatus('Erro ao carregar planos.'));

    carregarUsuarios();
  }, [token]);

  const handleSubmit = async () => {
    try {
      await axios.post('/api/radius/criar-usuario', { username, password }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      await axios.post('/api/radius/vincular-plano', {
        username,
        planoId: planoSelecionado
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setStatus('Usuário criado e plano vinculado com sucesso!');
      setUsername('');
      setPassword('');
      setPlanoSelecionado('');
      setMostrarModal(false);

      carregarUsuarios();
    } catch (err) {
      setStatus('Erro ao criar usuário ou vincular plano.');
    }
  };

  const handleDeletar = async (username) => {
    if (window.confirm(`Tem certeza que deseja remover o usuário ${username}?`)) {
      try {
        await axios.delete(`/api/radius/usuarios/${username}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        carregarUsuarios();
      } catch {
        alert('Erro ao deletar usuário');
      }
    }
  };

  return (
    <AdminLayout>
      <div className="p-4 max-w-6xl">
        <h2 className="text-xl font-bold mb-4">Usuários Radius</h2>

        <button
          onClick={() => setMostrarModal(true)}
          className="mb-4 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-xl"
        >
          Novo Usuário
        </button>

        {mostrarModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#1a1d27] rounded-lg border border-gray-700 p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Novo Usuário RADIUS</h3>
              <input type="text" placeholder="Usuário" className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 mb-2" value={username} onChange={e => setUsername(e.target.value)} />
              <input type="password" placeholder="Senha" className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 mb-2" value={password} onChange={e => setPassword(e.target.value)} />
              <select className="w-full p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:border-blue-500 mb-4" value={planoSelecionado} onChange={e => setPlanoSelecionado(e.target.value)}>
                <option value="">Selecione um plano</option>
                {planos.map(plano => (
                  <option key={plano.id} value={plano.id}>{plano.nome}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => setMostrarModal(false)} className="px-4 py-2 border border-gray-700 text-gray-300 rounded">Cancelar</button>
                <button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">Salvar</button>
              </div>
              {status && <p className="text-sm text-gray-400 mt-2">{status}</p>}
            </div>
          </div>
        )}

        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-2">Usuários cadastrados</h3>
          <div className="overflow-x-auto">
            <table className="w-full table-auto border text-sm">
              <thead className="bg-[#151821]">
                <tr>
                  <th className="px-4 py-2 text-left">Usuário</th>
                  <th className="px-4 py-2 text-left">Senha</th>
                  <th className="px-4 py-2 text-left">Plano</th>
                  <th className="px-4 py-2 text-left">NAS</th>
                  <th className="px-4 py-2 text-left">Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u, idx) => (
                  <tr key={idx} className="border-t border-gray-800">
                    <td className="px-4 py-2"><span className="dado-sensivel">{u.username}</span></td>
                    <td className="px-4 py-2"><span className="dado-sensivel">{u.value}</span></td>
                    <td className="px-4 py-2">{u.plano || '-'}</td>
                    <td className="px-4 py-2"><span className="dado-sensivel">{u.nas || '-'}</span></td>
                    <td className="px-4 py-2">
                      <button onClick={() => handleDeletar(u.username)} className="text-red-600 hover:underline">Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};

export default UsuariosRadius;


