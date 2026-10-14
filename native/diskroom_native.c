/* Descriptor-anchored single-entry filesystem operations. No recursive delete API.
 * N-API v8; no V8 ABI dependency. See README.md for the POSIX leaf-race boundary.
 */
#ifndef _WIN32
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#if defined(__APPLE__) && !defined(_DARWIN_C_SOURCE)
/* Darwin's POSIX namespace hides st_*timespec and O_NOFOLLOW unless its
 * extensions are enabled. Keep the nanosecond identity and no-follow APIs. */
#define _DARWIN_C_SOURCE 1
#endif
#endif
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#ifdef _WIN32
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0602
#endif
#include <windows.h>
#include <winioctl.h>
#include <winternl.h>
#include <wchar.h>
#else
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <dirent.h>
#include <unistd.h>
#include <errno.h>
#endif

#define MAX_ENTRIES 250000u
#define NAPI_TRY(expression) do { if ((expression) != napi_ok) { napi_throw_error(env, "ERR_NAPI", "Native argument or allocation failure"); return NULL; } } while (0)

typedef struct dr_handle {
  unsigned refs;
  struct dr_handle *parent;
#ifdef _WIN32
  HANDLE handle;
#else
  int fd;
#endif
} dr_handle;
typedef struct { dr_handle *resource; } dr_wrapper;
static const napi_type_tag handle_type_tag = { UINT64_C(0x5a8b4a43f6f04328), UINT64_C(0xb28689853da0367d) };
typedef struct {
  uint64_t dev, ino, size, links;
  uint32_t mode;
  int64_t mtime_sec, ctime_sec;
  long mtime_nsec, ctime_nsec;
  int directory, symlink, unsupported;
} dr_stat;

