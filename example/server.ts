import express from 'express';
import { openzlMiddleware } from '../dist/index.js';

const app = express();
const PORT = 3000;

// Test endpoint without compression (for Postman testing) - BEFORE middleware
app.get('/api/large-raw', (req, res) => {
  const users = Array.from({ length: 10000 }, (_, i) => ({
    id: i + 1,
    name: `user_${i + 1}`,
    email: `user${i + 1}@example.com`,
    age: Math.floor(Math.random() * 80) + 18,
    city: ['New York', 'London', 'Tokyo', 'Paris', 'Berlin'][i % 5],
    active: i % 2 === 0,
    createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
  }));

  // Send uncompressed JSON for testing
  res.json({
    total: users,
    note: "This is uncompressed data for testing purposes"
  });
});

// Apply OpenZL middleware globally
app.use(openzlMiddleware({
  enabled: true,
  threshold: 1024, // Only compress responses > 1KB
  fallbackToGzip: true,
  debug: true // Enable debug logging
}));

// Simple test endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'OpenZL Express Middleware Demo',
    timestamp: new Date().toISOString()
  });
});

// Small response (won't be compressed due to threshold)
app.get('/api/small', (req, res) => {
  res.json({ 
    status: 'ok',
    data: 'This is a small response'
  });
});

// Large response (will be compressed)
app.get('/api/large', (req, res) => {
  const users = Array.from({ length: 10000 }, (_, i) => ({
    id: i + 1,
    name: `user_${i + 1}`,
    email: `user${i + 1}@example.com`,
    age: Math.floor(Math.random() * 80) + 18,
    city: ['New York', 'London', 'Tokyo', 'Paris', 'Berlin'][i % 5],
    active: i % 2 === 0,
    createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
  }));

  res.json({
    total: users
  });
});

// Very large nested response
app.get('/api/nested', (req, res) => {
  const data = {
    metadata: {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      server: 'OpenZL Demo'
    },
    records: Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      type: 'record',
      attributes: {
        title: `Record ${i}`,
        description: `This is a description for record number ${i}. It contains some text to make the JSON larger.`,
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
        metadata: {
          createdBy: `user_${i % 100}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: Math.floor(Math.random() * 10) + 1
        }
      },
      relationships: {
        author: { id: i % 100, type: 'user' },
        comments: Array.from({ length: 3 }, (_, j) => ({ id: j, type: 'comment' }))
      }
    }))
  };

  res.json(data);
});

app.listen(PORT, () => {
  console.log(`\n🚀 OpenZL Express Demo Server running on http://localhost:${PORT}\n`);
  console.log('Test endpoints:');
  console.log(`  • http://localhost:${PORT}/`);
  console.log(`  • http://localhost:${PORT}/api/small (small response, won't compress)`);
  console.log(`  • http://localhost:${PORT}/api/large (10k users, OpenZL compressed)`);
  console.log(`  • http://localhost:${PORT}/api/large-raw (10k users, uncompressed for Postman)`);
  console.log(`  • http://localhost:${PORT}/api/nested (5k records, will compress)\n`);
  console.log('💡 Check response headers to see compression stats!');
  console.log('📝 Use /api/large-raw in Postman to see readable JSON\n');
});

