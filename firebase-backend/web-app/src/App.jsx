import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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
import TermsOfUse from './pages/Legal/TermsOfUse';
import PrivacyPolicy from './pages/Legal/PrivacyPolicy';
import CheckoutPage from './pages/Checkout/CheckoutPage';

// Hard redirect — forces a full page load so Firebase Hosting serves the correct static HTML
// (React Router Navigate stays in-app; window.location breaks out to Firebase routing)
const HardRedirect = ({ to }) => {
  React.useEffect(() => { window.location.href = to; }, [to]);
  return null;
};

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

  const location = useLocation();

  if (!user) {
    // Save intended destination to sessionStorage for reliable redirect after login
    const intendedUrl = location.pathname + location.search;
    sessionStorage.setItem('redirectAfterLogin', intendedUrl);
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* / is served by Firebase as landing.html — hard redirect out of React */}
          <Route path="/" element={<HardRedirect to="/" />} />

          {/* Auth Routes */}
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage />} />

          {/* Legal Pages */}
          <Route path="/terms-of-use" element={<TermsOfUse />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />

          {/* Dashboard Routes - Protected */}
          <Route path="/app" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<Overview />} />
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="devices" element={<Devices />} />
            <Route path="protection" element={<Protection />} />
            <Route path="adblock" element={<AdBlocker />} />
            <Route path="scanner" element={<Scanner />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="family" element={<Family />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          {/* Catch all — hard redirect so Firebase serves landing.html */}
          <Route path="*" element={<HardRedirect to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
