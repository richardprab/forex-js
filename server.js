// server.js - Main server file for Cloud Run
const express = require('express');
const { runForexScraper } = require('./scraper');

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Forex scraper service running',
    timestamp: new Date().toISOString()
  });
});

// Main scraper endpoint - triggered by Cloud Scheduler
app.post('/scrape', async (req, res) => {
  try {
    console.log('Forex scraper triggered at:', new Date().toISOString());
    const result = await runForexScraper();
    
    res.json({ 
      success: true, 
      message: 'Forex scraping completed',
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Scraping failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Manual trigger endpoint for testing
app.get('/test', async (req, res) => {
  try {
    const result = await runForexScraper();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});