static napi_value error(napi_env env, const char *code, const char *message) {
  napi_throw_error(env, code, message);
  return NULL;
}
static napi_value os_error(napi_env env, const char *operation) {
  char message[512];
#ifdef _WIN32
  DWORD code = GetLastError();
  const char *name = code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND ? "ENOENT" : code == ERROR_ACCESS_DENIED ? "EACCES" : code == ERROR_DIR_NOT_EMPTY ? "ENOTEMPTY" : code == ERROR_SHARING_VIOLATION ? "EBUSY" : "ERR_NATIVE_IO";
  snprintf(message, sizeof(message), "%s failed (Windows error %lu)", operation, (unsigned long)code);
#else
  int code = errno;
  const char *name = code == ENOENT ? "ENOENT" : code == EACCES ? "EACCES" : code == ENOTEMPTY ? "ENOTEMPTY" : code == ELOOP ? "ELOOP" : code == ENOTDIR ? "ENOTDIR" : code == EXDEV ? "EXDEV" : "ERR_NATIVE_IO";
  snprintf(message, sizeof(message), "%s: %s", operation, strerror(code));
#endif
  return error(env, name, message);
}
static void release(dr_handle *h) {
  while (h) {
    if (--h->refs) return;
    dr_handle *parent = h->parent;
#ifdef _WIN32
    CloseHandle(h->handle);
#else
    close(h->fd);
#endif
    free(h);
    h = parent;
  }
}
static void finalize(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  dr_wrapper *wrapper = (dr_wrapper *)data;
  release(wrapper->resource);
  free(wrapper);
}
static napi_value wrap(napi_env env, dr_handle *handle) {
  dr_wrapper *wrapper = (dr_wrapper *)calloc(1, sizeof(*wrapper));
  if (!wrapper) { release(handle); return error(env, "ENOMEM", "Cannot allocate directory wrapper"); }
  wrapper->resource = handle;
  napi_value value;
  if (napi_create_object(env, &value) != napi_ok || napi_type_tag_object(env, value, &handle_type_tag) != napi_ok ||
      napi_wrap(env, value, wrapper, finalize, NULL, NULL) != napi_ok) {
    release(handle); free(wrapper); return error(env, "ERR_NAPI", "Cannot create directory wrapper");
  }
  return value;
}
static dr_wrapper *get_wrapper(napi_env env, napi_value value) {
  void *data = NULL; bool tagged = false; napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_object ||
      napi_check_object_type_tag(env, value, &handle_type_tag, &tagged) != napi_ok || !tagged ||
      napi_unwrap(env, value, &data) != napi_ok || !data) {
    error(env, "ERR_INVALID_HANDLE", "Expected a native directory handle"); return NULL;
  }
  return (dr_wrapper *)data;
}
static dr_handle *get_handle(napi_env env, napi_value value) {
  dr_wrapper *wrapper = get_wrapper(env, value);
  if (!wrapper) return NULL;
  if (!wrapper->resource) { error(env, "ERR_CLOSED_HANDLE", "Directory handle is closed"); return NULL; }
  return wrapper->resource;
}
static char *get_string(napi_env env, napi_value value) {
  size_t length = 0, copied = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok || length == 0 || length > 1024 * 1024) {
    error(env, "ERR_INVALID_PATH", "Expected a nonempty path string"); return NULL;
  }
  char *text = (char *)malloc(length + 1);
  if (!text) { error(env, "ENOMEM", "Cannot allocate path"); return NULL; }
  if (napi_get_value_string_utf8(env, value, text, length + 1, &copied) != napi_ok || copied != length || strlen(text) != length) {
    free(text); error(env, "ERR_INVALID_PATH", "Path contains an embedded NUL"); return NULL;
  }
  return text;
}
static int valid_name(const char *name) {
  if (!*name || !strcmp(name, ".") || !strcmp(name, "..") || strchr(name, '/')) return 0;
#ifdef _WIN32
  size_t len = strlen(name);
  if (strpbrk(name, "\\:*?\"<>|") || name[len - 1] == '.' || name[len - 1] == ' ') return 0;
#endif
  return 1;
}
static char *get_name(napi_env env, napi_value value) {
  char *name = get_string(env, value);
  if (name && !valid_name(name)) { free(name); error(env, "ERR_INVALID_PATH", "Expected exactly one ordinary directory entry name"); return NULL; }
  return name;
}
#ifndef _WIN32
static int valid_utf8(const unsigned char *text) {
  while (*text) {
    uint32_t point; unsigned trailing;
    if (*text < 0x80) { ++text; continue; }
    if (*text >= 0xc2 && *text <= 0xdf) { point = *text & 0x1f; trailing = 1; }
    else if (*text >= 0xe0 && *text <= 0xef) { point = *text & 0x0f; trailing = 2; }
    else if (*text >= 0xf0 && *text <= 0xf4) { point = *text & 7; trailing = 3; }
    else return 0;
    ++text;
    for (unsigned i = 0; i < trailing; ++i) {
      if ((*text & 0xc0) != 0x80) return 0;
      point = (point << 6) | (*text++ & 0x3f);
    }
    if ((trailing == 1 && point < 0x80) || (trailing == 2 && point < 0x800) ||
      (trailing == 3 && point < 0x10000) || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return 0;
  }
  return 1;
}
#endif
static int args(napi_env env, napi_callback_info info, size_t required, size_t max, napi_value *values, size_t *actual) {
  *actual = max;
  if (napi_get_cb_info(env, info, actual, values, NULL, NULL) != napi_ok || *actual < required) {
    error(env, "ERR_INVALID_ARGUMENT", "Missing required native arguments"); return 0;
  }
  return 1;
}

#ifdef _WIN32
static wchar_t *wide_path(const char *text) {
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, -1, NULL, 0);
  if (!length) return NULL;
  wchar_t *wide = (wchar_t *)malloc((size_t)length * sizeof(wchar_t));
  if (!wide) { SetLastError(ERROR_NOT_ENOUGH_MEMORY); return NULL; }
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, -1, wide, length)) { free(wide); return NULL; }
  return wide;
}
static HANDLE open_relative(dr_handle *parent, const char *name, ACCESS_MASK access, int directory) {
  typedef NTSTATUS (NTAPI *create_file_fn)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
  typedef ULONG (WINAPI *status_to_error_fn)(NTSTATUS);
  HMODULE module = GetModuleHandleW(L"ntdll.dll");
  create_file_fn create_file = module ? (create_file_fn)GetProcAddress(module, "NtCreateFile") : NULL;
  status_to_error_fn status_to_error = module ? (status_to_error_fn)GetProcAddress(module, "RtlNtStatusToDosError") : NULL;
  if (!create_file || !status_to_error) { SetLastError(ERROR_NOT_SUPPORTED); return INVALID_HANDLE_VALUE; }
  wchar_t *wide = wide_path(name);
  if (!wide) return INVALID_HANDLE_VALUE;
  size_t bytes = wcslen(wide) * sizeof(wchar_t);
  if (bytes > 65532) { free(wide); SetLastError(ERROR_FILENAME_EXCED_RANGE); return INVALID_HANDLE_VALUE; }
  UNICODE_STRING string;
  string.Length = (USHORT)bytes; string.MaximumLength = (USHORT)(bytes + sizeof(wchar_t)); string.Buffer = wide;
  OBJECT_ATTRIBUTES attributes;
  memset(&attributes, 0, sizeof(attributes));
  attributes.Length = sizeof(attributes); attributes.RootDirectory = parent->handle;
  attributes.ObjectName = &string; attributes.Attributes = 0x40; /* OBJ_CASE_INSENSITIVE */
  IO_STATUS_BLOCK status_block;
  memset(&status_block, 0, sizeof(status_block));
  HANDLE child = INVALID_HANDLE_VALUE;
  // FILE_OPEN, FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT,
  // optional FILE_DIRECTORY_FILE. Only a single validated component is resolved.
  NTSTATUS status = create_file(&child, access | SYNCHRONIZE, &attributes, &status_block, NULL, 0,
    FILE_SHARE_READ, 1, 0x00200000u | 0x00000020u | (directory ? 0x00000001u : 0), NULL, 0);
  free(wide);
  if (status < 0) { SetLastError(status_to_error(status)); return INVALID_HANDLE_VALUE; }
  return child;
}
static HANDLE reopen_directory_attributes(dr_handle *directory) {
  typedef NTSTATUS (NTAPI *open_file_fn)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, ULONG, ULONG);
  typedef ULONG (WINAPI *status_to_error_fn)(NTSTATUS);
  HMODULE module = GetModuleHandleW(L"ntdll.dll");
  open_file_fn open_file = module ? (open_file_fn)GetProcAddress(module, "NtOpenFile") : NULL;
  status_to_error_fn status_to_error = module ? (status_to_error_fn)GetProcAddress(module, "RtlNtStatusToDosError") : NULL;
  if (!open_file || !status_to_error) { SetLastError(ERROR_NOT_SUPPORTED); return INVALID_HANDLE_VALUE; }
  // An empty name relative to a held handle reopens that same object. Use
  // explicit directory semantics; ReOpenFile can reject directory handles.
  UNICODE_STRING empty = {0};
  OBJECT_ATTRIBUTES attributes = {0};
  attributes.Length = sizeof(attributes); attributes.RootDirectory = directory->handle;
  attributes.ObjectName = &empty; attributes.Attributes = 0x40; /* OBJ_CASE_INSENSITIVE */
  IO_STATUS_BLOCK status_block = {0};
  HANDLE writable = INVALID_HANDLE_VALUE;
  NTSTATUS status = open_file(&writable, FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE,
    &attributes, &status_block, FILE_SHARE_READ,
    0x00000001u | 0x00200000u | 0x00000020u); /* DIRECTORY, OPEN_REPARSE_POINT, SYNCHRONOUS_IO_NONALERT */
  if (status < 0) { SetLastError(status_to_error(status)); return INVALID_HANDLE_VALUE; }
  return writable;
}
static void windows_time(LARGE_INTEGER time, int64_t *seconds, long *nanos) {
  int64_t ticks = time.QuadPart - INT64_C(116444736000000000);
  *seconds = ticks / INT64_C(10000000);
  *nanos = (long)((ticks % INT64_C(10000000)) * 100);
  if (*nanos < 0) { --*seconds; *nanos += 1000000000L; }
}
static int drive_letter(wchar_t value) {
  return (value >= L'A' && value <= L'Z') || (value >= L'a' && value <= L'z');
}
static int link_size(HANDLE handle, DWORD tag, uint64_t *size, int *unsupported) {
  union { LARGE_INTEGER alignment; unsigned char bytes[16384]; } storage;
  DWORD received = 0;
  if (!DeviceIoControl(handle, FSCTL_GET_REPARSE_POINT, NULL, 0, storage.bytes, sizeof(storage.bytes), &received, NULL)) return 0;
  const size_t base = tag == IO_REPARSE_TAG_SYMLINK ? 20 : 16;
  if (received < base) { SetLastError(ERROR_INVALID_REPARSE_DATA); return 0; }
  uint16_t offset, byte_length;
  memcpy(&offset, storage.bytes + 8, sizeof(offset));
  memcpy(&byte_length, storage.bytes + 10, sizeof(byte_length));
  if ((offset & 1) || (byte_length & 1) || base + offset + byte_length > received) { SetLastError(ERROR_INVALID_REPARSE_DATA); return 0; }
  wchar_t *target = (wchar_t *)(storage.bytes + base + offset);
  size_t length = byte_length / sizeof(wchar_t);
  int nt_prefix = length >= 4 && target[0] == L'\\' && target[1] == L'?' && target[2] == L'?' && target[3] == L'\\';
  int drive_prefix = nt_prefix && length >= 6 && drive_letter(target[4]) && target[5] == L':' && (length == 6 || target[6] == L'\\');
  if (tag == IO_REPARSE_TAG_MOUNT_POINT) {
    // Volume mount points are not ordinary links and must not be cleaned.
    if (!drive_prefix) { *unsupported = 1; return 1; }
    target += 4; length -= 4;
  } else if (drive_prefix) { target += 4; length -= 4; }
  else if (nt_prefix && length >= 8 && (target[4] == L'U' || target[4] == L'u') &&
    (target[5] == L'N' || target[5] == L'n') && (target[6] == L'C' || target[6] == L'c') && target[7] == L'\\') {
    target += 6; length -= 6; target[0] = L'\\';
  }
  if (length == 0) { *size = 0; return 1; }
  int bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, target, (int)length, NULL, 0, NULL, NULL);
  if (!bytes) return 0;
  *size = (uint64_t)bytes;
  return 1;
}
static int stat_handle(HANDLE handle, dr_stat *result) {
  BY_HANDLE_FILE_INFORMATION info;
  FILE_BASIC_INFO basic;
  if (!GetFileInformationByHandle(handle, &info) || !GetFileInformationByHandleEx(handle, FileBasicInfo, &basic, sizeof(basic))) return 0;
  memset(result, 0, sizeof(*result));
  result->dev = info.dwVolumeSerialNumber;
  result->ino = ((uint64_t)info.nFileIndexHigh << 32) | info.nFileIndexLow;
  result->size = ((uint64_t)info.nFileSizeHigh << 32) | info.nFileSizeLow;
  result->links = info.nNumberOfLinks;
  result->directory = !!(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY);
  result->symlink = !!(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT);
  if (result->symlink) {
    FILE_ATTRIBUTE_TAG_INFO tag;
    if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag))) return 0;
    result->unsupported = tag.ReparseTag != IO_REPARSE_TAG_SYMLINK && tag.ReparseTag != IO_REPARSE_TAG_MOUNT_POINT;
    if (!result->unsupported && !link_size(handle, tag.ReparseTag, &result->size, &result->unsupported)) return 0;
  }
  if (result->directory && !result->symlink) result->size = 0;
  // Match libuv's lstat representation, including link type and target-byte size.
  result->mode = (result->symlink ? 0120000u : result->directory ? 0040000u : 0100000u) | 0444u;
  if (!(info.dwFileAttributes & FILE_ATTRIBUTE_READONLY)) result->mode |= 0222u;
  windows_time(basic.LastWriteTime, &result->mtime_sec, &result->mtime_nsec);
  windows_time(basic.ChangeTime, &result->ctime_sec, &result->ctime_nsec);
  return 1;
}
static dr_handle *wrap_windows_handle(HANDLE handle, dr_handle *parent) {
  if (handle == INVALID_HANDLE_VALUE) return NULL;
  dr_stat st;
  if (!stat_handle(handle, &st) || !st.directory || st.symlink) { CloseHandle(handle); SetLastError(ERROR_CANT_ACCESS_FILE); return NULL; }
  dr_handle *result = (dr_handle *)calloc(1, sizeof(*result));
  if (!result) { CloseHandle(handle); SetLastError(ERROR_NOT_ENOUGH_MEMORY); return NULL; }
  result->handle = handle; result->refs = 1; result->parent = parent;
  if (parent) ++parent->refs;
  return result;
}
static dr_handle *open_child(dr_handle *parent, const char *name) {
  return wrap_windows_handle(open_relative(parent, name, FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES, 1), parent);
}
static int get_stat(dr_handle *h, dr_stat *result) { return stat_handle(h->handle, result); }
static int get_child_stat(dr_handle *parent, const char *name, dr_stat *result) {
  HANDLE child = open_relative(parent, name, FILE_READ_ATTRIBUTES, 0);
  if (child == INVALID_HANDLE_VALUE) return 0;
  int ok = stat_handle(child, result); DWORD code = GetLastError();
  CloseHandle(child); SetLastError(code); return ok;
}
#else
static void copy_stat(const struct stat *st, dr_stat *result) {
  memset(result, 0, sizeof(*result));
  result->dev = (uint64_t)st->st_dev; result->ino = (uint64_t)st->st_ino;
  result->size = (uint64_t)st->st_size; result->links = (uint64_t)st->st_nlink; result->mode = (uint32_t)st->st_mode;
  result->directory = S_ISDIR(st->st_mode); result->symlink = S_ISLNK(st->st_mode);
#ifdef __APPLE__
  result->mtime_sec = st->st_mtimespec.tv_sec; result->mtime_nsec = st->st_mtimespec.tv_nsec;
  result->ctime_sec = st->st_ctimespec.tv_sec; result->ctime_nsec = st->st_ctimespec.tv_nsec;
#else
  result->mtime_sec = st->st_mtim.tv_sec; result->mtime_nsec = st->st_mtim.tv_nsec;
  result->ctime_sec = st->st_ctim.tv_sec; result->ctime_nsec = st->st_ctim.tv_nsec;
#endif
}
static dr_handle *wrap_fd(int fd, dr_handle *parent) {
  if (fd < 0) return NULL;
  dr_handle *result = (dr_handle *)calloc(1, sizeof(*result));
  if (!result) { close(fd); errno = ENOMEM; return NULL; }
  result->fd = fd; result->refs = 1; result->parent = parent;
  if (parent) ++parent->refs;
  return result;
}
static dr_handle *open_child(dr_handle *parent, const char *name) {
  return wrap_fd(openat(parent->fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC), parent);
}
static int get_stat(dr_handle *h, dr_stat *result) {
  struct stat st;
  if (fstat(h->fd, &st)) return 0;
  copy_stat(&st, result); return 1;
}
static int get_child_stat(dr_handle *parent, const char *name, dr_stat *result) {
  struct stat st;
  if (fstatat(parent->fd, name, &st, AT_SYMLINK_NOFOLLOW)) return 0;
  copy_stat(&st, result); return 1;
}
#endif

