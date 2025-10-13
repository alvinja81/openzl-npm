# OpenZL Express Middleware - Testing Guide

## 🧪 Complete Testing Documentation

This document provides comprehensive testing instructions for the OpenZL Express middleware package.

## 📋 Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Terminal/Command line access
- curl (for API testing) or any HTTP client

## 🚀 Quick Start Testing

### 1. Install Dependencies
```bash
cd /path/to/openzl-npm
npm install
```

### 2. Build the Package
```bash
npm run build
```

### 3. Start the Demo Server
```bash
npm run test
# or
npx ts-node example/server.ts
```

The server will start on `http://localhost:3000`

## 🎯 Test Endpoints

### Available Test Endpoints

| Endpoint | Description | Expected Size | Compression |
|----------|-------------|---------------|-------------|
| `/` | Welcome message | ~100 bytes | ❌ No (too small) |
| `/api/small` | Small response | ~50 bytes | ❌ No (below threshold) |
| `/api/large` | 10,000 user objects | ~2-3MB | ✅ Yes (OpenZL/gzip) |
| `/api/nested` | 5,000 nested records | ~1-2MB | ✅ Yes (OpenZL/gzip) |

## 🔍 Manual Testing Commands

### Test 1: Small Response (No Compression Expected)
```bash
curl -i http://localhost:3000/api/small
```

**Expected Result:**
```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 49

{"status":"ok","data":"This is a small response"}
```

**What to Look For:**
- ✅ No `Content-Encoding` header
- ✅ Normal JSON response
- ✅ Small content length (49 bytes)

### Test 2: Large Response (Compression Expected)
```bash
curl -i http://localhost:3000/api/large
```

**Expected Result:**
```
HTTP/1.1 200 OK
Content-Encoding: gzip
Content-Type: application/json
X-Compression-Fallback: gzip
X-OpenZL-Error: OpenZLCLINotFoundError
Content-Length: 218145

[Compressed binary data]
```

**What to Look For:**
- ✅ `Content-Encoding: gzip` (or `openzl` if CLI installed)
- ✅ `X-Compression-Fallback: gzip` (if OpenZL not available)
- ✅ `X-OpenZL-Error: OpenZLCLINotFoundError` (if CLI missing)
- ✅ Much smaller content length (~218KB vs ~2MB)

### Test 3: Nested Response (Compression Expected)
```bash
curl -i http://localhost:3000/api/nested
```

**Expected Result:**
```
HTTP/1.1 200 OK
Content-Encoding: gzip
Content-Type: application/json
X-Compression-Fallback: gzip
X-OpenZL-Error: OpenZLCLINotFoundError
Content-Length: 80783

[Compressed binary data]
```

**What to Look For:**
- ✅ Same compression headers as Test 2
- ✅ Even better compression ratio (~80KB vs ~1-2MB)

## 📊 Compression Analysis

### Quick Compression Check
```bash
# Check compression headers only
curl -s -I http://localhost:3000/api/large | grep -E "(Content-Encoding|Content-Length|X-)"
```

### Compare All Endpoints
```bash
echo "=== COMPRESSION COMPARISON ==="
echo "1. Small response (no compression):"
curl -s -I http://localhost:3000/api/small | grep -E "(Content-Encoding|Content-Length)"

echo -e "\n2. Large response (compressed):"
curl -s -I http://localhost:3000/api/large | grep -E "(Content-Encoding|Content-Length|X-)"

echo -e "\n3. Nested response (compressed):"
curl -s -I http://localhost:3000/api/nested | grep -E "(Content-Encoding|Content-Length|X-)"
```

## 🎯 Expected Test Results

### ✅ Successful Test Results

| Test | Size | Compression | Headers | Status |
|------|------|-------------|---------|--------|
| Small | 49 bytes | None | `Content-Length: 49` | ✅ Pass |
| Large | 2MB → 218KB | 89% reduction | `Content-Encoding: gzip` | ✅ Pass |
| Nested | 1.5MB → 80KB | 95% reduction | `Content-Encoding: gzip` | ✅ Pass |

