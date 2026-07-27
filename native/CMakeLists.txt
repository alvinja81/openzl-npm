cmake_minimum_required(VERSION 3.20)
cmake_policy(SET CMP0042 NEW)
cmake_policy(SET CMP0091 NEW)
project(openzl_native)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# cmake-js injects CMAKE_JS_INC / CMAKE_JS_SRC / CMAKE_JS_LIB
include_directories(${CMAKE_JS_INC})

add_library(${PROJECT_NAME} SHARED
  src/binding.cpp
  ${CMAKE_JS_SRC}
)

set_target_properties(${PROJECT_NAME} PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "openzl_native"
)

# node-addon-api (header-only)
# Prefer local node_modules, fall back to parent (when building from monorepo root)
find_path(NAPI_INCLUDE
  NAMES napi.h
  PATHS
    "${CMAKE_SOURCE_DIR}/../node_modules/node-addon-api"
    "${CMAKE_SOURCE_DIR}/node_modules/node-addon-api"
  NO_DEFAULT_PATH
)
if(NOT NAPI_INCLUDE)
  message(FATAL_ERROR "node-addon-api headers not found. Run npm install first.")
endif()
target_include_directories(${PROJECT_NAME} PRIVATE ${NAPI_INCLUDE})
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)

# OpenZL source + prebuilt static libs (built via scripts/build-openzl.sh)
set(OPENZL_ROOT "${CMAKE_SOURCE_DIR}/../openzl" CACHE PATH "OpenZL source root")
set(OPENZL_BUILD "${OPENZL_ROOT}/build-lib" CACHE PATH "OpenZL CMake build dir")

if(NOT EXISTS "${OPENZL_ROOT}/include/openzl/openzl.h")
  message(FATAL_ERROR
    "OpenZL sources not found at ${OPENZL_ROOT}.\n"
    "Clone facebook/openzl into ./openzl and run: npm run build:openzl")
endif()

if(NOT EXISTS "${OPENZL_BUILD}/libopenzl.a")
  message(FATAL_ERROR
    "libopenzl.a not found at ${OPENZL_BUILD}.\n"
    "Run: npm run build:openzl")
endif()

target_include_directories(${PROJECT_NAME} PRIVATE
  "${OPENZL_ROOT}/include"
  "${OPENZL_ROOT}/src"
  "${OPENZL_ROOT}"
  "${OPENZL_BUILD}/include"
)

# Order: openzl then its static deps
set(OPENZL_LIBS
  "${OPENZL_BUILD}/libopenzl.a"
  "${OPENZL_BUILD}/zstd_build/lib/libzstd.a"
  "${OPENZL_BUILD}/lz4_build/liblz4.a"
)

foreach(lib ${OPENZL_LIBS})
  if(NOT EXISTS "${lib}")
    message(FATAL_ERROR "Missing OpenZL dependency: ${lib}")
  endif()
endforeach()

target_link_libraries(${PROJECT_NAME} PRIVATE ${CMAKE_JS_LIB} ${OPENZL_LIBS})

if(APPLE)
  set_target_properties(${PROJECT_NAME} PROPERTIES
    LINK_FLAGS "-undefined dynamic_lookup"
  )
elseif(UNIX)
  target_link_libraries(${PROJECT_NAME} PRIVATE pthread m)
endif()
