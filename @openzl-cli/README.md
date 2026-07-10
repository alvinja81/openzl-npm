# @amirja811/openzl-cli

Prebuilt binaries for `zli`, the CLI of [OpenZL](https://github.com/facebook/openzl) — Meta's format-aware compression framework.

## Installation

```bash
npm install -g @amirja811/openzl-cli
```

or as a project dependency:

```bash
npm install @amirja811/openzl-cli
```

## Usage

```bash
zli --version
zli compress input.json -o output.zl -p serial
zli decompress output.zl -o restored.json
```

## Platform support

| Platform | Status |
|---|---|
| macOS arm64 (Apple Silicon) | ✅ bundled |
| Linux x64 / arm64 | ✅ when built by CI (see releases) |
| macOS x64 (Intel) | ❌ not bundled — build from source |
| Windows | ❌ not bundled — build from source |

On unsupported platforms, `zli` prints a clear error and exits with code 1. Installation itself never fails — the postinstall step only warns. To build from source, see [facebook/openzl](https://github.com/facebook/openzl).

## How it works

`bin/zli` is a small Node.js launcher that picks the right binary for your `os.platform()`/`os.arch()` from `build/binaries/` and forwards all arguments to it. No compilation happens at install time.

## Disclaimer

This is an unofficial community package redistributing OpenZL builds. It is not affiliated with or endorsed by Meta or the OpenZL project.

## License

MIT (packaging). The bundled OpenZL binary is subject to the [OpenZL license](https://github.com/facebook/openzl/blob/main/LICENSE).