static napi_value set_number(napi_env env, napi_value object, const char *key, double number) {
  napi_value value;
  NAPI_TRY(napi_create_double(env, number, &value));
  NAPI_TRY(napi_set_named_property(env, object, key, value));
  return object;
}
static napi_value set_string(napi_env env, napi_value object, const char *key, const char *text) {
  napi_value value;
  NAPI_TRY(napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &value));
  NAPI_TRY(napi_set_named_property(env, object, key, value));
  return object;
}
static double milliseconds(int64_t seconds, long nanos) { return (double)seconds * 1000.0 + (double)nanos / 1000000.0; }
static const char *type_name(const dr_stat *st) {
  return st->unsupported ? "other" : st->symlink ? "symlink" : st->directory ? "directory" : (st->mode & 0170000u) == 0100000u ? "file" : "other";
}
static void identity_string(const dr_stat *st, char *buffer, size_t size) {
  snprintf(buffer, size, "%llu:%llu:%u", (unsigned long long)st->dev, (unsigned long long)st->ino, st->mode & 0170000u);
}
static void time_string(int64_t seconds, long nanos, char *buffer, size_t size) {
  // Delimited seconds/nanoseconds avoid integer overflow and preserve all precision.
  snprintf(buffer, size, "%lld:%09ld", (long long)seconds, nanos);
}
static napi_value make_stat(napi_env env, const dr_stat *st) {
  napi_value object;
  NAPI_TRY(napi_create_object(env, &object));
  if (!set_number(env, object, "dev", (double)st->dev) || !set_number(env, object, "ino", (double)st->ino) ||
      !set_number(env, object, "size", (double)st->size) || !set_number(env, object, "nlink", (double)st->links) ||
      !set_number(env, object, "mode", (double)st->mode) ||
      !set_number(env, object, "mtimeMs", milliseconds(st->mtime_sec, st->mtime_nsec)) ||
      !set_number(env, object, "ctimeMs", milliseconds(st->ctime_sec, st->ctime_nsec)) ||
      !set_string(env, object, "type", type_name(st))) return NULL;
  char buffer[128];
  identity_string(st, buffer, sizeof(buffer)); if (!set_string(env, object, "identity", buffer)) return NULL;
  time_string(st->mtime_sec, st->mtime_nsec, buffer, sizeof(buffer)); if (!set_string(env, object, "mtimeNs", buffer)) return NULL;
  time_string(st->ctime_sec, st->ctime_nsec, buffer, sizeof(buffer)); if (!set_string(env, object, "ctimeNs", buffer)) return NULL;
  return object;
}
static int number_matches(napi_env env, napi_value object, const char *key, double expected) {
  napi_value value; double number;
  return napi_get_named_property(env, object, key, &value) == napi_ok && napi_get_value_double(env, value, &number) == napi_ok && isfinite(number) && number == expected;
}
static int optional_string_matches(napi_env env, napi_value object, const char *key, const char *expected) {
  bool present = false; napi_value value; char buffer[160]; size_t length;
  if (napi_has_named_property(env, object, key, &present) != napi_ok) return 0;
  if (!present) return 1;
  return napi_get_named_property(env, object, key, &value) == napi_ok &&
    napi_get_value_string_utf8(env, value, buffer, sizeof(buffer), &length) == napi_ok &&
    length == strlen(expected) && !strcmp(buffer, expected);
}
static int matches(napi_env env, napi_value expected, const dr_stat *st, int identity_only) {
  char buffer[128];
  if (!number_matches(env, expected, "dev", (double)st->dev) || !number_matches(env, expected, "ino", (double)st->ino)) return 0;
  identity_string(st, buffer, sizeof(buffer));
  if (!optional_string_matches(env, expected, "identity", buffer) || !optional_string_matches(env, expected, "type", type_name(st))) return 0;
  if (identity_only) return st->directory && !st->symlink;
  if (!number_matches(env, expected, "mode", (double)st->mode) || !number_matches(env, expected, "size", (double)st->size) ||
      !number_matches(env, expected, "mtimeMs", milliseconds(st->mtime_sec, st->mtime_nsec)) ||
      !number_matches(env, expected, "ctimeMs", milliseconds(st->ctime_sec, st->ctime_nsec))) return 0;
  time_string(st->mtime_sec, st->mtime_nsec, buffer, sizeof(buffer));
  if (!optional_string_matches(env, expected, "mtimeNs", buffer)) return 0;
  time_string(st->ctime_sec, st->ctime_nsec, buffer, sizeof(buffer));
  return optional_string_matches(env, expected, "ctimeNs", buffer);
}

