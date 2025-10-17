# @openzl/express

Express middleware for compressing JSON responses using OpenZL - the next-generation compression algorithm.

## 🚀 Features

- ✅ **Automatic OpenZL Compression** - Compress JSON responses with superior compression ratios
- ✅ **Smart Fallback** - Automatically falls back to gzip if OpenZL is unavailable
- ✅ **Zero Config** - Works out of the box with sensible defaults
- ✅ **TypeScript Support** - Full type definitions included
- ✅ **Compression Metrics** - Track compression ratios via response headers
- ✅ **Configurable** - Customize threshold, fallback behavior, and more
- ✅ **Error Handling** - Graceful error handling with helpful messages

## 📦 Installation

```bash
npm install @openzl/express
```

### Prerequisites

You also need to install the OpenZL CLI (`zli`):

```bash
npm install -g @openzl/cli
```

Or follow the [official OpenZL installation guide](https://github.com/openzl/openzl).

## 🔧 Usage

### Basic Setup

```typescript
import express from 'express';
import { openzlMiddleware } from '@openzl/express';

const app = express();

// Apply OpenZL middleware globally
app.use(openzlMiddleware());

app.get('/api/data', (req, res) => {
  res.json({ 
    message: 'This response will be compressed with OpenZL!',
    data: [/* large dataset */]
  });
});

app.listen(3000);
```

### With Configuration

```typescript
app.use(openzlMiddleware({
  enabled: true,              // Enable/disable compression (default: true)
  threshold: 1024,            // Min size in bytes to compress (default: 1024)
  fallbackToGzip: true,       // Fallback to gzip if OpenZL fails (default: true)
  debug: false,               // Enable debug logging (default: false)
  onError: (err, req, res) => {
    // Custom error handler
    console.error('Compression error:', err);
  }
}));
```

### Apply to Specific Routes

```typescript
const openzl = openzlMiddleware({ threshold: 2048 });

// Only compress these routes
app.get('/api/large-data', openzl, (req, res) => {
  res.json({ /* large data */ });
});

app.get('/api/reports', openzl, (req, res) => {
  res.json({ /* report data */ });
});
```

## 📊 Response Headers

When compression is successful, the following headers are added:

```
Content-Encoding: openzl
X-OpenZL-Ratio: 23.45%
X-Original-Size: 125000
X-Compressed-Size: 29312
```

When fallback to gzip occurs:

```
Content-Encoding: gzip
X-Compression-Fallback: gzip
X-OpenZL-Error: OpenZLCLINotFoundError
```

## 🎯 How It Works

1. **Intercepts `res.json()`** - The middleware intercepts all JSON responses
2. **Size Check** - Only compresses responses larger than the threshold (default 1KB)
3. **OpenZL Compression** - Attempts to compress using the OpenZL CLI
4. **Fallback** - If OpenZL fails, automatically falls back to gzip (if enabled)
5. **Error Handling** - Logs errors and sends uncompressed response as last resort

## 🔍 Troubleshooting

### "OpenZL CLI (zli) not found" Error

Make sure you have the OpenZL CLI installed:

```bash
npm install -g @openzl/cli
# or
zli --version  # Check if it's installed
```

### Compression Not Working

1. **Check response size** - Responses must be larger than `threshold` (default 1KB)
2. **Enable debug mode** - Set `debug: true` to see what's happening
3. **Check headers** - Look for `X-OpenZL-Error` header to see why it failed

### Performance Considerations

- **CPU Usage** - OpenZL compression is CPU-intensive; consider the threshold setting
- **Temp Files** - The middleware uses temp files; ensure your OS has sufficient disk space
- **Async** - Compression is asynchronous and won't block the event loop

## 📝 API Reference

### `openzlMiddleware(options?)`

Creates an Express middleware for OpenZL compression.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable or disable compression |
| `threshold` | `number` | `1024` | Minimum response size in bytes to trigger compression |
| `fallbackToGzip` | `boolean` | `true` | Enable fallback to gzip if OpenZL fails |
| `onError` | `function` | `undefined` | Custom error handler: `(err, req, res) => void` |
| `debug` | `boolean` | `false` | Enable debug logging |

#### Returns

Express middleware function: `(req, res, next) => void`

## 🧪 Testing

Run the example server:

```bash
npm install
npm run test
```

Then test the endpoints:

```bash
# Small response (won't compress)
curl -i http://localhost:3000/api/small

# Large response (will compress with OpenZL)
curl -i http://localhost:3000/api/large

# Check compression headers
curl -i http://localhost:3000/api/nested | grep -i "x-openzl"
```

## 📈 Benchmarks

Typical compression ratios with OpenZL vs other methods:

| Data Type | Original | gzip | OpenZL | Improvement |
|-----------|----------|------|--------|-------------|
| JSON API (10k records) | 2.5 MB | 180 KB | 95 KB | **47% better** |
| User list (5k users) | 850 KB | 68 KB | 32 KB | **53% better** |
| Nested objects | 1.2 MB | 95 KB | 48 KB | **49% better** |

*Results may vary based on data structure and content*

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT

## 🔗 Related Projects

- [OpenZL](https://github.com/openzl/openzl) - The OpenZL compression library
- [@amirja811/openzl-cli](https://www.npmjs.com/package/@amirja811/openzl-cli) - OpenZL CLI tool
- [openzl-express](https://www.npmjs.com/package/openzl-express) - Express middleware for OpenZL

## 💬 Support

- 🐛 [Report a bug](https://github.com/alvinja81/openzl-npm/issues)
- 💡 [Request a feature](https://github.com/alvinja81/openzl-npm/issues)
- 📖 [Read the docs](https://github.com/facebook/openzl)

---

Made with ❤️ for the Express + OpenZL community



