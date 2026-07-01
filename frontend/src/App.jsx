import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import VoucherList from './pages/VoucherList';
import ManagerDashboard from './pages/ManagerDashboard';
import UploadInvoice from './pages/UploadInvoice';
import VoucherDetail from './pages/VoucherDetail';
import ManageManagers from './pages/ManageManagers';
import SupplierMaster from './pages/SupplierMaster';
import SupplierApprovals from './pages/SupplierApprovals';
import ChangePassword from './pages/ChangePassword';
import CompanyDetails from './pages/CompanyDetails';
import MasterUpload from './pages/MasterUpload';
import BillList from './pages/BillList';
import BillDetail from './pages/BillDetail';
import PaymentStatus from './pages/PaymentStatus';
import ParameterMaster from './pages/ParameterMaster';
import './index.css';

function roleHome(role) {
  if (role === 'admin')     return '/admin';
  if (role === 'executive') return '/executive';
  if (role === 'approver')  return '/approver/vouchers';
  return '/manager';
}

function RequireAuth({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={roleHome(user.role)} replace />;
  return children;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(user.role)} replace />;
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
          <Route path="/admin" element={<RequireAuth roles={['admin']}><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/vouchers" element={<RequireAuth roles={['admin']}><VoucherList /></RequireAuth>} />
          <Route path="/admin/vouchers/:id" element={<RequireAuth roles={['admin']}><VoucherDetail /></RequireAuth>} />
          <Route path="/admin/managers" element={<RequireAuth roles={['admin']}><ManageManagers /></RequireAuth>} />
          <Route path="/admin/suppliers" element={<RequireAuth roles={['admin']}><SupplierMaster /></RequireAuth>} />
          <Route path="/admin/master-upload" element={<RequireAuth roles={['admin']}><MasterUpload /></RequireAuth>} />
          <Route path="/admin/company" element={<RequireAuth roles={['admin']}><CompanyDetails /></RequireAuth>} />
          <Route path="/admin/parameters" element={<RequireAuth roles={['admin']}><ParameterMaster /></RequireAuth>} />
          <Route path="/admin/bills"     element={<RequireAuth roles={['admin']}><BillList /></RequireAuth>} />
          <Route path="/admin/bills/:id" element={<RequireAuth roles={['admin']}><BillDetail /></RequireAuth>} />
          <Route path="/admin/payment-status" element={<RequireAuth roles={['admin']}><PaymentStatus /></RequireAuth>} />
          <Route path="/admin/change-password" element={<RequireAuth roles={['admin']}><ChangePassword /></RequireAuth>} />

          {/* Manager routes */}
          <Route path="/manager" element={<RequireAuth roles={['manager']}><ManagerDashboard /></RequireAuth>} />
          <Route path="/manager/vouchers/:id" element={<RequireAuth roles={['manager']}><VoucherDetail /></RequireAuth>} />
          <Route path="/manager/change-password" element={<RequireAuth roles={['manager']}><ChangePassword /></RequireAuth>} />

          {/* Executive routes */}
          <Route path="/executive" element={<RequireAuth roles={['executive']}><VoucherList /></RequireAuth>} />
          <Route path="/executive/vouchers" element={<RequireAuth roles={['executive']}><VoucherList /></RequireAuth>} />
          <Route path="/executive/vouchers/:id" element={<RequireAuth roles={['executive']}><VoucherDetail /></RequireAuth>} />
          <Route path="/executive/supplier-master" element={<RequireAuth roles={['executive']}><SupplierMaster /></RequireAuth>} />
          <Route path="/executive/bills"     element={<RequireAuth roles={['executive']}><BillList /></RequireAuth>} />
          <Route path="/executive/bills/:id" element={<RequireAuth roles={['executive']}><BillDetail /></RequireAuth>} />
          <Route path="/executive/master-upload" element={<RequireAuth roles={['executive']}><MasterUpload /></RequireAuth>} />
          <Route path="/executive/change-password" element={<RequireAuth roles={['executive']}><ChangePassword /></RequireAuth>} />

          {/* Approver routes */}
          <Route path="/approver/supplier-master" element={<RequireAuth roles={['approver']}><SupplierMaster /></RequireAuth>} />
          <Route path="/approver/bills"     element={<RequireAuth roles={['approver']}><BillList /></RequireAuth>} />
          <Route path="/approver/bills/:id" element={<RequireAuth roles={['approver']}><BillDetail /></RequireAuth>} />
          <Route path="/approver/vouchers" element={<RequireAuth roles={['approver']}><VoucherList /></RequireAuth>} />
          <Route path="/approver/vouchers/:id" element={<RequireAuth roles={['approver']}><VoucherDetail /></RequireAuth>} />
          <Route path="/approver/change-password" element={<RequireAuth roles={['approver']}><ChangePassword /></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
