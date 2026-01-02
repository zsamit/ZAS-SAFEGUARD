import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/Auth/AuthPage';
import DashboardLayout from './pages/Dashboard/Layout';
import Overview from './pages/Dashboard/Overview';
import Devices from './pages/Dashboard/Devices';
import Protection from './pages/Dashboard/Protection';
import AdBlocker from './pages/Dashboard/AdBlocker';
import Scanner from './pages/Dashboard/Scanner';
import Alerts from './pages/Dashboard/Alerts';
import Family from './pages/Dashboard/Family';
import Settings from './pages/Dashboard/Settings';

// Protected Route wrapper - redirects to login if not authenticated
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        color: '#666'
      }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          {/* Auth Routes */}
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage />} />

          {/* Dashboard Routes - Protected */}
          <Route path="/app" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<Overview />} />
            <Route path="devices" element={<Devices />} />
            <Route path="protection" element={<Protection />} />
            <Route path="adblock" element={<AdBlocker />} />
            <Route path="scanner" element={<Scanner />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="family" element={<Family />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