static napi_value native_open_root(napi_env env, napi_callback_info info) {
  napi_value values[1]; size_t count;
  if (!args(env, info, 1, 1, values, &count)) return NULL;
  char *path = get_string(env, values[0]); if (!path) return NULL;
  dr_handle *current = NULL;
#ifdef _WIN32
  for (char *p = path; *p; ++p) if (*p == '/') *p = '\\';
  char *start = path;
  if (!strncmp(start, "\\\\?\\", 4)) start += 4;
  if (!((start[0] >= 'A' && start[0] <= 'Z') || (start[0] >= 'a' && start[0] <= 'z')) || start[1] != ':' || start[2] != '\\') {
    free(path); return error(env, "ERR_INVALID_PATH", "Native cleanup requires an absolute local drive path; UNC paths are unsupported");
  }
  wchar_t root[8] = {L'\\', L'\\', L'?', L'\\', (wchar_t)start[0], L':', L'\\', 0};
  wchar_t drive[4] = {(wchar_t)start[0], L':', L'\\', 0};
  if (GetDriveTypeW(drive) == DRIVE_REMOTE) { free(path); return error(env, "ERR_UNSUPPORTED_VOLUME", "Network drive cleanup is unsupported"); }
  current = wrap_windows_handle(CreateFileW(root, FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL), NULL);
  char *cursor = start + 3;
  const char delimiter = '\\';
#else
  if (path[0] != '/') { free(path); return error(env, "ERR_INVALID_PATH", "Expected an absolute path"); }
  current = wrap_fd(open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC), NULL);
  char *cursor = path + 1;
  const char delimiter = '/';
