import express from 'express';
import { openzlMiddleware } from '../dist/index.js';

const app = express();
const PORT = 3001;

// Different middleware configurations for testing
app.use('/config1', openzlMiddleware({
  enabled: true,
  threshold: 500,  // Lower threshold
  fallbackToGzip: true,
  debug: true
}));

app.use('/config2', openzlMiddleware({
  enabled: true,
  threshold: 5000, // Higher threshold
  fallbackToGzip: false, // No fallback
  debug: true
}));

app.use('/config3', openzlMiddleware({
  enabled: false, // Disabled
  debug: true
}));

// Test different data types
app.get('/config1/json-array', (req, res) => {
  const data = Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `item_${i}`,
    value: Math.random() * 1000
  }));
  res.json(data);
});

app.get('/config1/string-heavy', (req, res) => {
  const longString = 'Lorem ipsum '.repeat(1000);
  res.json({
    message: longString,
    timestamp: new Date().toISOString()
  });
});

app.get('/config1/numbers-heavy', (req, res) => {
  const numbers = Array.from({ length: 10000 }, () => Math.random());
  res.json({ numbers });
});

app.get('/config1/mixed-data', (req, res) => {
  res.json({
    users: Array.from({ length: 500 }, (_, i) => ({
      id: i,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      profile: {
        age: Math.floor(Math.random() * 80) + 18,
        city: ['NYC', 'LA', 'Chicago', 'Houston', 'Phoenix'][i % 5],
        bio: `This is a bio for user ${i}. It contains some text to make the response larger.`
      },
      settings: {
        notifications: i % 2 === 0,
        theme: ['light', 'dark'][i % 2],
        language: ['en', 'es', 'fr', 'de'][i % 4]
      }
    })),
    metadata: {
      total: 500,
      generated: new Date().toISOString(),
      version: '1.0.0'
    }
  });
});

// Test with config2 (higher threshold, no fallback)
app.get('/config2/large-data', (req, res) => {
  const data = Array.from({ length: 2000 }, (_, i) => ({
    id: i,
    content: `This is content item ${i} with some text to make it larger.`,
    tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
    metadata: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      version: Math.floor(Math.random() * 10) + 1
    }
  }));
  res.json(data);
});

// Test with config3 (disabled compression)
app.get('/config3/disabled-test', (req, res) => {
  const data = Array.from({ length: 2000 }, (_, i) => ({
    id: i,
    message: `This should NOT be compressed because middleware is disabled`
  }));
  res.json(data);
});

// Performance test endpoint
app.get('/config1/performance-test', (req, res) => {
  const startTime = Date.now();
  const data = Array.from({ length: 10000 }, (_, i) => ({
    id: i,
    name: `Performance test item ${i}`,
    data: Array.from({ length: 10 }, (_, j) => `data_${j}`),
    timestamp: new Date().toISOString()
  }));
  
  res.json({
    data,
    performance: {
      generationTime: Date.now() - startTime,
      itemCount: data.length,
      estimatedSize: JSON.stringify(data).length
    }
  });
});

app.listen(PORT, () => {
  console.log(`\n🧪 Custom Test Server running on http://localhost:${PORT}\n`);
  console.log('Test endpoints:');
  console.log(`  • http://localhost:${PORT}/config1/json-array (1000 items, threshold: 500)`);
  console.log(`  • http://localhost:${PORT}/config1/string-heavy (string-heavy data)`);
  console.log(`  • http://localhost:${PORT}/config1/numbers-heavy (10k random numbers)`);
  console.log(`  • http://localhost:${PORT}/config1/mixed-data (complex nested objects)`);
  console.log(`  • http://localhost:${PORT}/config2/large-data (2k items, threshold: 5000, no fallback)`);
  console.log(`  • http://localhost:${PORT}/config3/disabled-test (compression disabled)`);
  console.log(`  • http://localhost:${PORT}/config1/performance-test (10k items with timing)\n`);
  console.log('💡 Compare compression ratios and response times!\n');
});


