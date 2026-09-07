import { useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import './styles/global.css';

import { DEMO } from './demo/demoConfig';
import { AuthProvider } from './lib/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Login from './pages/Login';
import Apps from './pages/Apps';
import PricingMaster from './apps/PricingMaster';
import OthersMaster from './apps/OthersMaster';

// Demo builds ship to GitHub Pages (a static host with no SPA fallback),
// so hash routing keeps deep links working without a 404.html shim.
// The live build keeps clean paths — Firebase hosting rewrites handle it.
const Router = DEMO ? HashRouter : BrowserRouter;

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// Enter-only transition. Deliberately no exit animation: routes that redirect
// (Login once signed in, and the section redirects below) swap themselves for
// <Navigate> mid-transition, which would strand an AnimatePresence mode="wait"
// waiting on an exit that never completes — leaving the page blank.
function PageTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

// Wraps a page in auth + the sidebar shell
function Shell({ children }) {
  return (
    <ProtectedRoute>
      <AppShell>
        <PageTransition>{children}</PageTransition>
      </AppShell>
    </ProtectedRoute>
  );
}

function AppRoutes() {
  const location = useLocation();

  return (
    <>
      <ScrollToTop />
      {location.pathname === '/' && <Navbar />}
      <Routes>
        <Route path="/" element={<PageTransition><Home /></PageTransition>} />
        <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
        <Route path="/apps" element={<Shell><Apps /></Shell>} />
        <Route path="/apps/pricing-master" element={<Navigate to="/apps/pricing-master/single" replace />} />
        <Route path="/apps/pricing-master/:tab" element={<Shell><PricingMaster /></Shell>} />
        <Route path="/apps/others" element={<Navigate to="/apps/others/erp-export" replace />} />
        <Route path="/apps/others/:tab" element={<Shell><OthersMaster /></Shell>} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
          <AppRoutes />
        </div>
      </AuthProvider>
    </Router>
  );
}
