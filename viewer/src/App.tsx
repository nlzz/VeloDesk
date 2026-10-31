import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './components/auth/LoginPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { SuperAdminDashboard } from './components/admin/SuperAdminDashboard';
import { OfficeDashboard } from './components/dashboard/OfficeDashboard';
import { api } from './services/api';

/**
 * Guarda e Roteador Raiz:
 * Analisa a sessão atual do JWT no localStorage e redireciona:
 * - Sem token ou inválido -> /login
 * - Papel SUPERADMIN -> /admin
 * - Outros papéis (ADMIN, TECHNICIAN) -> /dashboard
 */
const RootRedirect: React.FC = () => {
  const [isChecking, setIsChecking] = useState(true);
  const [destination, setDestination] = useState<string>('/login');

  useEffect(() => {
    const token = api.getToken();
    if (!token) {
      setDestination('/login');
      setIsChecking(false);
      return;
    }

    api
      .getMe()
      .then((res) => {
        if (res.user.role === 'SUPERADMIN' || res.user.role === 'SUPER_ADMIN') {
          setDestination('/admin');
        } else {
          setDestination('/dashboard');
        }
      })
      .catch(() => {
        api.logout();
        setDestination('/login');
      })
      .finally(() => {
        setIsChecking(false);
      });
  }, []);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-xs font-mono tracking-wider">Carregando VeloDesk...</span>
      </div>
    );
  }

  return <Navigate to={destination} replace />;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rota Raiz: Auth Guard Compulsório */}
        <Route path="/" element={<RootRedirect />} />

        {/* Tela de Login Elegante */}
        <Route path="/login" element={<LoginPage />} />

        {/* Painel Administrativo Master (Super-Admin) */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="SUPERADMIN">
              <SuperAdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* Painel do Escritório (Dashboard de Técnicos e Administradores) */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <OfficeDashboard />
            </ProtectedRoute>
          }
        />

        {/* Rota do Viewer Integrado (Acesso Direto Protegido) */}
        <Route
          path="/viewer"
          element={
            <ProtectedRoute>
              <OfficeDashboard defaultTab="direct" />
            </ProtectedRoute>
          }
        />

        {/* Qualquer outra rota redireciona para a raiz */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