### 🔍 Header Analysis

#### Without OpenZL CLI (Current State)
```
Content-Encoding: gzip
X-Compression-Fallback: gzip
X-OpenZL-Error: OpenZLCLINotFoundError
```

#### With OpenZL CLI Installed
```
Content-Encoding: openzl
X-OpenZL-Ratio: 15.23%
X-Original-Size: 2500000
X-Compressed-Size: 380750
```

## 🛠️ Advanced Testing

### Custom Test Server
```bash
# Start custom test server with different configurations
npx ts-node example/custom-tests.ts
```

This starts a server on port 3001 with multiple test scenarios:
- Different threshold settings
- Various data types (strings, numbers, mixed)
- Performance testing
- Fallback behavior testing

### Test Different Configurations
```bash
# Test with different middleware settings
curl -i http://localhost:3001/config1/mixed-data  # Low threshold (500 bytes)
curl -i http://localhost:3001/config2/large-data  # High threshold (5000 bytes)
curl -i http://localhost:3001/config3/disabled-test # Compression disabled
```

## 🐛 Troubleshooting

### Common Issues

#### 1. Server Won't Start
```bash
# Check if port is in use
lsof -i :3000

# Kill existing processes
pkill -f "ts-node example/server.ts"
```

#### 2. No Compression Headers
- Check if response size is above threshold (default: 1024 bytes)
- Verify middleware is applied correctly
- Check server logs for errors

#### 3. OpenZL CLI Not Found
This is expected if you haven't installed the OpenZL CLI. The middleware will automatically fallback to gzip compression.

### Debug Mode
Enable debug logging in the middleware:
```typescript
app.use(openzlMiddleware({
  debug: true  // Shows compression logs in console
}));
```

## 📈 Performance Testing

### Load Testing with curl
```bash
# Test multiple requests
for i in {1..10}; do
  echo "Request $i:"
  curl -s -w "Time: %{time_total}s, Size: %{size_download} bytes\n" \
    -o /dev/null http://localhost:3000/api/large
done
```

### Memory Usage Testing
```bash
# Monitor memory usage during requests
while true; do
  curl -s http://localhost:3000/api/large > /dev/null
  sleep 1
done
```

## 🎯 Test Checklist

### Basic Functionality
- [ ] Server starts without errors
- [ ] Small responses don't compress (below threshold)
- [ ] Large responses compress successfully
- [ ] Compression headers are present
- [ ] Fallback to gzip works when OpenZL unavailable

### Error Handling
- [ ] Graceful fallback on compression failure
- [ ] Helpful error messages in headers
- [ ] Server continues working after errors
- [ ] Debug logging works when enabled

### Performance
- [ ] Compression doesn't block the event loop
- [ ] Memory usage is reasonable
- [ ] Response times are acceptable
- [ ] Multiple concurrent requests work

## 📝 Test Results Template

```
Test Date: ___________
Node Version: ___________
Package Version: ___________

Test Results:
□ Small Response (49 bytes) - No compression
□ Large Response (2MB → 218KB) - 89% compression
□ Nested Response (1.5MB → 80KB) - 95% compression
□ Fallback to gzip works
□ Error handling works
□ Debug logging works

Compression Headers:
- Content-Encoding: gzip
- X-Compression-Fallback: gzip
- X-OpenZL-Error: OpenZLCLINotFoundError

Notes:
_________________________________
_________________________________
```

## 🚀 Next Steps

After successful testing:
1. **Publish to npm**: `npm publish --access public`
2. **Create GitHub repository** with test results
3. **Add automated tests** with Jest/Mocha
4. **Set up CI/CD** with GitHub Actions
5. **Create documentation** for end users

## 📚 Additional Resources

- [OpenZL Official Documentation](https://github.com/openzl/openzl)
- [Express.js Middleware Guide](https://expressjs.com/en/guide/using-middleware.html)
- [HTTP Compression Best Practices](https://developer.mozilla.org/en-US/docs/Web/HTTP/Compression)

---

**Happy Testing! 🎉**

For questions or issues, please check the troubleshooting section or create an issue in the repository.
