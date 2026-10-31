import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, UserInfo, TenantInfo } from '../../services/api';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: string;
  onUserLoaded?: (user: UserInfo, tenant: TenantInfo | null) => void;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredRole,
  onUserLoaded,
}) => {
  const location = useLocation();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    const token = api.getToken();
    if (!token) {
      setIsChecking(false);
      setIsAuthenticated(false);
      return;
    }

    // Valida o token e carrega os dados atuais do usuário e tenant
    api
      .getMe()
      .then((res) => {
        setIsAuthenticated(true);
        setCurrentUser(res.user);
        if (onUserLoaded) {
          onUserLoaded(res.user, res.tenant);
        }
      })
      .catch((err) => {
        console.warn('[AuthGuard] Sessão inválida ou expirada:', err);
        api.logout();
        setIsAuthenticated(false);
      })
      .finally(() => {
        setIsChecking(false);
      });
  }, [onUserLoaded]);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-xs font-mono tracking-wider">Verificando Credenciais VeloDesk...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Validação de Role específico (ex: SUPERADMIN)
  if (requiredRole && currentUser) {
    const isSuper =
      currentUser.role === 'SUPERADMIN' || currentUser.role === 'SUPER_ADMIN';
    const hasRequiredRole = currentUser.role === requiredRole || (requiredRole === 'SUPERADMIN' && isSuper);

    if (!hasRequiredRole) {
      // Se não tem permissão para a tela requerida, redireciona para o dashboard
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
};
