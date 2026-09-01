# Release checklist (Phase 9)

Use this when cutting a public version of **openzl-express** and **@amirja811/openzl-cli**.

Current line: **1.0.x**. Prebuild gate: the GitHub Release must attach native addons for **linux-x64**, **linux-arm64**, and **darwin-arm64**. Do not publish if those three assets are missing.

## Prerequisites

- [ ] `main` green on CI (`ci.yml`)
- [ ] `npm test` passes locally
- [ ] `node scripts/release-check.mjs` passes
- [ ] `CHANGELOG.md` updated for the version
- [ ] `package.json` / `@openzl-cli/package.json` versions agree on intent
- [ ] GitHub secrets: `NPM_TOKEN` environment (or trusted publishing on npm)

## Version matrix

| Package | Field | Notes |
|---------|--------|--------|
| `openzl-express` | `version` | e.g. `1.0.0` |
| `openzl-express` | `optionalDependencies.@amirja811/openzl-cli` | `^0.3.0` or matching |
| `@amirja811/openzl-cli` | `version` | published from monorepo `@openzl-cli/` |

## 1. Preflight (local)

```bash
npm ci || npm install
npm run build
npm test
node scripts/release-check.mjs
node scripts/pack-smoke.mjs
```

## 2. Tag & push

```bash
git status   # clean
git tag -a v1.0.0 -m "v1.0.0 gzip/br/zstd highway, OpenZL opt-in"
git push origin main
git push origin v1.0.0
```

Creating a **GitHub Release** from the tag triggers:

| Workflow | Publishes / attaches |
|----------|----------------------|
| `build-binaries.yml` | `zli` for darwin/linux/win → npm `@amirja811/openzl-cli` (on release) |
| `build-native.yml` | `openzl_native-v*-{platform}.tar.gz` on the Release |
| `publish-express.yml` | `openzl-express` to npm |

Prefer **GitHub → Releases → Draft from tag** so release event fires cleanly.

## 3. Verify after release

```bash
# Clean machine / empty dir
mkdir /tmp/ozl-verify && cd /tmp/ozl-verify
npm init -y
npm install openzl-express@1.0.0
node -e "import('openzl-express').then(m => console.log(Object.keys(m).slice(0,12)))"
node -e "import('openzl-express').then(m => console.log('zstd', m.isZstdAvailable()))"

# Optional: check CLI binary for this platform
npx zli --version || true

# Optional: native prebuild landed?
ls node_modules/openzl-express/prebuilds || echo "no prebuild dir (gzip/zstd still work)"
```

## 4. Install modes (document for users)

| Mode | Behavior |
|------|----------|
| Normal `npm i` | `postinstall` tries native prebuild download; never fails install |
| `npm i --ignore-scripts` | No postinstall; gzip/zstd work; openzl if prebuild shipped in package tarball |
| `OPENZL_SKIP_NATIVE=1` | Skip native download |
| `OPENZL_NATIVE=0` | Runtime ignores native addon |
| No CLI binary for platform | openzl encode falls back; zstd/gzip still work |

## 5. Node engines

| Feature | Node |
|---------|------|
| Package install / gzip | **≥ 18** |
| zstd via `zlib` | **≥ 22.15** (approx.) / builds that export `zstdCompress` |
| Native N-API prebuild | Any supported Node 18+ once `.node` exists for platform |

## 6. Rollback

- npm does not unpublish easily; publish a patch `1.0.1` if needed.
- GitHub Release can be edited to re-upload assets.

## Failure modes

| Symptom | Action |
|---------|--------|
| CLI publish failed | Re-run `build-binaries` release job; check `NPM_TOKEN` env |
| Native assets missing | Re-run `build-native` on release; check OpenZL cmake on runner |
| express publish failed | Trusted publisher on npmjs.com for package + repo |
| Windows zli build red | Inspect MSVC/cmake logs; package still ships other platforms |
