/**
 * Thin C glue for browser/Node WASM: decode-only OpenZL API.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "openzl/zl_decompress.h"
#include "openzl/zl_errors.h"

static char g_last_error[256];

static void set_error(const char* msg) {
  if (!msg) {
    g_last_error[0] = '\0';
    return;
  }
  size_t n = strlen(msg);
  if (n >= sizeof(g_last_error)) n = sizeof(g_last_error) - 1;
  memcpy(g_last_error, msg, n);
  g_last_error[n] = '\0';
}

const char* openzl_last_error(void) {
  return g_last_error;
}

/**
 * @return decompressed size, or 0 on error (see openzl_last_error).
 */
size_t openzl_get_decompressed_size(const uint8_t* src, size_t srcSize) {
  set_error(NULL);
  if (!src || srcSize == 0) {
    set_error("empty input");
    return 0;
  }
  ZL_Report r = ZL_getDecompressedSize(src, srcSize);
  if (ZL_isError(r)) {
    set_error(ZL_ErrorCode_toString(ZL_errorCode(r)));
    return 0;
  }
  return ZL_validResult(r);
}

/**
 * Decompress into caller-provided buffer.
 * @return 0 on success, non-zero on error.
 * On success *outLen is written with decompressed byte count.
 */
int openzl_decompress(
    const uint8_t* src,
    size_t srcSize,
    uint8_t* dst,
    size_t dstCapacity,
    size_t* outLen
) {
  set_error(NULL);
  if (!src || srcSize == 0 || !dst || !outLen) {
    set_error("invalid arguments");
    return 1;
  }
  ZL_Report r = ZL_decompress(dst, dstCapacity, src, srcSize);
  if (ZL_isError(r)) {
    set_error(ZL_ErrorCode_toString(ZL_errorCode(r)));
    return 1;
  }
  *outLen = ZL_validResult(r);
  return 0;
}

/** Library version string for diagnostics. */
const char* openzl_version(void) {
  return "openzl-wasm-decode";
}
