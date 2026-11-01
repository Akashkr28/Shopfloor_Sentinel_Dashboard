import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import DrillMode from './pages/DrillMode.jsx';
import EngineerView from './pages/EngineerView.jsx';
import JoinPage from './pages/JoinPage.jsx';
import Login from './pages/Login.jsx';
import OperatorView from './pages/OperatorView.jsx';
import OwnerView from './pages/OwnerView.jsx';
import Setup from './pages/Setup.jsx';
import SetupFactory from './pages/SetupFactory.jsx';
import TemplateEditor from './pages/TemplateEditor.jsx';
import { HOME_BY_ROLE, SessionProvider, useSession } from './session.jsx';
import './styles.css';
import { initTheme } from './theme.js';

initTheme();

const ALLOWED = {
  '/floor': ['OPERATOR', 'SUPERVISOR', 'ENGINEER'],
  '/engineer': ['ENGINEER', 'OWNER'],
  '/templates': ['ENGINEER', 'OWNER'],
  '/setup': ['ENGINEER', 'OWNER'],
  '/drills': ['ENGINEER', 'SUPERVISOR', 'OWNER'],
  '/owner': ['OWNER', 'ENGINEER'],
};

function Guard({ path, children }) {
  const { user } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  if (!ALLOWED[path].includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  return children;
}

function Home() {
  const { user } = useSession();
  return <Navigate to={user ? HOME_BY_ROLE[user.role] : '/login'} replace />;
}

function App() {
  const { user, ready, meta } = useSession();
  // Wait for the cookie check so a refresh doesn't flash the login page.
  if (!ready) return <div className="boot" aria-busy="true" />;
  // A brand-new install has no accounts yet: everything leads to first-run setup.
  if (meta.needsSetup && !user) {
    return (
      <Routes>
        <Route path="/setup-factory" element={<SetupFactory />} />
        <Route path="*" element={<Navigate to="/setup-factory" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={user ? <Home /> : <Login />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/setup-factory" element={<Navigate to="/" replace />} />
      <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
        {[
          ['/floor', <OperatorView />],
          ['/engineer', <EngineerView />],
          ['/templates', <TemplateEditor />],
          ['/setup', <Setup />],
          ['/drills', <DrillMode />],
          ['/owner', <OwnerView />],
        ].map(([path, el]) => (
          <Route key={path} path={path} element={<Guard path={path}>{el}</Guard>} />
        ))}
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
