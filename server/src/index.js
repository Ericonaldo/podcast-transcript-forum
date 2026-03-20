require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const podcastsRouter = require('./routes/podcasts');
const episodesRouter = require('./routes/episodes');
const searchRouter = require('./routes/search');
const uploadRouter = require('./routes/upload');
const revisionsRouter = require('./routes/revisions');

const app = express();
const PORT = process.env.PORT || 4010;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for dev
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
// Allow all origins including chrome-extension://
app.use(cors({
  origin: (origin, callback) => callback(null, true),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api/podcasts', podcastsRouter);
app.use('/api/episodes', episodesRouter);
app.use('/api/search', searchRouter);
app.use('/api', uploadRouter);
app.use('/api/episodes/:episodeId/revisions', revisionsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '../../client/dist');
const fs = require('fs');
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  // SPA catch-all: serve index.html for non-API routes
  const indexHtml = fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8');
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate').type('html').send(indexHtml);
  });
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