#endif
  if (!current) { free(path); return os_error(env, "open filesystem root"); }
  while (*cursor) {
    while (*cursor == delimiter) ++cursor;
    if (!*cursor) break;
    char *end = strchr(cursor, delimiter);
    if (end) *end = 0;
    if (!valid_name(cursor)) { release(current); free(path); return error(env, "ERR_INVALID_PATH", "Dot segments and invalid path components are forbidden"); }
    dr_handle *child = open_child(current, cursor);
    if (!child) { napi_value failure = os_error(env, "open directory component without following links"); release(current); free(path); return failure; }
    release(current); current = child;
    if (!end) break;
    cursor = end + 1;
  }
  free(path); return wrap(env, current);
}
static napi_value native_open_directory(napi_env env, napi_callback_info info) {
  napi_value values[2]; size_t count;
  if (!args(env, info, 2, 2, values, &count)) return NULL;
  dr_handle *parent = get_handle(env, values[0]); if (!parent) return NULL;
  char *name = get_name(env, values[1]); if (!name) return NULL;
  dr_handle *child = open_child(parent, name); free(name);
  if (!child) return os_error(env, "open child directory without following links");
  dr_stat before, after;
  if (!get_stat(parent, &before) || !get_stat(child, &after)) { napi_value failure = os_error(env, "stat directory"); release(child); return failure; }
  if (before.dev != after.dev) { release(child); return error(env, "EXDEV", "Cross-volume directory traversal is forbidden"); }
  return wrap(env, child);
}
static napi_value native_stat(napi_env env, napi_callback_info info) {
  napi_value values[1]; size_t count; dr_stat st;
  if (!args(env, info, 1, 1, values, &count)) return NULL;
  dr_handle *handle = get_handle(env, values[0]); if (!handle) return NULL;
  if (!get_stat(handle, &st)) return os_error(env, "stat directory handle");
  return make_stat(env, &st);
}
static napi_value native_stat_child(napi_env env, napi_callback_info info) {
  napi_value values[2]; size_t count; dr_stat st;
  if (!args(env, info, 2, 2, values, &count)) return NULL;
  dr_handle *parent = get_handle(env, values[0]); if (!parent) return NULL;
  char *name = get_name(env, values[1]); if (!name) return NULL;
  int ok = get_child_stat(parent, name, &st); free(name);
  if (!ok) return os_error(env, "stat child without following links");
  return make_stat(env, &st);
}
static napi_value native_read_directory(napi_env env, napi_callback_info info) {
  napi_value values[1], array; size_t count; uint32_t index = 0;
  if (!args(env, info, 1, 1, values, &count)) return NULL;
  dr_handle *parent = get_handle(env, values[0]); if (!parent) return NULL;
  NAPI_TRY(napi_create_array(env, &array));
#ifdef _WIN32
  // Handle enumeration never resolves a path or follows a reparse point.
  union { FILE_ID_BOTH_DIR_INFO alignment; unsigned char bytes[65536]; } storage;
  unsigned char *buffer = storage.bytes;
  FILE_INFO_BY_HANDLE_CLASS query = FileIdBothDirectoryRestartInfo;
  for (;;) {
    if (!GetFileInformationByHandleEx(parent->handle, query, buffer, sizeof(storage.bytes))) {
      if (GetLastError() == ERROR_NO_MORE_FILES) break;
      return os_error(env, "enumerate directory handle");
    }
    query = FileIdBothDirectoryInfo;
    FILE_ID_BOTH_DIR_INFO *entry = (FILE_ID_BOTH_DIR_INFO *)buffer;
    for (;;) {
      size_t length = entry->FileNameLength / sizeof(wchar_t);
      if (!((length == 1 && entry->FileName[0] == L'.') || (length == 2 && entry->FileName[0] == L'.' && entry->FileName[1] == L'.'))) {
        if (index >= MAX_ENTRIES) return error(env, "ERR_DIRECTORY_LIMIT", "Directory exceeds the safe native enumeration limit");
        for (size_t i = 0; i < length; ++i) {
          uint16_t unit = entry->FileName[i];
          if (unit >= 0xd800 && unit <= 0xdbff) {
            if (++i == length || entry->FileName[i] < 0xdc00 || entry->FileName[i] > 0xdfff) return error(env, "ERR_FILENAME_ENCODING", "Directory contains an unrepresentable filename");
          } else if (unit >= 0xdc00 && unit <= 0xdfff) return error(env, "ERR_FILENAME_ENCODING", "Directory contains an unrepresentable filename");
        }
        napi_value name;
        NAPI_TRY(napi_create_string_utf16(env, (const char16_t *)entry->FileName, length, &name));
        NAPI_TRY(napi_set_element(env, array, index++, name));
      }
      if (!entry->NextEntryOffset) break;
      entry = (FILE_ID_BOTH_DIR_INFO *)((unsigned char *)entry + entry->NextEntryOffset);
    }
  }
#else
  int fd = openat(parent->fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return os_error(env, "open directory cursor");
  DIR *directory = fdopendir(fd);
  if (!directory) { int saved = errno; close(fd); errno = saved; return os_error(env, "open directory stream"); }
  struct dirent *entry;
  errno = 0;
  while ((entry = readdir(directory)) != NULL) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (index >= MAX_ENTRIES) { closedir(directory); return error(env, "ERR_DIRECTORY_LIMIT", "Directory exceeds the safe native enumeration limit"); }
    if (!valid_utf8((const unsigned char *)entry->d_name)) { closedir(directory); return error(env, "ERR_FILENAME_ENCODING", "Directory contains an unrepresentable filename"); }
    napi_value name;
    if (napi_create_string_utf8(env, entry->d_name, NAPI_AUTO_LENGTH, &name) != napi_ok || napi_set_element(env, array, index++, name) != napi_ok) {
      closedir(directory); return error(env, "ERR_NAPI", "Cannot allocate directory entries");
    }
    errno = 0;
  }
  int saved = errno; closedir(directory);
  if (saved) { errno = saved; return os_error(env, "read directory stream"); }
#endif
  return array;
}
static napi_value native_remove_child(napi_env env, napi_callback_info info) {
  napi_value values[4]; size_t count; dr_stat st; bool identity_only = false;
  if (!args(env, info, 3, 4, values, &count)) return NULL;
  dr_handle *parent = get_handle(env, values[0]); if (!parent) return NULL;
  char *name = get_name(env, values[1]); if (!name) return NULL;
  if (count > 3) {
    napi_value flag; bool present = false;
    if (napi_has_named_property(env, values[3], "directoryIdentityOnly", &present) != napi_ok ||
      (present && (napi_get_named_property(env, values[3], "directoryIdentityOnly", &flag) != napi_ok || napi_get_value_bool(env, flag, &identity_only) != napi_ok))) {
      free(name); return error(env, "ERR_INVALID_ARGUMENT", "directoryIdentityOnly must be a boolean");
    }
  }
#ifdef _WIN32
  HANDLE child = open_relative(parent, name, DELETE | FILE_READ_ATTRIBUTES, 0);
  free(name);
  if (child == INVALID_HANDLE_VALUE) return os_error(env, "open exact child for deletion");
  if (!stat_handle(child, &st)) { napi_value failure = os_error(env, "stat exact child"); CloseHandle(child); return failure; }
  if (strcmp(type_name(&st), "other") == 0 || !matches(env, values[2], &st, identity_only)) {
    CloseHandle(child); return error(env, "ERR_CHANGED_ENTRY", "Entry changed or has an unsupported filesystem/reparse type");
  }
  FILE_DISPOSITION_INFO disposition; disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(child, FileDispositionInfo, &disposition, sizeof(disposition))) {
    napi_value failure = os_error(env, "delete exact child handle"); CloseHandle(child); return failure;
  }
  if (!CloseHandle(child)) return os_error(env, "close deleted child handle");
