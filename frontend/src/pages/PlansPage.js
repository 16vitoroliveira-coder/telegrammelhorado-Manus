import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Crown, Shield, User, Check, X, Copy, CheckCircle } from 'lucide-react';
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

// Função para gerar payload PIX Copia e Cola
const generatePixPayload = (pixKey, value, merchantName = 'VITOR OLIVEIRA') => {
  // Formata um campo TLV (Tag-Length-Value)
  const formatField = (id, value) => {
    const len = value.length.toString().padStart(2, '0');
    return `${id}${len}${value}`;
  };

  // ID 00 - Payload Format Indicator (fixo "01")
  const payloadFormat = formatField('00', '01');
  
  // ID 26 - Merchant Account Information (PIX)
  const gui = formatField('00', 'br.gov.bcb.pix'); // GUI do PIX
  const chavePix = formatField('01', pixKey); // Chave PIX (CPF)
  const merchantAccountInfo = formatField('26', gui + chavePix);
  
  // ID 52 - Merchant Category Code (0000 = não informado)
  const mcc = formatField('52', '0000');
  
  // ID 53 - Transaction Currency (986 = BRL)
  const currency = formatField('53', '986');
  
  // ID 54 - Transaction Amount
  const amount = formatField('54', value.toFixed(2));
  
  // ID 58 - Country Code
  const country = formatField('58', 'BR');
  
  // ID 59 - Merchant Name (máx 25 caracteres)
  const name = formatField('59', merchantName.substring(0, 25).toUpperCase());
  
  // ID 60 - Merchant City (máx 15 caracteres)
  const city = formatField('60', 'SAO PAULO');
  
  // ID 62 - Additional Data Field (opcional - txid)
  const txid = formatField('05', '***'); // TXID dinâmico
  const additionalData = formatField('62', txid);

  // Monta o payload sem o CRC
  let payload = payloadFormat + merchantAccountInfo + mcc + currency + amount + country + name + city + additionalData;
  
  // Adiciona o campo CRC (ID 63, tamanho 04)
  payload += '6304';
  
  // Calcula e adiciona o CRC
  const crc = crc16ccitt(payload);
  
  return payload + crc;
};

const PlansPage = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [copied, setCopied] = useState(false);
  const pixKey = '08053511597'; // Chave PIX CPF

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const response = await axios.get(`${API}/plans`);
      setPlans(response.data.plans);
    } catch (error) {
      console.error('Erro ao carregar planos');
    }
  };

  const copyPixCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('Código PIX copiado!');
    setTimeout(() => setCopied(false), 3000);
  };

  const getPlanIcon = (planId) => {
    if (planId === 'premium') return <Crown className="text-yellow-400" size={32} />;
    if (planId === 'basic') return <Shield className="text-blue-400" size={32} />;
    return <User className="text-gray-400" size={32} />;
  };

  const getPlanBorder = (planId) => {
    if (planId === 'premium') return 'border-yellow-500/50 hover:border-yellow-500';
    if (planId === 'basic') return 'border-blue-500/50 hover:border-blue-500';
    return 'border-white/10 hover:border-white/30';
  };

  const isCurrentPlan = (planId) => {
    return (user?.plan || 'free') === planId;
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-mono font-bold text-neon tracking-tight mb-2">
          PLANOS
        </h1>
        <p className="text-gray-400">Escolha o plano ideal para suas necessidades</p>
        {user && (
          <p className="mt-2 text-sm">
            Seu plano atual: <span className="text-neon font-bold">{(user.plan || 'free').toUpperCase()}</span>
          </p>
        )}
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`bg-[#111111] border-2 ${getPlanBorder(plan.id)} rounded-xl p-6 transition-all duration-300 ${
              isCurrentPlan(plan.id) ? 'ring-2 ring-neon' : ''
            }`}
          >
            <div className="text-center mb-6">
              <div className="flex justify-center mb-3">
                {getPlanIcon(plan.id)}
              </div>
              <h2 className="text-2xl font-bold text-white">{plan.name}</h2>
              <p className="text-3xl font-bold mt-2">
                {plan.price === 0 ? (
                  <span className="text-gray-400">Grátis</span>
                ) : (
                  <span className="text-neon">R$ {plan.price.toFixed(2)}<span className="text-sm text-gray-400">/mês</span></span>
                )}
              </p>
              {isCurrentPlan(plan.id) && (
                <span className="inline-block mt-2 px-3 py-1 bg-neon/20 text-neon rounded-full text-xs">
                  PLANO ATUAL
                </span>
              )}
            </div>

            <ul className="space-y-3 mb-6">
              {plan.features.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  {feature.startsWith('❌') ? (
                    <X size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                  ) : feature.startsWith('✨') ? (
                    <Crown size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <Check size={16} className="text-neon mt-0.5 flex-shrink-0" />
                  )}
                  <span className="text-gray-300">{feature.replace('❌ ', '').replace('✨ ', '')}</span>
                </li>
              ))}
              {/* Suporte para planos pagos */}
              {(plan.id === 'basic' || plan.id === 'premium') && (
                <li className="flex items-start gap-2 text-sm">
                  <Check size={16} className="text-neon mt-0.5 flex-shrink-0" />
                  <span className="text-gray-300">Suporte via Telegram e WhatsApp</span>
                </li>
              )}
            </ul>

            {plan.price > 0 && !isCurrentPlan(plan.id) && (
              <Button
                onClick={() => setSelectedPlan(plan)}
                className={`w-full ${
                  plan.id === 'premium' 
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-black' 
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                } font-bold`}
              >
                Assinar {plan.name}
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* PIX Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111111] border border-white/10 rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="text-center">
              <h3 className="text-xl font-bold text-white mb-2">
                Pagamento via PIX
              </h3>
              <p className="text-gray-400 mb-4">
                Plano {selectedPlan.name} - <span className="text-neon font-bold">R$ {selectedPlan.price.toFixed(2)}</span>
              </p>

              {/* QR Code usando img com API externa */}
              <div className="bg-white p-4 rounded-lg inline-block mb-4">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(generatePixPayload(pixKey, selectedPlan.price))}`}
                  alt="QR Code PIX"
                  width={200}
                  height={200}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'block';
                  }}
                />
                <div style={{display: 'none'}} className="text-gray-500 text-sm p-4">
                  QR Code não disponível. Use o código Copia e Cola abaixo.
                </div>
              </div>

              {/* PIX Copia e Cola */}
              <div className="bg-black/50 border border-white/10 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-400 mb-2">PIX Copia e Cola:</p>
                <div className="bg-black/50 p-3 rounded border border-white/5 mb-3 max-h-24 overflow-y-auto">
                  <code className="text-neon font-mono text-xs break-all select-all">
                    {generatePixPayload(pixKey, selectedPlan.price)}
                  </code>
                </div>
                <Button
                  onClick={() => copyPixCode(generatePixPayload(pixKey, selectedPlan.price))}
                  className="w-full bg-neon text-black font-bold hover:bg-neon/90"
                >
                  {copied ? <CheckCircle size={18} className="mr-2" /> : <Copy size={18} className="mr-2" />}
                  {copied ? 'Copiado!' : 'Copiar Código PIX'}
                </Button>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                Após o pagamento, seu plano é liberado automaticamente.
              </p>

              <Button
                variant="ghost"
                onClick={() => setSelectedPlan(null)}
                className="text-gray-400 hover:text-white"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlansPage;
