import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { 
  Send, RefreshCw, Users, CheckCircle, XCircle, Clock, 
  AlertTriangle, Loader2, Radio, Square, CheckSquare,
  FileText, ChevronDown, ChevronUp, Unlock, Zap, Infinity,
  Play, StopCircle, RotateCcw
} from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace('http', 'ws').replace('https', 'wss');

const BroadcastGroups = () => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState({});
  const [message, setMessage] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [selectAll, setSelectAll] = useState(true);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastId, setBroadcastId] = useState(null);
  const [broadcastStatus, setBroadcastStatus] = useState(null);
  const [expandedAccounts, setExpandedAccounts] = useState({});
  const [showTemplates, setShowTemplates] = useState(false);
  const [resettingLocks, setResettingLocks] = useState(false);
  const [continuousMode, setContinuousMode] = useState(true); // Modo contínuo por padrão
  const wsRef = useRef(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (user && broadcasting) {
      connectWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [user, broadcasting]);

  const connectWebSocket = useCallback(() => {
    if (!user) return;
    
    const ws = new WebSocket(`${WS_URL}/ws/broadcast/${user.id}`);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleBroadcastUpdate(data);
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      if (broadcasting) {
        setTimeout(connectWebSocket, 2000);
      }
    };
    
    wsRef.current = ws;
  }, [user, broadcasting]);

  const handleBroadcastUpdate = (data) => {
    setBroadcastStatus(prev => {
      const newStatus = { ...prev };
      
      if (data.type === 'account_status' || data.type === 'message_sent' || 
          data.type === 'flood_wait' || data.type === 'error' || 
          data.type === 'account_complete' || data.type === 'account_error' ||
          data.type === 'round_complete') {
        if (!newStatus.accounts) newStatus.accounts = {};
        newStatus.accounts[data.phone] = data.data;
      }
      
      if (data.type === 'broadcast_complete') {
        setBroadcasting(false);
        toast.success(`🎉 Disparo finalizado! ${data.data?.sent_count || 0} mensagens enviadas`);
        return data.data;
      }
      
      return newStatus;
    });
  };

  const fetchData = async () => {
    try {
      const [accountsRes, groupsRes, templatesRes] = await Promise.all([
        axios.get(`${API}/accounts`),
        axios.get(`${API}/groups`),
        axios.get(`${API}/templates`)
      ]);
      
      setAccounts(accountsRes.data);
      setGroups(groupsRes.data);
      setTemplates(templatesRes.data);
      
      // Initialize expanded state
      const expanded = {};
      accountsRes.data.forEach(acc => {
        expanded[acc.id] = false; // Collapsed by default
      });
      setExpandedAccounts(expanded);
      
    } catch (error) {
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const resetAllLocks = async () => {
    setResettingLocks(true);
    try {
      const response = await axios.post(`${API}/sessions/reset-all-locks`);
      toast.success(response.data.message);
    } catch (error) {
      toast.error('Erro ao resetar locks');
    } finally {
      setResettingLocks(false);
    }
  };

  const refreshAccountGroups = async (accountId) => {
    setRefreshing(prev => ({ ...prev, [accountId]: true }));
    try {
      await axios.get(`${API}/accounts/${accountId}/groups?refresh=true`);
      toast.success('Grupos atualizados!');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar grupos');
    } finally {
      setRefreshing(prev => ({ ...prev, [accountId]: false }));
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedGroups([]);
    } else {
      setSelectedGroups(groups.map(g => g.id));
    }
    setSelectAll(!selectAll);
  };

  const handleSelectGroup = (groupId) => {
    setSelectedGroups(prev => {
      if (prev.includes(groupId)) {
        return prev.filter(id => id !== groupId);
      }
      return [...prev, groupId];
    });
    setSelectAll(false);
  };

  const handleSelectTemplate = (template) => {
    setMessage(template.content);
    setShowTemplates(false);
    toast.success(`Template "${template.name}" selecionado`);
  };

  const startBroadcast = async () => {
    if (!message.trim()) {
      toast.error('Digite uma mensagem');
      return;
    }

    const targetGroups = selectAll ? null : selectedGroups;
    
    if (!selectAll && selectedGroups.length === 0) {
      toast.error('Selecione pelo menos um grupo');
      return;
    }

    // Reset locks before starting to ensure clean state
    try {
      await axios.post(`${API}/sessions/reset-locks`);
    } catch (e) {
      console.log('Lock reset warning:', e);
    }

    setBroadcasting(true);
    setBroadcastStatus({
      status: 'starting',
      accounts: {},
      total_groups: selectAll ? groups.length : selectedGroups.length,
      total_accounts: accounts.length,
      sent_count: 0,
      error_count: 0
    });

    try {
      const response = await axios.post(`${API}/broadcast/groups`, {
        message: message,
        group_ids: targetGroups
      });
      
      setBroadcastId(response.data.broadcast_id);
      toast.success(`Broadcast iniciado: ${response.data.total_groups} grupos em ${response.data.total_accounts} contas`);
      
      // Start polling for status
      pollBroadcastStatus(response.data.broadcast_id);
      
    } catch (error) {
      setBroadcasting(false);
      toast.error(error.response?.data?.detail || 'Erro ao iniciar broadcast');
    }
  };

  const pollBroadcastStatus = async (id) => {
    const poll = async () => {
      if (!broadcasting) return;
      
      try {
        const response = await axios.get(`${API}/broadcast/${id}/status`);
        setBroadcastStatus(response.data);
        
        if (response.data.status === 'completed' || response.data.status === 'cancelled' || response.data.status === 'error') {
          setBroadcasting(false);
          if (response.data.status === 'completed') {
            toast.success(`✅ Broadcast completo! ${response.data.sent_count} mensagens enviadas`);
          }
          return;
        }
        
        setTimeout(poll, 1000);
      } catch (error) {
        console.error('Error polling status:', error);
        setTimeout(poll, 2000);
      }
    };
    
    poll();
  };

  const cancelBroadcast = async () => {
    if (!broadcastId) return;
    
    try {
      await axios.post(`${API}/broadcast/${broadcastId}/cancel`);
      setBroadcasting(false);
      toast.info('Broadcast cancelado');
    } catch (error) {
      toast.error('Erro ao cancelar');
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'connecting':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
      case 'sending':
        return <Radio className="h-4 w-4 text-neon animate-pulse" />;
      case 'flood_wait':
        return <Clock className="h-4 w-4 text-yellow-400" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'connecting': return 'border-blue-400/50 bg-blue-400/10';
      case 'sending': return 'border-neon/50 bg-neon/10';
      case 'flood_wait': return 'border-yellow-400/50 bg-yellow-400/10';
      case 'completed': return 'border-green-400/50 bg-green-400/10';
      case 'error': return 'border-red-400/50 bg-red-400/10';
      default: return 'border-white/10 bg-white/5';
    }
  };

  // Get unique groups count
  const uniqueGroups = [...new Map(groups.map(g => [g.telegram_id, g])).values()];

  const groupsByAccount = accounts.map(account => ({
    ...account,
    groups: groups.filter(g => g.account_id === account.id)
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-neon" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl font-mono font-bold text-neon tracking-tight">
            BROADCAST GRUPOS
          </h1>
          <p className="text-gray-400 mt-1">Envie mensagens para todos os seus grupos</p>
        </div>
        
        <button
          onClick={resetAllLocks}
          disabled={resettingLocks || broadcasting}
          className="bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 font-medium py-2 px-4 rounded-lg flex items-center space-x-2 transition-all disabled:opacity-50 border border-yellow-500/30"
          title="Resetar locks de sessão (usar se houver problemas)"
        >
          {resettingLocks ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unlock className="h-4 w-4" />
          )}
          <span>Reset Locks</span>
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Message Section */}
        <div className="space-y-4">
          <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-mono font-bold text-white">Mensagem</h2>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className="text-sm text-neon hover:text-neon/80 flex items-center space-x-1"
              >
                <FileText className="h-4 w-4" />
                <span>Templates</span>
              </button>
            </div>

            {showTemplates && templates.length > 0 && (
              <div className="mb-4 space-y-2 max-h-40 overflow-y-auto">
                {templates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template)}
                    className="w-full text-left p-3 bg-background/50 rounded-lg hover:bg-neon/10 hover:border-neon/30 border border-white/10 transition-all"
                  >
                    <p className="text-sm font-medium text-white">{template.name}</p>
                    <p className="text-xs text-gray-500 truncate">{template.content}</p>
                  </button>
                ))}
              </div>
            )}

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              disabled={broadcasting}
              className="w-full bg-background/50 border border-white/10 rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-neon/50 focus:ring-1 focus:ring-neon/50 transition-all resize-none disabled:opacity-50"
              placeholder="Digite sua mensagem aqui..."
            />

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center space-x-2 text-sm text-gray-400">
                <button
                  onClick={handleSelectAll}
                  className="flex items-center space-x-1 hover:text-neon transition-colors"
                >
                  {selectAll ? (
                    <CheckSquare className="h-4 w-4 text-neon" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  <span>Todos os grupos ({uniqueGroups.length})</span>
                </button>
              </div>

              {broadcasting ? (
                <button
                  onClick={cancelBroadcast}
                  className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg flex items-center space-x-2 transition-all"
                >
                  <XCircle className="h-5 w-5" />
                  <span>Cancelar</span>
                </button>
              ) : (
                <button
                  onClick={startBroadcast}
                  disabled={!message.trim() || groups.length === 0}
                  className="bg-neon hover:bg-neon/90 text-background font-bold py-2 px-4 rounded-lg flex items-center space-x-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Zap className="h-5 w-5" />
                  <span>Enviar</span>
                </button>
              )}
            </div>
          </div>

          {/* Broadcast Progress */}
          {broadcastStatus && (
            <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
              <h2 className="text-lg font-mono font-bold text-white mb-4">Progresso do Broadcast</h2>
              
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Status</span>
                  <span className={`font-medium ${
                    broadcastStatus.status === 'completed' ? 'text-green-400' :
                    broadcastStatus.status === 'running' ? 'text-neon' :
                    broadcastStatus.status === 'cancelled' ? 'text-red-400' :
                    broadcastStatus.status === 'error' ? 'text-red-400' : 'text-yellow-400'
                  }`}>
                    {broadcastStatus.status === 'completed' ? '✅ Concluído' :
                     broadcastStatus.status === 'running' ? '🚀 Em andamento' :
                     broadcastStatus.status === 'cancelled' ? '❌ Cancelado' :
                     broadcastStatus.status === 'error' ? '⚠️ Erro' : '⏳ Iniciando...'}
                  </span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Contas ativas</span>
                  <span className="text-blue-400 font-mono">{broadcastStatus.total_accounts || accounts.length}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Mensagens enviadas</span>
                  <span className="text-neon font-mono font-bold">{broadcastStatus.sent_count || 0} / {broadcastStatus.total_groups || 0}</span>
                </div>
                
                {broadcastStatus.error_count > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Erros</span>
                    <span className="text-red-400 font-mono">{broadcastStatus.error_count}</span>
                  </div>
                )}

                {/* Progress bar */}
                <div className="w-full bg-background/50 rounded-full h-3 mt-2">
                  <div 
                    className="bg-gradient-to-r from-neon to-green-400 h-3 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${broadcastStatus.total_groups ? 
                        ((broadcastStatus.sent_count || 0) / broadcastStatus.total_groups) * 100 : 0}%` 
                    }}
                  />
                </div>
                
                <p className="text-xs text-gray-500 text-center">
                  {broadcastStatus.total_groups ? 
                    `${Math.round(((broadcastStatus.sent_count || 0) / broadcastStatus.total_groups) * 100)}% completo` : 
                    'Calculando...'}
                </p>
              </div>

              {/* Per-account status */}
              {broadcastStatus.accounts && Object.keys(broadcastStatus.accounts).length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <h3 className="text-sm font-medium text-gray-400 mb-2">Status por conta:</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {Object.entries(broadcastStatus.accounts).map(([phone, status]) => (
                      <div key={phone} className={`p-2 rounded-lg border ${getStatusColor(status.status)}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            {getStatusIcon(status.status)}
                            <span className="text-sm font-mono text-white">{phone}</span>
                          </div>
                          <span className="text-xs font-mono text-neon">
                            {status.sent || 0}/{status.total || 0}
                          </span>
                        </div>
                        {status.current_group && status.status === 'sending' && (
                          <p className="text-xs text-gray-400 mt-1 truncate">
                            ➜ {status.current_group}
                          </p>
                        )}
                        {status.flood_wait && (
                          <p className="text-xs text-yellow-400 mt-1">
                            ⏳ Aguardando {status.flood_wait}s (Flood Wait)
                          </p>
                        )}
                        {status.error && (
                          <p className="text-xs text-red-400 mt-1 truncate">
                            ⚠️ {status.error}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Accounts & Groups Section */}
        <div className="space-y-4">
          <div className="bg-[#111111] border border-white/10 rounded-xl p-5">
            <h2 className="text-lg font-mono font-bold text-white mb-4">
              Contas & Grupos ({accounts.length} contas, {uniqueGroups.length} grupos únicos)
            </h2>

            {accounts.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">Nenhuma conta conectada</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                {groupsByAccount.map(account => {
                  const accountStatus = broadcastStatus?.accounts?.[account.phone];
                  const isExpanded = expandedAccounts[account.id];
                  
                  return (
                    <div 
                      key={account.id}
                      className={`border rounded-xl overflow-hidden transition-all ${
                        accountStatus ? getStatusColor(accountStatus.status) : 'border-white/10 bg-white/5'
                      }`}
                    >
                      {/* Account Header */}
                      <div 
                        className="flex items-center justify-between p-3 cursor-pointer"
                        onClick={() => setExpandedAccounts(prev => ({
                          ...prev,
                          [account.id]: !prev[account.id]
                        }))}
                      >
                        <div className="flex items-center space-x-3">
                          {accountStatus ? (
                            getStatusIcon(accountStatus.status)
                          ) : (
                            <Users className="h-4 w-4 text-gray-400" />
                          )}
                          <div>
                            <p className="text-white font-medium">{account.phone}</p>
                            <p className="text-xs text-gray-500">{account.groups.length} grupos</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          {accountStatus && (
                            <div className="text-xs text-right mr-2">
                              {accountStatus.status === 'flood_wait' && (
                                <span className="text-yellow-400">
                                  Aguardando {accountStatus.flood_wait}s
                                </span>
                              )}
                              {accountStatus.status === 'sending' && accountStatus.current_group && (
                                <span className="text-neon truncate max-w-[150px] block">
                                  {accountStatus.current_group}
                                </span>
                              )}
                              {accountStatus.status === 'completed' && (
                                <span className="text-green-400">
                                  ✓ {accountStatus.sent}/{accountStatus.total}
                                </span>
                              )}
                              {accountStatus.status === 'error' && (
                                <span className="text-red-400">
                                  ✗ Erro
                                </span>
                              )}
                            </div>
                          )}
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              refreshAccountGroups(account.id);
                            }}
                            disabled={refreshing[account.id] || broadcasting}
                            className="p-1.5 text-gray-400 hover:text-neon hover:bg-neon/10 rounded-lg transition-all disabled:opacity-50"
                            title="Atualizar grupos"
                          >
                            <RefreshCw className={`h-4 w-4 ${refreshing[account.id] ? 'animate-spin' : ''}`} />
                          </button>
                          
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          )}
                        </div>
                      </div>

                      {/* Groups List */}
                      {isExpanded && account.groups.length > 0 && (
                        <div className="border-t border-white/10 p-2 space-y-1 max-h-48 overflow-y-auto">
                          {account.groups.map(group => (
                            <label
                              key={group.id}
                              className={`flex items-center space-x-2 p-2 rounded-lg cursor-pointer transition-all ${
                                selectedGroups.includes(group.id) || selectAll
                                  ? 'bg-neon/10 text-white'
                                  : 'hover:bg-white/5 text-gray-400'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectAll || selectedGroups.includes(group.id)}
                                onChange={() => handleSelectGroup(group.id)}
                                disabled={broadcasting}
                                className="rounded border-gray-600 text-neon focus:ring-neon/50 bg-background/50"
                              />
                              <span className="text-sm truncate">{group.title}</span>
                              {group.is_channel && (
                                <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">
                                  Canal
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}

                      {isExpanded && account.groups.length === 0 && (
                        <div className="border-t border-white/10 p-4 text-center">
                          <p className="text-gray-500 text-sm">Clique em atualizar para carregar os grupos</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BroadcastGroups;
