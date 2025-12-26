import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Accounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [step, setStep] = useState(1); // 1: phone, 2: code
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const response = await axios.get(`${API}/accounts`);
      setAccounts(response.data);
    } catch (error) {
      toast.error('Erro ao carregar contas');
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    try {
      const response = await axios.post(`${API}/auth/send-code`, { phone });
      setPhoneCodeHash(response.data.phone_code_hash);
      setStep(2);
      toast.success('Código enviado para o Telegram!');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao enviar código');
    }
  };

  const handleVerifyCode = async () => {
    try {
      await axios.post(`${API}/auth/verify-code`, {
        phone,
        code,
        phone_code_hash: phoneCodeHash,
      });
      toast.success('Conta adicionada com sucesso!');
      setDialogOpen(false);
      resetForm();
      fetchAccounts();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao verificar código');
    }
  };

  const handleDeleteAccount = async (accountId) => {
    if (!window.confirm('Tem certeza que deseja excluir esta conta?')) return;
    
    try {
      await axios.delete(`${API}/accounts/${accountId}`);
      toast.success('Conta excluída');
      fetchAccounts();
    } catch (error) {
      toast.error('Erro ao excluir conta');
    }
  };

  const resetForm = () => {
    setPhone('');
    setCode('');
    setPhoneCodeHash('');
    setStep(1);
  };

  return (
    <div className="space-y-8" data-testid="accounts-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-mono font-bold text-neon tracking-tight mb-2">
            CONTAS TELEGRAM
          </h1>
          <p className="text-gray-400">Gerencie suas contas para automação</p>
        </div>
        
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button
              data-testid="add-account-btn"
              className="bg-neon text-black font-bold hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] hover:scale-105 transition-all duration-200 rounded-md"
            >
              <Plus size={20} className="mr-2" />
              Adicionar Conta
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-white/10">
            <DialogHeader>
              <DialogTitle className="text-2xl font-mono text-neon">Adicionar Conta</DialogTitle>
            </DialogHeader>
            
            {step === 1 ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Número de Telefone</label>
                  <Input
                    data-testid="phone-input"
                    type="tel"
                    placeholder="+5511999999999"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="bg-black/50 border-white/10 focus:border-neon focus:ring-1 focus:ring-neon/50 placeholder:text-gray-600 text-white rounded-md"
                  />
                </div>
                <Button
                  data-testid="send-code-btn"
                  onClick={handleSendCode}
                  className="w-full bg-neon text-black font-bold hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] transition-all"
                >
                  Enviar Código
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Código de Verificação</label>
                  <Input
                    data-testid="code-input"
                    type="text"
                    placeholder="12345"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="bg-black/50 border-white/10 focus:border-neon focus:ring-1 focus:ring-neon/50 placeholder:text-gray-600 text-white rounded-md"
                  />
                </div>
                <Button
                  data-testid="verify-code-btn"
                  onClick={handleVerifyCode}
                  className="w-full bg-neon text-black font-bold hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] transition-all"
                >
                  Verificar Código
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-neon border-r-transparent"></div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-[#111111] border border-white/5 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-lg">Nenhuma conta adicionada ainda</p>
          <p className="text-gray-500 mt-2">Clique em &quot;Adicionar Conta&quot; para começar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((account) => (
            <div
              key={account.id}
              data-testid={`account-card-${account.id}`}
              className="bg-[#111111] border border-white/5 rounded-xl p-6 hover:border-neon/30 transition-all duration-300"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-2">
                  {account.is_active ? (
                    <CheckCircle size={20} className="text-neon" />
                  ) : (
                    <XCircle size={20} className="text-red-500" />
                  )}
                  <span className="text-sm text-gray-400">
                    {account.is_active ? 'Ativa' : 'Inativa'}
                  </span>
                </div>
                <button
                  data-testid={`delete-account-${account.id}`}
                  onClick={() => handleDeleteAccount(account.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              
              <div>
                <p className="text-lg font-mono font-bold text-white mb-1">{account.phone}</p>
                <p className="text-xs text-gray-500">
                  Adicionada em {new Date(account.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Accounts;