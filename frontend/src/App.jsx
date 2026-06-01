import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import ManagerDashboard from './pages/ManagerDashboard';
import UploadInvoice from './pages/UploadInvoice';
import VoucherDetail from './pages/VoucherDetail';
import ManageManagers from './pages/ManageManagers';
import './index.css';

function RequireAuth({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/manager'} replace />;
  return children;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/manager'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ duration: 3500, style: { fontFamily: 'inherit', fontSize: 13 } }} />
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />

          {/* Admin routes */}
          <Route path="/admin" element={<RequireAuth role="admin"><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/vouchers" element={<RequireAuth role="admin"><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/vouchers/new" element={<RequireAuth role="admin"><UploadInvoice /></RequireAuth>} />
          <Route path="/admin/vouchers/:id" element={<RequireAuth role="admin"><VoucherDetail /></RequireAuth>} />
          <Route path="/admin/managers" element={<RequireAuth role="admin"><ManageManagers /></RequireAuth>} />

          {/* Manager routes */}
          <Route path="/manager" element={<RequireAuth role="manager"><ManagerDashboard /></RequireAuth>} />
          <Route path="/manager/vouchers/:id" element={<RequireAuth role="manager"><VoucherDetail /></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
