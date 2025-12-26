import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Messages = () => {
  const [members, setMembers] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [message, setMessage] = useState('');
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);
  const [loading, setLoading] = useState(false);
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

  const handleSendMessages = async (e) => {
    e.preventDefault();
    
    if (selectedMembers.length === 0) {
      toast.error('Selecione pelo menos um membro');
      return;
    }
    
    if (!message.trim()) {
      toast.error('Digite uma mensagem');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/messages/send`, {
        member_ids: selectedMembers,
        message: message,
        delay_min: delayMin,
        delay_max: delayMax,
      });
      toast.success(response.data.message);
      setMessage('');
      setSelectedMembers([]);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao enviar mensagens');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8" data-testid="messages-page">
      <div>
        <h1 className="text-4xl font-mono font-bold text-neon tracking-tight mb-2">
          ENVIAR MENSAGENS
        </h1>
        <p className="text-gray-400">Envie mensagens personalizadas para membros extraídos</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form */}
        <div className="bg-[#111111] border border-white/5 rounded-xl p-6">
          <form onSubmit={handleSendMessages} className="space-y-6">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Mensagem</label>
              <Textarea
                data-testid="message-input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Digite sua mensagem..."
                rows={8}
                className="bg-black/50 border-white/10 focus:border-neon focus:ring-1 focus:ring-neon/50 placeholder:text-gray-600 text-white rounded-md resize-none"
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
            </div>

            <Button
              data-testid="send-messages-btn"
              type="submit"
              disabled={loading}
              className="w-full bg-neon text-black font-bold hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] hover:scale-105 transition-all duration-200 rounded-md disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send size={20} className="mr-2" />
                  Enviar Mensagens
                </>
              )}
            </Button>
          </form>
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

export default Messages;