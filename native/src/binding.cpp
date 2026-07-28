/**
 * N-API addon: in-process OpenZL compress/decompress (serial profile).
 *
 * - Zero-copy Buffer input (kept alive via Persistent ref during async work)
 * - Fresh Buffer output
 * - Work runs on the libuv threadpool (Napi::AsyncWorker) — does not block
 *   the event loop
 * - Serial profile matches CLI `-p serial` (ACE+LZ inside a serial segmenter)
 */

#include <napi.h>

#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

// OpenZL public headers already wrap C APIs in extern "C"; do not wrap again
// (some detail headers use C++ templates).
#include "openzl/zl_compress.h"
#include "openzl/zl_compressor.h"
#include "openzl/zl_compressor_serialization.h"
#include "openzl/zl_decompress.h"
#include "openzl/zl_errors.h"
#include "openzl/zl_version.h"
#include "openzl/codecs/zl_ace.h"
#include "openzl/codecs/zl_lz.h"
#include "openzl/codecs/zl_segmenters.h"
#include "openzl/zl_segmenter.h"

namespace {

std::string reportError(ZL_Report r, const char* what) {
  if (!ZL_isError(r)) return {};
  const char* code = ZL_ErrorCode_toString(ZL_errorCode(r));
  std::string msg = std::string(what) + ": ";
  msg += code ? code : "unknown error";
  return msg;
}

/**
 * Shared serial compressor graph. Built once; CCtx/DCtx are per-call
 * so multiple threadpool workers can run in parallel.
 */
struct SerialCompressor {
  ZL_Compressor* compressor = nullptr;

  bool init(std::string& err) {
    compressor = ZL_Compressor_create();
    if (!compressor) {
      err = "ZL_Compressor_create failed";
      return false;
    }

    ZL_GraphID inner =
        ZL_Compressor_buildACEGraphWithDefault(compressor, ZL_GRAPH_LZ);
    ZL_GraphID graph =
        ZL_Compressor_buildSerialSegmenter(compressor, 0, inner);

    ZL_Report sel = ZL_Compressor_selectStartingGraphID(compressor, graph);
    if (ZL_isError(sel)) {
      err = reportError(sel, "selectStartingGraphID");
      return false;
    }
    return true;
  }

  ~SerialCompressor() {
    if (compressor) {
      ZL_Compressor_free(compressor);
      compressor = nullptr;
    }
  }
};

SerialCompressor* g_serial = nullptr;
std::once_flag g_serialOnce;
std::string g_serialInitError;

bool ensureSerial(std::string& err) {
  std::call_once(g_serialOnce, []() {
    auto* s = new SerialCompressor();
    std::string e;
    if (!s->init(e)) {
      g_serialInitError = e;
      delete s;
      g_serial = nullptr;
    } else {
      g_serial = s;
    }
  });
  if (!g_serial) {
    err = g_serialInitError.empty() ? "native OpenZL init failed" : g_serialInitError;
    return false;
  }
  return true;
}

// ── trained compressors (deserialized .zlc graphs, cached by key) ───

/**
 * A deserialized trained compressor. Immutable after construction, so it can
 * be shared across threadpool workers (each call uses its own CCtx), same as
 * the serial graph above.
 */
struct TrainedCompressor {
  ZL_Compressor* compressor = nullptr;