#else
  if (!get_child_stat(parent, name, &st)) { free(name); return os_error(env, "stat exact child"); }
  if (strcmp(type_name(&st), "other") == 0 || !matches(env, values[2], &st, identity_only)) {
    free(name); return error(env, "ERR_CHANGED_ENTRY", "Entry changed or has an unsupported filesystem type");
  }
  // POSIX has no conditional unlink-by-inode syscall. This single-name unlink
  // cannot follow a swapped symlink or recurse into a replacement directory.
  int result = unlinkat(parent->fd, name, st.directory ? AT_REMOVEDIR : 0);
  free(name);
  if (result) return os_error(env, "unlink anchored child");
#endif
  napi_value success; NAPI_TRY(napi_get_boolean(env, true, &success)); return success;
}
static napi_value native_close(napi_env env, napi_callback_info info) {
  napi_value values[1], result; size_t count;
  if (!args(env, info, 1, 1, values, &count)) return NULL;
  dr_wrapper *wrapper = get_wrapper(env, values[0]); if (!wrapper) return NULL;
  release(wrapper->resource); wrapper->resource = NULL;
  NAPI_TRY(napi_get_undefined(env, &result)); return result;
}
/* Resolve the OS directory from the operating system, never from PATH or an
 * inherited SystemRoot environment variable. */
