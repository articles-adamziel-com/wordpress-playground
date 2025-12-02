---
slug: /developers/architecture/php-extensions
---

# PHP Extensions

WordPress Playground compiles PHP to WebAssembly with a specific set of extensions enabled. The available extensions differ slightly between the web (browser) and CLI (Node.js) environments.

## Supported PHP Versions

WordPress Playground supports PHP versions 7.2 through 8.4.

## PHP Extensions Support

| PHP Extension | Playground Web | Playground CLI |
|---------------|----------------|----------------|
| `bcmath` | ✅ | ✅ |
| `calendar` | ✅ | ✅ |
| `ctype` | ✅ | ✅ |
| `curl` | ✅ | ✅ |
| `dom` | ✅ | ✅ |
| `exif` | ✅ | ✅ |
| `fileinfo` | ✅ | ✅ |
| `filter` | ✅ | ✅ |
| `gd` | ✅ | ✅ |
| `hash` | ✅ | ✅ |
| `iconv` | ✅ | ✅ |
| `intl` | ✅ | ✅ (loadable) |
| `json` | ✅ | ✅ |
| `libxml` | ✅ | ✅ |
| `mbregex` | ✅ | ✅ |
| `mbstring` | ✅ | ✅ |
| `mysql` | ❌ | ✅ |
| `mysqli` | ❌ | ✅ |
| `opcache` | ✅ | ✅ |
| `openssl` | ✅ | ✅ |
| `pcntl` | ❌ | ❌ |
| `pcre-jit` | ❌ | ❌ |
| `pdo` | ✅ | ✅ |
| `pdo_mysql` | ❌ | ✅ |
| `pdo_sqlite` | ✅ | ✅ |
| `phar` | ✅ | ✅ |
| `posix` | ❌ | ❌ |
| `session` | ✅ | ✅ |
| `shmop` | ❌ | ❌ |
| `simplexml` | ✅ | ✅ |
| `sockets` | ❌ | ❌ |
| `sqlite3` | ✅ | ✅ |
| `sysvmsg` | ❌ | ❌ |
| `sysvsem` | ❌ | ❌ |
| `sysvshm` | ❌ | ❌ |
| `tokenizer` | ✅ | ✅ |
| `xdebug` | ✅ (loadable) | ✅ (loadable) |
| `xml` | ✅ | ✅ |
| `xmlreader` | ✅ | ✅ |
| `xmlwriter` | ✅ | ✅ |
| `zip` | ✅ | ✅ |
| `zlib` | ✅ | ✅ |

## Notes

- **Loadable extensions**: Extensions marked as "loadable" can be loaded at runtime rather than being compiled into the PHP binary.
- **MySQL extensions**: MySQL support is only available in the CLI environment, which can connect to external MySQL servers.
- **JIT compilation**: Neither `pcre-jit` nor `opcache-jit` are available because JIT compilation is not supported in WebAssembly.
- **Process control**: Extensions like `pcntl`, `shmop`, and System V IPC (`sysvmsg`, `sysvsem`, `sysvshm`) are not available in the WebAssembly environment.
- **Sockets**: Low-level socket operations are not available. Use `curl` for HTTP requests instead.

## Limited Functionality

Some features have limited functionality in the browser environment:

- **Networking**: Direct socket connections are not possible. HTTP requests are translated to `fetch()` calls. See [Networking support](/developers/architecture/wasm-php-overview#networking-support-varies-between-platforms) for details.
- **File System**: The file system is virtual and in-memory. Changes are not persisted by default.
- **Process Execution**: Functions like `exec()`, `shell_exec()`, `system()`, and `passthru()` have limited support.

## Building PHP with Custom Extensions

PHP is built using a Docker-based pipeline. Extensions can be toggled using build arguments:

```bash
nx recompile-php php-wasm-web --PHP_VERSION=8.2 \
  --WITH_GD=yes \
  --WITH_INTL=yes \
  --WITH_CURL=yes
```

For more details on building PHP, see [Compiling PHP](/developers/architecture/wasm-php-compiling).

## Checking Available Extensions

You can check which extensions are loaded in a running Playground instance:

```php
<?php
// List all loaded extensions
print_r(get_loaded_extensions());

// Check if a specific extension is loaded
if (extension_loaded('gd')) {
    echo "GD is available!";
}
```
