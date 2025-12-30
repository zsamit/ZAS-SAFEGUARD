import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import LandingPage from './pages/LandingPage';
import DashboardLayout from './pages/Dashboard/Layout';
import Overview from './pages/Dashboard/Overview';
import Devices from './pages/Dashboard/Devices';
import Protection from './pages/Dashboard/Protection';
import AdBlocker from './pages/Dashboard/AdBlocker';
import Scanner from './pages/Dashboard/Scanner';
import Alerts from './pages/Dashboard/Alerts';
import Family from './pages/Dashboard/Family';
import Settings from './pages/Dashboard/Settings';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          {/* Auth Routes */}
          <Route path="/login" element={<div>Login Page (Todo)</div>} />
          <Route path="/register" element={<div>Register Page (Todo)</div>} />

          {/* Dashboard Routes (Protected) */}
          <Route path="/app" element={<DashboardLayout />}>
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
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
