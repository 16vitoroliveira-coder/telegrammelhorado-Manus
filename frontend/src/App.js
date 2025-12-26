import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import DashboardLayout from './components/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Extract from './pages/Extract';
import Messages from './pages/Messages';
import AddToGroup from './pages/AddToGroup';
import Logs from './pages/Logs';
import Login from './pages/Login';
import Register from './pages/Register';
import Templates from './pages/Templates';
import BroadcastGroups from './pages/BroadcastGroups';
import PlansPage from './pages/PlansPage';
import AdminPanel from './pages/AdminPanel';
import Marketplace from './pages/Marketplace';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-neon border-r-transparent"></div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return children;
};

// Public Route Component (redirect to dashboard if logged in)
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-neon border-r-transparent"></div>
      </div>
    );
  }
  
  if (user) {
    return <Navigate to="/" replace />;
  }
  
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={
        <PublicRoute>
          <Login />
        </PublicRoute>
      } />
      <Route path="/register" element={
        <PublicRoute>
          <Register />
        </PublicRoute>
      } />
      
      {/* Protected Routes */}
      <Route path="/" element={
        <ProtectedRoute>
          <DashboardLayout>
            <Dashboard />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/accounts" element={
        <ProtectedRoute>
          <DashboardLayout>
            <Accounts />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/extract" element={
        <ProtectedRoute>
          <DashboardLayout>
            <Extract />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/messages" element={
        <ProtectedRoute>
          <DashboardLayout>
            <Messages />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/add-to-group" element={
        <ProtectedRoute>
          <DashboardLayout>
            <AddToGroup />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/logs" element={
        <ProtectedRoute>
          <DashboardLayout>
            <Logs />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/templates" element={
        <ProtectedRoute>
          <DashboardLayout>
            <Templates />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/broadcast-groups" element={
        <ProtectedRoute>
          <DashboardLayout>
            <BroadcastGroups />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/plans" element={
        <ProtectedRoute>
          <DashboardLayout>
            <PlansPage />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/admin" element={
        <ProtectedRoute>
          <DashboardLayout>
            <AdminPanel />
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/marketplace" element={
        <ProtectedRoute>
          <DashboardLayout>
            <Marketplace />
          </DashboardLayout>
        </ProtectedRoute>
      } />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0a0a0a',
            border: '1px solid rgba(0, 255, 65, 0.3)',
            color: '#e0e0e0',
          },
        }}
      />
    </div>
  );
}

export default App;
