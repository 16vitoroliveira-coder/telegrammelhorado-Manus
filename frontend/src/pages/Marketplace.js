import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Store, Users, Lock, Unlock, ExternalLink, LogIn, Copy, CheckCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Função para calcular CRC16 CCITT-FALSE (padrão PIX)
const crc16ccitt = (str) => {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

// Função para gerar payload PIX
const generatePixPayload = (pixKey, value) => {
  const formatField = (id, value) => {
    const len = value.length.toString().padStart(2, '0');
    return `${id}${len}${value}`;
  };

  const payloadFormat = formatField('00', '01');
  const gui = formatField('00', 'br.gov.bcb.pix');
  const chavePix = formatField('01', pixKey);
  const merchantAccountInfo = formatField('26', gui + chavePix);
  const mcc = formatField('52', '0000');
  const currency = formatField('53', '986');
  const amount = formatField('54', value.toFixed(2));
  const country = formatField('58', 'BR');
  const name = formatField('59', 'VITOR OLIVEIRA');
  const city = formatField('60', 'SAO PAULO');
  const txid = formatField('05', '***');
  const additionalData = formatField('62', txid);

  let payload = payloadFormat + merchantAccountInfo + mcc + currency + amount + country + name + city + additionalData;
  payload += '6304';
  const crc = crc16ccitt(payload);
  
  return payload + crc;
};

const Marketplace = () => {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [hasAccess, setHasAccess] = useState(false);
  const [purchase, setPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joiningGroup, setJoiningGroup] = useState(null);
  const price = 14.99;
  const pixKey = '08053511597';

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const [groupsRes, purchaseRes] = await Promise.all([
        axios.get(`${API}/marketplace/groups`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API}/marketplace/my-purchase`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      
      setGroups(groupsRes.data.groups || []);
      setHasAccess(groupsRes.data.has_access);
      setPurchase(purchaseRes.data.purchase);
    } catch (error) {
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API}/marketplace/purchase`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Solicitação enviada! Faça o pagamento via PIX.');
      setShowPayment(true);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao solicitar compra');
    }
  };

  const handleJoinGroup = async (group) => {
    try {
      setJoiningGroup(group.id);
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API}/marketplace/join-group/${group.id}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(res.data.message);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao entrar no grupo');
    } finally {
      setJoiningGroup(null);
    }
  };

  const copyPixCode = () => {
    const pixCode = generatePixPayload(pixKey, price);
    navigator.clipboard.writeText(pixCode);
    setCopied(true);
    toast.success('Código PIX copiado!');
    setTimeout(() => setCopied(false), 3000);
  };

  const copyLink = (group) => {
    const link = group.username ? `https://t.me/${group.username}` : group.invite_link;
    if (link) {
      navigator.clipboard.writeText(link);
      toast.success('Link copiado!');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-neon"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold text-neon tracking-tight flex items-center gap-3">
            <Store size={32} />
            MARKETPLACE DE GRUPOS
          </h1>
          <p className="text-gray-400 mt-1">
            {groups.length} grupos disponíveis
          </p>
        </div>
        <Button
          onClick={fetchData}
          variant="outline"
          className="border-white/20 text-gray-300"
        >
          <RefreshCw size={18} className="mr-2" />
          Atualizar
        </Button>
      </div>

      {/* Access Status Card */}
      <div className={`p-6 rounded-xl border ${hasAccess ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {hasAccess ? (
              <Unlock className="text-green-400" size={32} />
            ) : (
              <Lock className="text-yellow-400" size={32} />
            )}
            <div>
              <h2 className="text-xl font-bold text-white">
                {hasAccess ? 'Acesso Liberado!' : 'Acesso Bloqueado'}
              </h2>
              <p className="text-gray-400">
                {hasAccess 
                  ? 'Você tem acesso a todos os grupos e links de convite.' 
                  : purchase?.status === 'pending'
                    ? 'Sua solicitação está aguardando aprovação do admin.'
                    : `Compre acesso por apenas R$ ${price.toFixed(2)} para ver todos os links.`
                }
              </p>
            </div>
          </div>
          
          {!hasAccess && !purchase && (
            <Button
              onClick={() => setShowPayment(true)}
              className="bg-neon text-black font-bold hover:bg-neon/90"
            >
              Comprar Acesso - R$ {price.toFixed(2)}
            </Button>
          )}
          
          {purchase?.status === 'pending' && (
            <span className="px-4 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg font-bold">
              Aguardando Aprovação
            </span>
          )}
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && !hasAccess && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111111] border border-white/10 rounded-xl p-6 max-w-md w-full">
            <div className="text-center">
              <h3 className="text-xl font-bold text-white mb-2">
                Pagamento via PIX
              </h3>
              <p className="text-gray-400 mb-4">
                Acesso aos Grupos - <span className="text-neon font-bold">R$ {price.toFixed(2)}</span>
              </p>

              {/* QR Code */}
              <div className="bg-white p-4 rounded-lg inline-block mb-4">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(generatePixPayload(pixKey, price))}`}
                  alt="QR Code PIX"
                  width={200}
                  height={200}
                />
              </div>

              {/* PIX Copia e Cola */}
              <div className="bg-black/50 border border-white/10 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-400 mb-2">PIX Copia e Cola:</p>
                <div className="bg-black/50 p-3 rounded border border-white/5 mb-3 max-h-24 overflow-y-auto">
                  <code className="text-neon font-mono text-xs break-all select-all">
                    {generatePixPayload(pixKey, price)}
                  </code>
                </div>
                <Button
                  onClick={copyPixCode}
                  className="w-full bg-neon text-black font-bold hover:bg-neon/90"
                >
                  {copied ? <CheckCircle size={18} className="mr-2" /> : <Copy size={18} className="mr-2" />}
                  {copied ? 'Copiado!' : 'Copiar Código PIX'}
                </Button>
              </div>

              {!purchase && (
                <Button
                  onClick={handlePurchase}
                  className="w-full bg-blue-500 text-white font-bold hover:bg-blue-600 mb-3"
                >
                  Já fiz o pagamento - Solicitar Acesso
                </Button>
              )}
              
              {purchase?.status === 'pending' && (
                <p className="text-yellow-400 text-sm mb-3">
                  ✓ Solicitação enviada! Aguarde a aprovação do admin.
                </p>
              )}

              <p className="text-xs text-gray-500 mb-4">
                Após o pagamento, seu acesso é liberado automaticamente.
              </p>

              <Button
                variant="ghost"
                onClick={() => setShowPayment(false)}
                className="text-gray-400 hover:text-white"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Groups Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((group) => (
          <div
            key={group.id}
            className="bg-[#111111] border border-white/10 rounded-xl p-4 hover:border-neon/50 transition-all"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <h3 className="text-white font-bold truncate">{group.title}</h3>
                <p className="text-gray-500 text-sm">
                  {group.is_channel ? 'Canal' : group.is_megagroup ? 'Supergrupo' : 'Grupo'}
                </p>
              </div>
              <Users className="text-gray-500" size={20} />
            </div>

            {group.participants_count && (
              <p className="text-gray-400 text-sm mb-3">
                {group.participants_count.toLocaleString()} membros
              </p>
            )}

            {hasAccess ? (
              <div className="space-y-2">
                {(group.username || group.invite_link) && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => copyLink(group)}
                      variant="outline"
                      size="sm"
                      className="flex-1 border-white/20 text-gray-300 text-xs"
                    >
                      <Copy size={14} className="mr-1" />
                      Copiar Link
                    </Button>
                    <Button
                      onClick={() => window.open(group.username ? `https://t.me/${group.username}` : group.invite_link, '_blank')}
                      variant="outline"
                      size="sm"
                      className="flex-1 border-white/20 text-gray-300 text-xs"
                    >
                      <ExternalLink size={14} className="mr-1" />
                      Abrir
                    </Button>
                  </div>
                )}
                <Button
                  onClick={() => handleJoinGroup(group)}
                  disabled={joiningGroup === group.id}
                  className="w-full bg-neon/20 text-neon hover:bg-neon/30 text-xs"
                  size="sm"
                >
                  {joiningGroup === group.id ? (
                    <RefreshCw size={14} className="mr-1 animate-spin" />
                  ) : (
                    <LogIn size={14} className="mr-1" />
                  )}
                  Entrar Automaticamente
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-center p-3 bg-black/30 rounded-lg">
                <Lock size={16} className="text-gray-500 mr-2" />
                <span className="text-gray-500 text-sm">Link bloqueado</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {groups.length === 0 && (
        <div className="text-center py-12">
          <Store className="mx-auto text-gray-600 mb-4" size={48} />
          <p className="text-gray-500">Nenhum grupo disponível no momento.</p>
          <p className="text-gray-600 text-sm">O admin precisa sincronizar os grupos primeiro.</p>
        </div>
      )}
    </div>
  );
};

export default Marketplace;
