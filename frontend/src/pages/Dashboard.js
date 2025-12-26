import React, { useState, useEffect } from 'react';
import { Users, MessageSquare, Activity, TrendingUp, Radio, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    accounts: 0,
    members: 0,
    messages: 0,
    extractions: 0,
    groups: 0,
    templates: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const [accountsRes, membersRes, logsRes, groupsRes, templatesRes] = await Promise.all([
        axios.get(`${API}/accounts`),
        axios.get(`${API}/members`),
        axios.get(`${API}/logs`),
        axios.get(`${API}/groups`),
        axios.get(`${API}/templates`),
      ]);

      const messageLogs = logsRes.data.filter(log => log.action_type === 'message');
      const extractLogs = logsRes.data.filter(log => log.action_type === 'extract');

      setStats({
        accounts: accountsRes.data.length,
        members: membersRes.data.length,
        messages: messageLogs.length,
        extractions: extractLogs.length,
        groups: groupsRes.data.length,
        templates: templatesRes.data.length,
      });
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      icon: Users,
      label: 'Contas Ativas',
      value: stats.accounts,
      color: 'text-neon',
      bg: 'bg-neon/10',
    },
    {
      icon: Radio,
      label: 'Grupos',
      value: stats.groups,
      color: 'text-cyan-400',
      bg: 'bg-cyan-400/10',
    },
    {
      icon: Activity,
      label: 'Membros Extraídos',
      value: stats.members,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
    },
    {
      icon: FileText,
      label: 'Templates',
      value: stats.templates,
      color: 'text-orange-400',
      bg: 'bg-orange-400/10',
    },
    {
      icon: MessageSquare,
      label: 'Mensagens Enviadas',
      value: stats.messages,
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
    },
    {
      icon: TrendingUp,
      label: 'Extrações Realizadas',
      value: stats.extractions,
      color: 'text-yellow-400',
      bg: 'bg-yellow-400/10',
    },
  ];

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div>
        <h1 className="text-4xl md:text-5xl font-mono font-bold text-neon tracking-tight mb-2">
          SALA DE CONTROLE
        </h1>
        <p className="text-gray-400">
          Olá, <span className="text-neon">{user?.name}</span>! Gerencie suas operações do Telegram
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-neon border-r-transparent"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {statCards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div
                key={index}
                data-testid={`stat-card-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}
                className="bg-[#111111] border border-white/5 rounded-xl p-6 hover:border-neon/30 transition-all duration-300"
              >
                <div className={`${stat.bg} ${stat.color} w-12 h-12 rounded-lg flex items-center justify-center mb-4`}>
                  <Icon size={24} />
                </div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">{stat.label}</p>
                  <p className="text-3xl font-mono font-bold text-white">{stat.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link to="/broadcast-groups" className="bg-[#111111] border border-white/10 rounded-xl p-6 hover:border-neon/50 hover:shadow-[0_0_30px_rgba(0,255,65,0.1)] transition-all duration-300 group">
          <div className="flex items-center space-x-4">
            <div className="bg-neon/20 p-4 rounded-xl group-hover:bg-neon/30 transition-all">
              <Radio className="h-8 w-8 text-neon" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-1">Broadcast para Grupos</h3>
              <p className="text-gray-400 text-sm">Envie mensagens para todos os seus grupos de uma vez</p>
            </div>
          </div>
        </Link>

        <Link to="/templates" className="bg-[#111111] border border-white/10 rounded-xl p-6 hover:border-orange-400/50 hover:shadow-[0_0_30px_rgba(251,146,60,0.1)] transition-all duration-300 group">
          <div className="flex items-center space-x-4">
            <div className="bg-orange-400/20 p-4 rounded-xl group-hover:bg-orange-400/30 transition-all">
              <FileText className="h-8 w-8 text-orange-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-1">Templates de Mensagem</h3>
              <p className="text-gray-400 text-sm">Crie e gerencie mensagens prontas para usar</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="bg-[#111111] border border-white/5 rounded-xl p-6">
        <h2 className="text-xl font-mono font-bold text-neon mb-4">INSTRUÇÕES</h2>
        <div className="space-y-3 text-gray-300">
          <p className="flex items-start space-x-2">
            <span className="text-neon font-bold">1.</span>
            <span>Adicione suas contas do Telegram na seção &quot;Contas&quot;</span>
          </p>
          <p className="flex items-start space-x-2">
            <span className="text-neon font-bold">2.</span>
            <span>Atualize a lista de grupos em &quot;Broadcast Grupos&quot;</span>
          </p>
          <p className="flex items-start space-x-2">
            <span className="text-neon font-bold">3.</span>
            <span>Crie templates de mensagens em &quot;Templates&quot;</span>
          </p>
          <p className="flex items-start space-x-2">
            <span className="text-neon font-bold">4.</span>
            <span>Envie mensagens para todos ou grupos selecionados com monitoramento em tempo real</span>
          </p>
          <p className="flex items-start space-x-2">
            <span className="text-neon font-bold">5.</span>
            <span>O sistema respeita os limites do Telegram automaticamente</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
