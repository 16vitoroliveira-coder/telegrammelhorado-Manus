import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { UserPlus, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const AddToGroup = () => {
  const [members, setMembers] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [groupUsername, setGroupUsername] = useState('');
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);
  const [loading, setLoading] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [results, setResults] = useState(null);

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

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedMembers(members.map(m => m.id));
    } else {
      setSelectedMembers([]);
    }
  };

  const handleSelectMember = (memberId, checked) => {
    if (checked) {
      setSelectedMembers([...selectedMembers, memberId]);
    } else {
      setSelectedMembers(selectedMembers.filter(id => id !== memberId));
    }
  };

  const [abortController, setAbortController] = useState(null);

  const handleAddToGroup = async (e) => {
    e.preventDefault();
    
    if (selectedMembers.length === 0) {
      toast.error('Selecione pelo menos um membro');
      return;
    }
    
    if (!groupUsername.trim()) {
      toast.error('Digite o username do grupo');
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);
    setLoading(true);
    setResults(null);
    
    try {
      const response = await axios.post(`${API}/members/add-to-group`, {
        member_ids: selectedMembers,
        group_username: groupUsername,
        delay_min: delayMin,
        delay_max: delayMax,
      }, { signal: controller.signal });
      
      // Mostra resultados detalhados
      setResults(response.data);
      
      if (response.data.group_banned) {
        toast.error('🚫 GRUPO BANIDO: Você foi banido ou não tem permissão neste grupo!');
      } else if (response.data.added > 0) {
        toast.success(`✅ ${response.data.added} membros adicionados com sucesso!`);
      } else {
        toast.warning('Nenhum membro foi adicionado');
      }
      
      setSelectedMembers([]);
    } catch (error) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        toast.info('Operação cancelada');
        return;
      }
      const errorMsg = error.response?.data?.detail || 'Erro ao adicionar membros';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  const handleCancel = () => {
    if (abortController) {
      abortController.abort();
      setLoading(false);
      setAbortController(null);
      toast.info('Operação cancelada pelo usuário');
    }
  };


  return (
    <div className="space-y-8" data-testid="add-to-group-page">
      <div>
        <h1 className="text-4xl font-mono font-bold text-neon tracking-tight mb-2">
          ADICIONAR AO GRUPO
        </h1>
        <p className="text-gray-400">Adicione membros extraídos ao seu grupo do Telegram</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form */}
        <div className="bg-[#111111] border border-white/5 rounded-xl p-6">
          <form onSubmit={handleAddToGroup} className="space-y-6">
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Delay Mínimo (s)</label>
                <input
                  data-testid="delay-min-input"
                  type="number"
                  value={delayMin}
                  onChange={(e) => setDelayMin(parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-black/50 border border-white/10 focus:border-neon focus:ring-1 focus:ring-neon/50 text-white rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Delay Máximo (s)</label>
                <input
                  data-testid="delay-max-input"
                  type="number"
                  value={delayMax}
                  onChange={(e) => setDelayMax(parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-black/50 border border-white/10 focus:border-neon focus:ring-1 focus:ring-neon/50 text-white rounded-md"
                />
              </div>
            </div>

            <div className="bg-black/30 border border-white/5 rounded-md p-4">
              <p className="text-sm text-gray-400">
                <span className="text-neon font-bold">{selectedMembers.length}</span> membros selecionados
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Os membros serão adicionados com delays entre {delayMin}s e {delayMax}s para evitar FloodWait
              </p>
            </div>

            <Button
              data-testid="add-to-group-btn"
              type="submit"
              disabled={loading}
              className="w-full bg-neon text-black font-bold hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] hover:scale-105 transition-all duration-200 rounded-md disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="mr-2 animate-spin" />
                  Adicionando...
                </>
              ) : (
                <>
                  <UserPlus size={20} className="mr-2" />
                  Adicionar ao Grupo
                </>
              )}
            </Button>
            
            {loading && (
              <Button
                type="button"
                onClick={handleCancel}
                className="w-full mt-3 bg-red-600 text-white font-bold hover:bg-red-700 hover:shadow-[0_0_20px_rgba(255,0,0,0.4)] transition-all duration-200 rounded-md"
              >
                <XCircle size={20} className="mr-2" />
                Encerrar Operação
              </Button>
            )}
          </form>
          
          {/* Resultados */}
          {results && (
            <div className="mt-6 p-4 bg-black/50 border border-white/10 rounded-lg">
              <h3 className="text-lg font-bold text-white mb-3">
                Resultado da Operação
              </h3>
              
              {results.group_banned && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-md">
                  <p className="text-red-400 font-bold flex items-center gap-2">
                    <AlertTriangle size={18} />
                    🚫 GRUPO BANIDO/SEM PERMISSÃO
                  </p>
                  <p className="text-red-300 text-sm mt-1">
                    Você foi banido deste grupo ou não tem permissão para adicionar membros.
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-md text-center">
                  <p className="text-2xl font-bold text-green-400">{results.added}</p>
                  <p className="text-sm text-green-300">Adicionados ✅</p>
                </div>
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-md text-center">
                  <p className="text-2xl font-bold text-red-400">{results.failed}</p>
                  <p className="text-sm text-red-300">Falhas ❌</p>
                </div>
              </div>
              
              {results.results && results.results.length > 0 && (
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {results.results.map((r, idx) => (
                    <div 
                      key={idx}
                      className={`flex items-center justify-between p-2 rounded-md text-sm ${
                        r.status === 'success' 
                          ? 'bg-green-500/10 border border-green-500/20' 
                          : 'bg-red-500/10 border border-red-500/20'
                      }`}
                    >
                      <span className="text-gray-300">{r.member}</span>
                      <span className={r.status === 'success' ? 'text-green-400' : 'text-red-400'}>
                        {r.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Members List */}
        <div className="bg-[#111111] border border-white/5 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-mono font-bold text-white">MEMBROS</h2>
            <div className="flex items-center space-x-2">
              <Checkbox
                data-testid="select-all-checkbox"
                id="select-all"
                checked={selectedMembers.length === members.length && members.length > 0}
                onCheckedChange={handleSelectAll}
                className="border-white/20 data-[state=checked]:bg-neon data-[state=checked]:border-neon"
              />
              <Label htmlFor="select-all" className="text-sm text-gray-400 cursor-pointer">
                Selecionar todos
              </Label>
            </div>
          </div>

          {loadingMembers ? (
            <div className="text-center py-12">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-neon border-r-transparent"></div>
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400">Nenhum membro extraído</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {members.map((member) => (
                <div
                  key={member.id}
                  data-testid={`member-checkbox-${member.id}`}
                  className="flex items-center space-x-3 p-3 bg-black/30 border border-white/5 rounded-md hover:border-neon/30 transition-colors"
                >
                  <Checkbox
                    checked={selectedMembers.includes(member.id)}
                    onCheckedChange={(checked) => handleSelectMember(member.id, checked)}
                    className="border-white/20 data-[state=checked]:bg-neon data-[state=checked]:border-neon"
                  />
                  <div className="flex-1">
                    <p className="text-white font-medium">
                      {member.first_name} {member.last_name}
                    </p>
                    <p className="text-sm text-gray-400">
                      {member.username ? `@${member.username}` : `ID: ${member.user_id}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddToGroup;