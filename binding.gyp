{
  "targets": [{
    "target_name": "diskroom_native",
    "sources": ["native/diskroom_native.c"],
    "defines": ["NAPI_VERSION=8", "_FILE_OFFSET_BITS=64"],
    "cflags": ["-std=c11", "-Wall", "-Wextra"],
    "xcode_settings": {"GCC_C_LANGUAGE_STANDARD": "c11", "MACOSX_DEPLOYMENT_TARGET": "11.0"},
    "msvs_settings": {"VCCLCompilerTool": {"AdditionalOptions": ["/std:c11", "/W4"]}}
  }]
}
