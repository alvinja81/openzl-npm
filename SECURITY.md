# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes |
| 0.5.x   | Security fixes until 1.1, then no |
| < 0.5   | No |

## Reporting a vulnerability

Do **not** open a public issue for a security report.

1. GitHub: **Security → Report a vulnerability** (private advisory) on [alvinja81/openzl-npm](https://github.com/alvinja81/openzl-npm).
2. Or email the npm package author listed on [openzl-express](https://www.npmjs.com/package/openzl-express).

Please include the affected version, a reproducer, and the impact (decode crash, zip bomb, header leak, install-time code exec, …).

We will acknowledge within 7 days and ship a patch on the 1.0 line when the report is valid.

## What this package already constrains

Decompress of untrusted OpenZL frames should go through `decompress()` with limits (`maxInputBytes`, `maxOutputBytes`, `timeoutMs`). Defaults are in `docs/COMPAT.md`. Do not pipe raw OpenZL bytes into `zli` on a public endpoint without those limits.
