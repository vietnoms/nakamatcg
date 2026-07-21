import { NavLink, Route, Routes } from 'react-router-dom';
import { DealsPage } from './pages/DealsPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { QueueStatusBar } from './components/QueueStatusBar';

export function App() {
  return (
    <div className="app-shell">
      <nav className="topnav">
        <div className="brand">
          pallet<span>sniper</span>
        </div>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          Deals
        </NavLink>
        <NavLink to="/rules" className={({ isActive }) => (isActive ? 'active' : '')}>
          Rules
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          Settings
        </NavLink>
      </nav>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<DealsPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <QueueStatusBar />
    </div>
  );
}
