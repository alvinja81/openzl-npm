# @openzl/cli

OpenZL CLI - High-performance compression tool for Node.js applications.

## Installation

### Global Installation

```bash
npm install -g @openzl/cli
```

### Local Installation

```bash
npm install @openzl/cli
```

## Usage

After installation, you can use the `zli` command:

```bash
# Check version
zli --version

# Compress a file
zli compress input.json output.zl

# Decompress a file
zli decompress input.zl output.json

# List available compression profiles
zli list-profiles

# Inspect a compressed file
zli inspect input.zl
```

## Platform Support

This package provides pre-built binaries for:

- **macOS**: arm64, x64
- **Linux**: arm64, x64  
- **Windows**: x64

The appropriate binary is automatically selected during installation based on your platform.

## Integration with @openzl/express

This CLI is designed to work seamlessly with the `@openzl/express` middleware:

```bash
# Install both packages
npm install @openzl/express @openzl/cli

# The middleware will automatically find and use the CLI
```

## Development

### Building from Source

If you need to build the CLI from source:

```bash
# Clone the OpenZL repository
git clone https://github.com/openzl/openzl.git
cd openzl

# Build the CLI
make zli BUILD_TYPE=OPT

# The binary will be created in the build directory
```

### Building for Multiple Platforms

To build binaries for all supported platforms, you'll need to:

1. Build on macOS for darwin-arm64 and darwin-x64
2. Use GitHub Actions or similar CI to build for Linux platforms
3. Use Windows CI to build for win32-x64

## Troubleshooting

### Binary Not Found

If you get a "binary not found" error:

1. Ensure you're using a supported platform
2. Try reinstalling: `npm uninstall -g @openzl/cli && npm install -g @openzl/cli`
3. Check that the binary is executable: `ls -la $(which zli)`

### Permission Denied

On Unix-like systems, ensure the binary is executable:

```bash
chmod +x $(which zli)
```

### Platform Not Supported

If your platform isn't supported, you can:

1. Build from source (see Development section)
2. Use the gzip fallback in @openzl/express
3. Request support for your platform

## License

MIT

## Links

- [OpenZL Repository](https://github.com/openzl/openzl)
- [@openzl/express](https://www.npmjs.com/package/@openzl/express)
- [Documentation](https://github.com/openzl/openzl/blob/main/README.md)
