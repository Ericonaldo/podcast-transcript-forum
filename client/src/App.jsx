import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import HomePage from './pages/HomePage';
import PodcastPage from './pages/PodcastPage';
import EpisodePage from './pages/EpisodePage';
import SearchPage from './pages/SearchPage';
import UploadPage from './pages/UploadPage';
import './styles/App.css';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const location = useLocation();

  useEffect(() => {
    fetch('/api/podcasts/categories')
      .then(r => r.json())
      .then(setCategories)
      .catch(() => {});
  }, []);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-layout">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="app-body">
        <Sidebar
          isOpen={sidebarOpen}
          categories={categories}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/podcasts/:id" element={<PodcastPage />} />
            <Route path="/episodes/:id" element={<EpisodePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/category/:category" element={<HomePage />} />
            <Route path="/upload" element={<UploadPage />} />
          </Routes>
        </main>
      </div>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  );
}
