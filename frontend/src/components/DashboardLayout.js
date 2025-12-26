import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Users, MessageSquare, UserPlus, Settings, Activity, Menu, X, Radio, FileText, LogOut, User, Crown, Shield, Store } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import BackgroundBubbles from './BackgroundBubbles';

const DashboardLayout = ({ children }) => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 1024);

  const menuItems = [
    { icon: Home, label: 'Dashboard', path: '/' },
    { icon: Users, label: 'Contas', path: '/accounts' },
    { icon: Store, label: 'Marketplace', path: '/marketplace' },
    { icon: Radio, label: 'Broadcast Grupos', path: '/broadcast-groups' },
    { icon: FileText, label: 'Templates', path: '/templates' },
    { icon: Activity, label: 'Extrair Membros', path: '/extract' },
    { icon: MessageSquare, label: 'Enviar Mensagens', path: '/messages' },
    { icon: UserPlus, label: 'Adicionar ao Grupo', path: '/add-to-group' },
    { icon: Settings, label: 'Logs', path: '/logs' },
    { icon: Crown, label: 'Planos', path: '/plans' },
  ];
  
  // Add admin menu item if user is admin
  if (user?.is_admin) {
    menuItems.push({ icon: Shield, label: 'Admin', path: '/admin' });
  }

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen bg-void text-foreground font-sans">
      <BackgroundBubbles />
      
      {/* Sidebar - otimizado sem blur */}
      <aside
        className={`fixed left-0 top-0 h-full bg-[#0a0a0a] border-r border-white/10 transition-all duration-200 z-50 ${
          sidebarOpen ? 'w-64' : 'w-0'
        } overflow-hidden`}
      >
        <div className="p-6 flex flex-col h-full">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-mono font-bold text-neon tracking-tight">
              TOXIC SYNC
            </h1>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-gray-400 hover:text-neon"
              data-testid="close-sidebar-btn"
            >
              <X size={24} />
            </button>
          </div>
          
          <nav className="space-y-2 flex-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-md transition-all duration-200 ${
                    isActive
                      ? 'bg-neon/10 text-neon border-l-4 border-neon shadow-[0_0_20px_rgba(0,255,65,0.15)]'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon size={20} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          
          {/* User Section */}
          <div className="border-t border-white/10 pt-4 mt-4">
            {user && (
              <div className="flex items-center space-x-3 px-4 py-2 mb-3">
                <div className="bg-neon/20 p-2 rounded-full">
                  <User size={16} className="text-neon" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user.name}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs ${
                    user.plan === 'premium' ? 'bg-yellow-500/20 text-yellow-400' :
                    user.plan === 'basic' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {user.plan === 'premium' && <Crown size={10} className="mr-1" />}
                    {user.plan === 'basic' && <Shield size={10} className="mr-1" />}
                    {(user.plan || 'free').toUpperCase()}
                  </span>
                </div>
              </div>
            )}
            
            <button
              onClick={handleLogout}
              className="flex items-center space-x-3 px-4 py-3 w-full rounded-md text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-all duration-200"
            >
              <LogOut size={20} />
              <span className="font-medium">Sair</span>
            </button>
          </div>
          
          <div className="pt-4 border-t border-white/5 mt-4">
            <div className="text-xs text-gray-600 font-mono">
              <div>Status: <span className="text-neon">ONLINE</span></div>
              <div className="mt-1">v2.0.0</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Menu Button - otimizado */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 z-50 p-3 bg-[#0a0a0a] border border-white/10 rounded-md text-neon"
          data-testid="open-sidebar-btn"
        >
          <Menu size={24} />
        </button>
      )}

      {/* Main Content */}
      <main
        className={`transition-all duration-200 ${
          sidebarOpen ? 'ml-64' : 'ml-0'
        } p-4 md:p-8 min-h-screen`}
      >
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;