static napi_value native_system_directory(napi_env env, napi_callback_info info) {
  (void)info;
#ifdef _WIN32
  wchar_t directory[32768];
  UINT length = GetSystemDirectoryW(directory, 32768);
  if (!length) return os_error(env, "query Windows system directory");
  if (length >= 32768) return error(env, "ERR_INVALID_PATH", "Windows system directory exceeds the path limit");
  napi_value result;
  NAPI_TRY(napi_create_string_utf16(env, (const char16_t *)directory, length, &result));
  return result;
#else
  return error(env, "ERR_UNSUPPORTED_PLATFORM", "Windows system directory is only available on Windows");
#endif
}
/* Reopen the already anchored directory handle to set only the hidden bit.
 * This does not resolve a path, traverse a reparse point, or alter other flags. */
static napi_value native_mark_hidden(napi_env env, napi_callback_info info) {
  napi_value values[1]; size_t count;
  if (!args(env, info, 1, 1, values, &count)) return NULL;
  dr_handle *directory = get_handle(env, values[0]); if (!directory) return NULL;
#ifdef _WIN32
  HANDLE writable = reopen_directory_attributes(directory);
  if (writable == INVALID_HANDLE_VALUE) return os_error(env, "open audit directory attributes");
  dr_stat original, reopened;
  if (!stat_handle(directory->handle, &original) || !stat_handle(writable, &reopened)) {
    napi_value failure = os_error(env, "verify audit directory identity"); CloseHandle(writable); return failure;
  }
  if (original.dev != reopened.dev || original.ino != reopened.ino || !reopened.directory || reopened.symlink) {
    CloseHandle(writable); return error(env, "ERR_IDENTITY_CHANGED", "Audit directory identity changed while opening attributes");
  }
  FILE_BASIC_INFO basic;
  if (!GetFileInformationByHandleEx(writable, FileBasicInfo, &basic, sizeof(basic))) {
    napi_value failure = os_error(env, "read audit directory attributes"); CloseHandle(writable); return failure;
  }
  if ((basic.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) || !(basic.FileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
    CloseHandle(writable); return error(env, "ERR_INVALID_PATH", "Expected an ordinary audit directory");
  }
  FILE_BASIC_INFO update = {0}; /* Zero timestamps leave each existing time unchanged. */
  update.FileAttributes = (basic.FileAttributes | FILE_ATTRIBUTE_HIDDEN) & ~FILE_ATTRIBUTE_NORMAL;
  if (!SetFileInformationByHandle(writable, FileBasicInfo, &update, sizeof(update))) {
    napi_value failure = os_error(env, "set audit directory hidden attribute"); CloseHandle(writable); return failure;
  }
  if (!GetFileInformationByHandleEx(writable, FileBasicInfo, &basic, sizeof(basic))) {
    napi_value failure = os_error(env, "verify audit directory hidden attribute"); CloseHandle(writable); return failure;
  }
  if (!(basic.FileAttributes & FILE_ATTRIBUTE_HIDDEN)) {
    CloseHandle(writable); return error(env, "ERR_NATIVE_IO", "Audit directory hidden attribute was not set");
  }
  CloseHandle(writable);
  napi_value result; NAPI_TRY(napi_get_boolean(env, true, &result)); return result;
#else
  (void)directory;
  return error(env, "ERR_UNSUPPORTED_PLATFORM", "Hidden directory attributes are only available on Windows");
#endif
}
NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
    {"openRoot", NULL, native_open_root, NULL, NULL, NULL, napi_default, NULL},
    {"openDirectory", NULL, native_open_directory, NULL, NULL, NULL, napi_default, NULL},
    {"stat", NULL, native_stat, NULL, NULL, NULL, napi_default, NULL},
    {"statChild", NULL, native_stat_child, NULL, NULL, NULL, napi_default, NULL},
    {"readDirectory", NULL, native_read_directory, NULL, NULL, NULL, napi_default, NULL},
    {"removeChild", NULL, native_remove_child, NULL, NULL, NULL, napi_default, NULL},
    {"systemDirectory", NULL, native_system_directory, NULL, NULL, NULL, napi_default, NULL},
    {"markHidden", NULL, native_mark_hidden, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, native_close, NULL, NULL, NULL, napi_default, NULL}
  };
  NAPI_TRY(napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties));
  return exports;
}
