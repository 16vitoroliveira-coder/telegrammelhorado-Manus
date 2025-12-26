import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Activity, MessageSquare, Download, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Logs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const response = await axios.get(`${API}/logs`);
      setLogs(response.data);
    } catch (error) {
      toast.error('Erro ao carregar logs');
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (type) => {
    switch (type) {
      case 'extract':
        return <Download size={18} className="text-blue-400" />;
      case 'message':
        return <MessageSquare size={18} className="text-purple-400" />;
      case 'add_to_group':
        return <UserPlus size={18} className="text-green-400" />;
      default:
        return <Activity size={18} className="text-gray-400" />;
    }
  };

  const getActionLabel = (type) => {
    switch (type) {
      case 'extract':
        return 'Extração';
      case 'message':
        return 'Mensagem';
      case 'add_to_group':
        return 'Adicionar ao Grupo';
      default:
        return type;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'text-neon';
      case 'failed':
        return 'text-red-500';
      case 'in_progress':
        return 'text-yellow-500';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="space-y-8" data-testid="logs-page">
      <div>
        <h1 className="text-4xl font-mono font-bold text-neon tracking-tight mb-2">
          LOGS DE AÇÕES
        </h1>
        <p className="text-gray-400">Histórico de todas as operações realizadas</p>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-neon border-r-transparent"></div>
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-[#111111] border border-white/5 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-lg">Nenhum log ainda</p>
          <p className="text-gray-500 mt-2">Os logs de ações aparecerão aqui</p>
        </div>
      ) : (
        <div className="bg-[#111111] border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-black/50 border-b border-white/5">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Tipo</th>
                  <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Conta</th>
                  <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Alvo</th>
                  <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Detalhes</th>
                  <th className="px-6 py-4 text-left text-sm font-mono text-gray-400">Data</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    data-testid={`log-row-${log.id}`}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        {getActionIcon(log.action_type)}
                        <span className="text-white">{getActionLabel(log.action_type)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400">{log.account_phone}</td>
                    <td className="px-6 py-4 text-gray-400">{log.target}</td>
                    <td className="px-6 py-4">
                      <span className={`font-bold ${getStatusColor(log.status)}`}>
                        {log.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-400">{log.details || '-'}</td>
                    <td className="px-6 py-4 text-gray-400">
                      {new Date(log.created_at).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Logs;