  ~TrainedCompressor() {
    if (compressor) {
      ZL_Compressor_free(compressor);
      compressor = nullptr;
    }
  }
};

std::mutex g_trainedMutex;
std::unordered_map<std::string, std::shared_ptr<TrainedCompressor>> g_trained;

/**
 * Get (or build) the cached compressor for `key`, deserializing `zlc` bytes
 * on first use. Trained graphs produced by `zli train` from standard base
 * profiles (serial, le-*) only reference built-in components, so a plain
 * deserialize is enough — anything exotic fails here and the JS engine falls
 * back to the CLI path.
 */
bool getTrainedCompressor(
    const std::string& key,
    const uint8_t* zlc,
    size_t zlcSize,
    std::shared_ptr<TrainedCompressor>& out,
    std::string& err
) {
  {
    std::lock_guard<std::mutex> lock(g_trainedMutex);
    auto it = g_trained.find(key);
    if (it != g_trained.end()) {
      out = it->second;
      return true;
    }
  }

  auto trained = std::make_shared<TrainedCompressor>();
  trained->compressor = ZL_Compressor_create();
  if (!trained->compressor) {
    err = "ZL_Compressor_create failed";
    return false;
  }

  ZL_CompressorDeserializer* deser = ZL_CompressorDeserializer_create();
  if (!deser) {
    err = "ZL_CompressorDeserializer_create failed";
    return false;
  }

  ZL_Report dr = ZL_CompressorDeserializer_deserialize(
      deser, trained->compressor, zlc, zlcSize, nullptr, 0);
  if (ZL_isError(dr)) {
    const char* ctx =
        ZL_CompressorDeserializer_getErrorContextString(deser, dr);
    err = std::string("deserialize compressor: ") +
          (ctx ? ctx : reportError(dr, "deserialize"));
    ZL_CompressorDeserializer_free(deser);
    return false;
  }
  ZL_CompressorDeserializer_free(deser);

  std::lock_guard<std::mutex> lock(g_trainedMutex);
  auto [it, inserted] = g_trained.emplace(key, std::move(trained));
  out = it->second;  // reuse winner if another thread raced us here
  return true;
}

// ── core compress / decompress (thread-safe; no JS objects) ─────────

bool compressBytesWith(
    ZL_Compressor* compressor,
    const uint8_t* src,
    size_t srcSize,
    std::vector<uint8_t>& out,
    std::string& err
) {
  ZL_CCtx* cctx = ZL_CCtx_create();
  if (!cctx) {
    err = "ZL_CCtx_create failed";
    return false;
  }

  auto cleanup = [&]() { ZL_CCtx_free(cctx); };

  ZL_Report fmt = ZL_CCtx_setParameter(
      cctx, ZL_CParam_formatVersion, static_cast<int>(ZL_MAX_FORMAT_VERSION));
  if (ZL_isError(fmt)) {
    err = reportError(fmt, "set formatVersion");
    cleanup();
    return false;
  }

  ZL_Report ref = ZL_CCtx_refCompressor(cctx, compressor);
  if (ZL_isError(ref)) {
    err = reportError(ref, "refCompressor");
    cleanup();
    return false;
  }

  const size_t bound = ZL_compressBound(srcSize);
  out.resize(bound);
  ZL_Report cr =
      ZL_CCtx_compress(cctx, out.data(), out.size(), src, srcSize);
  cleanup();

  if (ZL_isError(cr)) {
    err = reportError(cr, "compress");
    out.clear();
    return false;
  }

  out.resize(ZL_validResult(cr));
  return true;
}

bool compressBytes(
    const uint8_t* src,
    size_t srcSize,
    std::vector<uint8_t>& out,
    std::string& err
) {
  if (!ensureSerial(err)) return false;
  return compressBytesWith(g_serial->compressor, src, srcSize, out, err);
}

bool decompressBytes(
    const uint8_t* src,
    size_t srcSize,
    std::vector<uint8_t>& out,
    std::string& err
) {
  ZL_Report sizeR = ZL_getDecompressedSize(src, srcSize);
  if (ZL_isError(sizeR)) {
    err = reportError(sizeR, "getDecompressedSize");
    return false;
  }

  const size_t outSize = ZL_validResult(sizeR);
  out.resize(outSize);
  ZL_Report dr = ZL_decompress(out.data(), out.size(), src, srcSize);
  if (ZL_isError(dr)) {
    err = reportError(dr, "decompress");
    out.clear();
    return false;
  }

  out.resize(ZL_validResult(dr));
  return true;
}

// ── Async workers ───────────────────────────────────────────────────

class CompressWorker : public Napi::AsyncWorker {
 public:
  CompressWorker(Napi::Env env, Napi::Buffer<uint8_t> input)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        // Keep the JS Buffer alive for the duration of the async job
        inputRef_(Napi::ObjectReference::New(input, 1)),
        src_(input.Data()),
        srcSize_(input.Length()) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    if (!compressBytes(src_, srcSize_, out_, error_)) {
      SetError(error_.empty() ? "compress failed" : error_);
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    // Fresh Buffer owned by V8 (copy out of std::vector)
    Napi::Buffer<uint8_t> buf =
        Napi::Buffer<uint8_t>::Copy(env, out_.data(), out_.size());
    deferred_.Resolve(buf);
  }

