import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Extract = () => {
  const [groupUsername, setGroupUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      const response = await axios.get(`${API}/members`);
      setMembers(response.data);
    } catch (error) {
      toast.error('Erro ao carregar membros');
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleExtract = async (e) => {
    e.preventDefault();
    if (!groupUsername.trim()) {
      toast.error('Digite o username do grupo');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/extract?group_username=${encodeURIComponent(groupUsername)}`);
      toast.success(response.data.message);
      setGroupUsername('');
      fetchMembers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao extrair membros');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMember = async (memberId) => {
    if (!window.confirm('Tem certeza que deseja excluir este membro?')) return;
    
    try {
      await axios.delete(`${API}/members/${memberId}`);
      toast.success('Membro excluído');
      fetchMembers();
    } catch (error) {
      toast.error('Erro ao excluir membro');
    }
  };

  return (
    <div className="space-y-8" data-testid="extract-page">
      <div>
        <h1 className="text-4xl font-mono font-bold text-neon tracking-tight mb-2">
          EXTRAIR MEMBROS
        </h1>
        <p className="text-gray-400">Extraia membros ativos de grupos do Telegram (últimas 48h)</p>
      </div>

      <div className="bg-[#111111] border border-white/5 rounded-xl p-6">
        <form onSubmit={handleExtract} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Username do Grupo (sem @)
            </label>
            <Input
              data-testid="group-username-input"
              type="text"
              placeholder="exemplo: meugrupo"
              value={groupUsername}
              onChange={(e) => setGroupUsername(e.target.value)}
              className="bg-black/50 border-white/10 focus:border-neon focus:ring-1 focus:ring-neon/50 placeholder:text-gray-600 text-white rounded-md"
            />
          </div>
          <Button
            data-testid="extract-btn"
            type="submit"
            disabled={loading}
            className="bg-neon text-black font-bold hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] hover:scale-105 transition-all duration-200 rounded-md disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 size={20} className="mr-2 animate-spin" />
                Extraindo...
              </>
            ) : (
              <>
                <Download size={20} className="mr-2" />
                Extrair Membros Ativos
              </>
            )}
          </Button>
        </form>
      </div>

      <div>
        <h2 className="text-2xl font-mono font-bold text-white mb-4">
          MEMBROS EXTRAÍDOS ({members.length})
        </h2>
        
        {loadingMembers ? (
          <div className="text-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-neon border-r-transparent"></div>
          </div>
        ) : members.length === 0 ? (
          <div className="bg-[#111111] border border-white/5 rounded-xl p-12 text-center">
            <p className="text-gray-400 text-lg">Nenhum membro extraído ainda</p>
            <p className="text-gray-500 mt-2">Extraia membros de um grupo para começar</p>
          </div>
        ) : (
          <div className="bg-[#111111] border border-white/5 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-black/50 border-b border-white/5">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Nome</th>
                    <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Username</th>
                    <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Último Visto</th>
                    <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Grupo</th>
                    <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr
                      key={member.id}
                      data-testid={`member-row-${member.id}`}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-6 py-4 text-white">
                        {member.first_name} {member.last_name}
                      </td>
                      <td className="px-6 py-4 text-gray-400">
                        {member.username ? `@${member.username}` : '-'}
                      </td>
                      <td className="px-6 py-4 text-gray-400">{member.last_seen}</td>
                      <td className="px-6 py-4 text-gray-400">{member.extracted_from}</td>
                      <td className="px-6 py-4">
                        <button
                          data-testid={`delete-member-${member.id}`}
                          onClick={() => handleDeleteMember(member.id)}
                          className="text-red-400 hover:text-red-500 transition-colors"
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Extract;