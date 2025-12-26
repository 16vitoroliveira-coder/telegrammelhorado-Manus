import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import axios from 'axios';
import { FileText, Plus, Trash2, Edit2, Save, X, Loader2, Copy } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Templates = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', content: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const response = await axios.get(`${API}/templates`);
      setTemplates(response.data);
    } catch (error) {
      toast.error('Erro ao carregar templates');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name.trim() || !formData.content.trim()) {
      toast.error('Preencha todos os campos');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await axios.put(`${API}/templates/${editingId}`, formData);
        toast.success('Template atualizado!');
      } else {
        await axios.post(`${API}/templates`, formData);
        toast.success('Template criado!');
      }
      
      fetchTemplates();
      resetForm();
    } catch (error) {
      toast.error('Erro ao salvar template');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (template) => {
    setEditingId(template.id);
    setFormData({ name: template.name, content: template.content });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este template?')) return;
    
    try {
      await axios.delete(`${API}/templates/${id}`);
      toast.success('Template excluído!');
      fetchTemplates();
    } catch (error) {
      toast.error('Erro ao excluir template');
    }
  };

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content);
    toast.success('Mensagem copiada!');
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ name: '', content: '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-mono font-bold text-neon tracking-tight">
            TEMPLATES
          </h1>
          <p className="text-gray-400 mt-1">Mensagens prontas para envio rápido</p>
        </div>
        
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-neon hover:bg-neon/90 text-background font-bold py-2 px-4 rounded-lg flex items-center space-x-2 transition-all"
          >
            <Plus className="h-5 w-5" />
            <span>Novo Template</span>
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-[#111111] border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-mono font-bold text-white">
              {editingId ? 'Editar Template' : 'Novo Template'}
            </h2>
            <button
              onClick={resetForm}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Nome do Template
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-background/50 border border-white/10 rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-neon/50 focus:ring-1 focus:ring-neon/50 transition-all"
                placeholder="Ex: Boas vindas, Promoção..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Conteúdo da Mensagem
              </label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                rows={6}
                className="w-full bg-background/50 border border-white/10 rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-neon/50 focus:ring-1 focus:ring-neon/50 transition-all resize-none"
                placeholder="Digite sua mensagem aqui..."
              />
            </div>
            
            <div className="flex space-x-3">
              <button
                type="submit"
                disabled={saving}
                className="bg-neon hover:bg-neon/90 text-background font-bold py-2 px-6 rounded-lg flex items-center space-x-2 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Save className="h-5 w-5" />
                    <span>Salvar</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-6 rounded-lg transition-all"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-neon border-r-transparent"></div>
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-[#111111] border border-white/10 rounded-xl p-12 text-center">
          <FileText className="h-16 w-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-300 mb-2">Nenhum template</h3>
          <p className="text-gray-500">Crie seu primeiro template de mensagem</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className="bg-[#111111] border border-white/10 rounded-xl p-5 hover:border-neon/30 transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="bg-neon/10 p-2 rounded-lg">
                    <FileText className="h-5 w-5 text-neon" />
                  </div>
                  <h3 className="text-lg font-bold text-white">{template.name}</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleCopy(template.content)}
                    className="p-2 text-gray-400 hover:text-neon hover:bg-neon/10 rounded-lg transition-all"
                    title="Copiar mensagem"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleEdit(template)}
                    className="p-2 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-all"
                    title="Editar"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                    title="Excluir"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-gray-400 whitespace-pre-wrap text-sm bg-background/30 rounded-lg p-3">
                {template.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Templates;