  void OnError(const Napi::Error& e) override {
    deferred_.Reject(e.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  Napi::ObjectReference inputRef_;
  const uint8_t* src_;
  size_t srcSize_;
  std::vector<uint8_t> out_;
  std::string error_;
};

class CompressTrainedWorker : public Napi::AsyncWorker {
 public:
  CompressTrainedWorker(
      Napi::Env env,
      std::string key,
      Napi::Buffer<uint8_t> zlc,
      Napi::Buffer<uint8_t> input)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        key_(std::move(key)),
        zlcRef_(Napi::ObjectReference::New(zlc, 1)),
        inputRef_(Napi::ObjectReference::New(input, 1)),
        zlc_(zlc.Data()),
        zlcSize_(zlc.Length()),
        src_(input.Data()),
        srcSize_(input.Length()) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    std::shared_ptr<TrainedCompressor> trained;
    if (!getTrainedCompressor(key_, zlc_, zlcSize_, trained, error_)) {
      SetError(error_.empty() ? "load trained compressor failed" : error_);
      return;
    }
    if (!compressBytesWith(trained->compressor, src_, srcSize_, out_, error_)) {
      SetError(error_.empty() ? "compress failed" : error_);
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Buffer<uint8_t> buf =
        Napi::Buffer<uint8_t>::Copy(env, out_.data(), out_.size());
    deferred_.Resolve(buf);
  }

  void OnError(const Napi::Error& e) override {
    deferred_.Reject(e.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  std::string key_;
  Napi::ObjectReference zlcRef_;
  Napi::ObjectReference inputRef_;
  const uint8_t* zlc_;
  size_t zlcSize_;
  const uint8_t* src_;
  size_t srcSize_;
  std::vector<uint8_t> out_;
  std::string error_;
};

class DecompressWorker : public Napi::AsyncWorker {
 public:
  DecompressWorker(Napi::Env env, Napi::Buffer<uint8_t> input)
      : Napi::AsyncWorker(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        inputRef_(Napi::ObjectReference::New(input, 1)),
        src_(input.Data()),
        srcSize_(input.Length()) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    if (!decompressBytes(src_, srcSize_, out_, error_)) {
      SetError(error_.empty() ? "decompress failed" : error_);
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Buffer<uint8_t> buf =
        Napi::Buffer<uint8_t>::Copy(env, out_.data(), out_.size());
    deferred_.Resolve(buf);
  }

  void OnError(const Napi::Error& e) override {
    deferred_.Reject(e.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  Napi::ObjectReference inputRef_;
  const uint8_t* src_;
  size_t srcSize_;
  std::vector<uint8_t> out_;
  std::string error_;
};

// ── JS exports ──────────────────────────────────────────────────────

Napi::Value Compress(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "compress(buffer) expects a Buffer")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto* worker =
      new CompressWorker(env, info[0].As<Napi::Buffer<uint8_t>>());
  auto promise = worker->Promise();
  worker->Queue();
  return promise;
}

/**
 * compressTrained(key: string, zlc: Buffer, data: Buffer) → Promise<Buffer>
 *
 * `key` identifies the compressor in the cache (profile name); `zlc` is the
 * serialized compressor bytes, only read on first use per key.
 */
Napi::Value CompressTrained(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsBuffer() ||
      !info[2].IsBuffer()) {
    Napi::TypeError::New(
        env, "compressTrained(key, zlcBuffer, dataBuffer) expects (string, Buffer, Buffer)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto* worker = new CompressTrainedWorker(
      env,
      info[0].As<Napi::String>().Utf8Value(),
      info[1].As<Napi::Buffer<uint8_t>>(),
      info[2].As<Napi::Buffer<uint8_t>>());
  auto promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value Decompress(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "decompress(buffer) expects a Buffer")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto* worker =
      new DecompressWorker(env, info[0].As<Napi::Buffer<uint8_t>>());
  auto promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value CompressSync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "compressSync(buffer) expects a Buffer")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  std::vector<uint8_t> out;
  std::string err;
  if (!compressBytes(buf.Data(), buf.Length(), out, err)) {
    Napi::Error::New(env, err.empty() ? "compress failed" : err)
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Buffer<uint8_t>::Copy(env, out.data(), out.size());
}

Napi::Value DecompressSync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "decompressSync(buffer) expects a Buffer")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  std::vector<uint8_t> out;
  std::string err;
  if (!decompressBytes(buf.Data(), buf.Length(), out, err)) {
    Napi::Error::New(env, err.empty() ? "decompress failed" : err)
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Buffer<uint8_t>::Copy(env, out.data(), out.size());
}

Napi::Value IsAvailable(const Napi::CallbackInfo& info) {
  std::string err;
  return Napi::Boolean::New(info.Env(), ensureSerial(err));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // Eager init so isAvailable() and first request share the same cost
  std::string err;
  (void)ensureSerial(err);

  exports.Set("compress", Napi::Function::New(env, Compress));
  exports.Set("compressTrained", Napi::Function::New(env, CompressTrained));
  exports.Set("decompress", Napi::Function::New(env, Decompress));
  exports.Set("compressSync", Napi::Function::New(env, CompressSync));
  exports.Set("decompressSync", Napi::Function::New(env, DecompressSync));
  exports.Set("isAvailable", Napi::Function::New(env, IsAvailable));
  exports.Set(
      "backend",
      Napi::String::New(env, "native-openzl-serial")
  );
  return exports;
}

}  // namespace

NODE_API_MODULE(openzl_native, Init)
