/*
 * Optional reference-run observer. Build with:
 *   cc -shared -fPIC -O2 -o claude-syscall-hook.so tests/syscall-hook.c -ldl
 * The hook only records calls; it never changes their return values.
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

static int log_fd = -1;
static int (*real_open)(const char *, int, ...);
static int (*real_openat)(int, const char *, int, ...);
static int (*real_connect)(int, const struct sockaddr *, socklen_t);
static int (*real_execve)(const char *, char *const[], char *const[]);
static int (*real_rename)(const char *, const char *);
static int (*real_unlink)(const char *);
static int (*real_mkdir)(const char *, mode_t);

__attribute__((constructor)) static void init_hook(void) {
  const char *path = getenv("CLAUDE_SYSCALL_LOG");
  if (!path || !*path) path = "/tmp/claude-syscalls.log";
  log_fd = (int)syscall(SYS_openat, AT_FDCWD, path, O_WRONLY | O_CREAT | O_APPEND, 0644);
  real_open = dlsym(RTLD_NEXT, "open");
  real_openat = dlsym(RTLD_NEXT, "openat");
  real_connect = dlsym(RTLD_NEXT, "connect");
  real_execve = dlsym(RTLD_NEXT, "execve");
  real_rename = dlsym(RTLD_NEXT, "rename");
  real_unlink = dlsym(RTLD_NEXT, "unlink");
  real_mkdir = dlsym(RTLD_NEXT, "mkdir");
}

static void log_line(const char *format, ...) {
  if (log_fd < 0) return;
  char buffer[4096];
  va_list args;
  va_start(args, format);
  int length = vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);
  if (length > 0) syscall(SYS_write, log_fd, buffer, (size_t)(length < (int)sizeof(buffer) ? length : (int)sizeof(buffer)));
}

int open(const char *path, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) { va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args); }
  int result = (flags & O_CREAT) ? real_open(path, flags, mode) : real_open(path, flags);
  log_line("pid=%ld open path=%s flags=0x%x rc=%d\n", (long)getpid(), path ? path : "(null)", flags, result);
  return result;
}

int openat(int directory, const char *path, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) { va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args); }
  int result = (flags & O_CREAT) ? real_openat(directory, path, flags, mode) : real_openat(directory, path, flags);
  log_line("pid=%ld openat dirfd=%d path=%s flags=0x%x rc=%d\n", (long)getpid(), directory, path ? path : "(null)", flags, result);
  return result;
}

int connect(int fd, const struct sockaddr *address, socklen_t length) {
  char host[128] = "";
  unsigned port = 0;
  if (address && address->sa_family == AF_INET && length >= sizeof(struct sockaddr_in)) {
    const struct sockaddr_in *ipv4 = (const struct sockaddr_in *)address;
    inet_ntop(AF_INET, &ipv4->sin_addr, host, sizeof(host));
    port = ntohs(ipv4->sin_port);
  }
  int result = real_connect(fd, address, length);
  log_line("pid=%ld connect fd=%d family=%d host=%s port=%u rc=%d\n", (long)getpid(), fd, address ? address->sa_family : 0, host, port, result);
  return result;
}

int execve(const char *path, char *const arguments[], char *const environment[]) {
  log_line("pid=%ld execve path=%s arg0=%s\n", (long)getpid(), path ? path : "(null)", arguments && arguments[0] ? arguments[0] : "(null)");
  return real_execve(path, arguments, environment);
}

int rename(const char *old_path, const char *new_path) {
  int result = real_rename(old_path, new_path);
  log_line("pid=%ld rename old=%s new=%s rc=%d\n", (long)getpid(), old_path, new_path, result);
  return result;
}

int unlink(const char *path) {
  int result = real_unlink(path);
  log_line("pid=%ld unlink path=%s rc=%d\n", (long)getpid(), path, result);
  return result;
}

int mkdir(const char *path, mode_t mode) {
  int result = real_mkdir(path, mode);
  log_line("pid=%ld mkdir path=%s mode=0%o rc=%d\n", (long)getpid(), path, mode, result);
  return result;
}
