import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Crown, Shield, Search, Check, X, Store, RefreshCw, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const AdminPanel = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('users');

  useEffect(() => {
    if (user?.is_admin) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      
      const [usersRes, purchasesRes] = await Promise.all([
        axios.get(`${API}/admin/users`, { headers }),
        axios.get(`${API}/admin/purchases`, { headers })
      ]);
      
      setUsers(usersRes.data);
      setPurchases(purchasesRes.data.purchases || []);
    } catch (error) {
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const updatePlan = async (userId, plan, days = 30) => {
    setUpdating(userId);
    try {
      const token = localStorage.getItem('token');
      await axios.put(`${API}/admin/users/${userId}/plan?plan=${plan}&days=${days}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(`Plano atualizado para ${plan.toUpperCase()}`);
      fetchData();
    } catch (error) {
      toast.error('Erro ao atualizar plano');
    } finally {
      setUpdating(null);
    }
  };

  const handlePurchaseAction = async (purchaseId, action) => {
    setUpdating(purchaseId);
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API}/admin/purchases/${purchaseId}/${action}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(action === 'approve' ? 'Acesso liberado!' : 'Solicitação rejeitada');
      fetchData();
    } catch (error) {
      toast.error('Erro ao processar solicitação');
    } finally {
      setUpdating(null);
    }
  };

  const syncGroups = async () => {
    setSyncing(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API}/admin/sync-public-groups`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(res.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao sincronizar grupos');
    } finally {
      setSyncing(false);
    }
  };

  if (!user?.is_admin) {
    return <Navigate to="/" replace />;
  }

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.name.toLowerCase().includes(search.toLowerCase())
  );

  const pendingPurchases = purchases.filter(p => p.status === 'pending');

  const getPlanBadge = (plan) => {
    const badges = {
      free: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      basic: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      premium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    };
    return badges[plan] || badges.free;
  };

  const getPlanIcon = (plan) => {
    if (plan === 'premium') return <Crown size={14} className="mr-1" />;
    if (plan === 'basic') return <Shield size={14} className="mr-1" />;
    return null;
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      approved: 'bg-green-500/20 text-green-400 border-green-500/30',
      rejected: 'bg-red-500/20 text-red-400 border-red-500/30'
    };
    return badges[status] || badges.pending;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-mono font-bold text-neon tracking-tight mb-2">
            PAINEL ADMIN
          </h1>
          <p className="text-gray-400">Gerencie usuários, planos e marketplace</p>
        </div>
        <Button
          onClick={syncGroups}
          disabled={syncing}
          className="bg-neon text-black font-bold hover:bg-neon/90"
        >
          {syncing ? <RefreshCw size={18} className="mr-2 animate-spin" /> : <Store size={18} className="mr-2" />}
          {syncing ? 'Sincronizando...' : 'Sincronizar Grupos'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-[#111111] border border-white/5 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Total Usuários</p>
          <p className="text-3xl font-bold text-white">{users.length}</p>
        </div>
        <div className="bg-[#111111] border border-white/5 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Plano Free</p>
          <p className="text-3xl font-bold text-gray-400">{users.filter(u => u.plan === 'free' || !u.plan).length}</p>
        </div>
        <div className="bg-[#111111] border border-white/5 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Plano Básico</p>
          <p className="text-3xl font-bold text-blue-400">{users.filter(u => u.plan === 'basic').length}</p>
        </div>
        <div className="bg-[#111111] border border-white/5 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Plano Premium</p>
          <p className="text-3xl font-bold text-yellow-400">{users.filter(u => u.plan === 'premium').length}</p>
        </div>
        <div className="bg-[#111111] border border-yellow-500/30 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Compras Pendentes</p>
          <p className="text-3xl font-bold text-yellow-400">{pendingPurchases.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'users' 
              ? 'bg-neon/20 text-neon border-b-2 border-neon' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <Users size={18} className="inline mr-2" />
          Usuários ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('purchases')}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'purchases' 
              ? 'bg-neon/20 text-neon border-b-2 border-neon' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <ShoppingCart size={18} className="inline mr-2" />
          Compras Marketplace ({purchases.length})
          {pendingPurchases.length > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-yellow-500 text-black text-xs rounded-full">
              {pendingPurchases.length}
            </span>
          )}
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={20} />
            <Input
              placeholder="Buscar por email ou nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-black/50 border-white/10 focus:border-neon text-white"
            />
          </div>

          {/* Users Table */}
          <div className="bg-[#111111] border border-white/5 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-black/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Usuário</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Plano</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Contas</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Expira</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                        Carregando...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                        Nenhum usuário encontrado
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-white/5">
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-white font-medium">{u.name}</p>
                            <p className="text-sm text-gray-400">{u.email}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${getPlanBadge(u.plan || 'free')}`}>
                            {getPlanIcon(u.plan)}
                            {(u.plan || 'free').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{u.accounts_count || 0}</td>
                        <td className="px-4 py-3 text-gray-400 text-sm">
                          {u.plan_expires_at ? new Date(u.plan_expires_at).toLocaleDateString('pt-BR') : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => updatePlan(u.id, 'free')}
                              disabled={updating === u.id}
                              className="bg-gray-600 hover:bg-gray-700 text-white text-xs px-2 py-1"
                            >
                              Free
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => updatePlan(u.id, 'basic', 30)}
                              disabled={updating === u.id}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1"
                            >
                              Básico
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => updatePlan(u.id, 'premium', 30)}
                              disabled={updating === u.id}
                              className="bg-yellow-600 hover:bg-yellow-700 text-white text-xs px-2 py-1"
                            >
                              Premium
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Purchases Tab */}
      {activeTab === 'purchases' && (
        <div className="bg-[#111111] border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-black/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Usuário</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Valor</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Data</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {purchases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      Nenhuma solicitação de compra
                    </td>
                  </tr>
                ) : (
                  purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-white font-medium">{p.user_name}</p>
                          <p className="text-sm text-gray-400">{p.user_email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-neon font-bold">R$ {p.price?.toFixed(2) || '14.99'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${getStatusBadge(p.status)}`}>
                          {p.status === 'pending' && 'PENDENTE'}
                          {p.status === 'approved' && 'APROVADO'}
                          {p.status === 'rejected' && 'REJEITADO'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-sm">
                        {new Date(p.created_at).toLocaleDateString('pt-BR')} {new Date(p.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handlePurchaseAction(p.id, 'approve')}
                              disabled={updating === p.id}
                              className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1"
                            >
                              <Check size={14} className="mr-1" />
                              Liberar
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handlePurchaseAction(p.id, 'reject')}
                              disabled={updating === p.id}
                              className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1"
                            >
                              <X size={14} className="mr-1" />
                              Rejeitar
                            </Button>
                          </div>
                        )}
                        {p.status === 'approved' && (
                          <span className="text-green-400 text-sm">
                            Liberado em {p.approved_at ? new Date(p.approved_at).toLocaleDateString('pt-BR') : '-'}
                          </span>
                        )}
                        {p.status === 'rejected' && (
                          <span className="text-red-400 text-sm">Rejeitado</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
