---
slug: /developers/architecture/php-extensions
---

# PHP Extensions

WordPress Playground compiles PHP to WebAssembly with a specific set of extensions enabled. The available extensions differ slightly between the web (browser) and CLI (Node.js) environments.

## Supported PHP Versions

WordPress Playground supports the following PHP versions:

| Version | Status |
|---------|--------|
| PHP 8.4 | Latest |
| PHP 8.3 | Supported |
| PHP 8.2 | Supported |
| PHP 8.1 | Supported |
| PHP 8.0 | Supported |
| PHP 7.4 | Legacy |
| PHP 7.3 | Legacy |
| PHP 7.2 | Legacy |

## Extensions Enabled by Default

The following extensions are compiled into the PHP WebAssembly binary and are available in both web and CLI environments:

### Core Extensions

| Extension | Description |
|-----------|-------------|
| `bcmath` | Arbitrary precision mathematics |
| `calendar` | Calendar conversion functions |
| `ctype` | Character type checking |
| `filter` | Data filtering |
| `hash` | HASH Message Digest Framework |
| `json` | JavaScript Object Notation |
| `phar` | PHP Archive |
| `session` | Session handling |
| `tokenizer` | Tokenizer functions |

### String & Text Processing

| Extension | Description |
|-----------|-------------|
| `iconv` | Character set conversion |
| `mbstring` | Multibyte string handling |
| `mbregex` | Multibyte regular expressions (via Oniguruma) |

### Database

| Extension | Description |
|-----------|-------------|
| `pdo` | PHP Data Objects interface |
| `pdo_sqlite` | SQLite driver for PDO |
| `sqlite3` | SQLite 3 database |

### File Handling

| Extension | Description |
|-----------|-------------|
| `fileinfo` | File information (MIME types) |
| `exif` | Exchangeable image information |
| `zip` | ZIP archive read/write (via libzip) |
| `zlib` | Compression functions |

### XML Processing

| Extension | Description |
|-----------|-------------|
| `dom` | Document Object Model |
| `libxml` | LibXML (underlying XML library) |
| `simplexml` | SimpleXML |
| `xml` | XML Parser |
| `xmlreader` | XMLReader |
| `xmlwriter` | XMLWriter |

### Networking & Security

| Extension | Description |
|-----------|-------------|
| `curl` | Client URL library |
| `openssl` | OpenSSL encryption |

### Graphics

| Extension | Description |
|-----------|-------------|
| `gd` | Image processing (with libpng, libjpeg, libwebp support) |

### Performance

| Extension | Description |
|-----------|-------------|
| `opcache` | Opcode caching for performance |

### Internationalization

| Extension | Description | Availability |
|-----------|-------------|--------------|
| `intl` | Internationalization (ICU) | Web only (built-in), CLI (loadable) |

## CLI-Only Extensions

These extensions are only available in the Node.js/CLI environment:

| Extension | Description |
|-----------|-------------|
| `mysql` | MySQL (legacy) |
| `mysqli` | MySQL Improved |
| `pdo_mysql` | MySQL driver for PDO |

The CLI environment also has access to Node.js filesystem integration for mounting local directories.

## Dynamically Loadable Extensions

Some extensions can be loaded at runtime rather than being compiled into the PHP binary:

| Extension | Description | Use Case |
|-----------|-------------|----------|
| `xdebug` | Debugging and profiling | Development and debugging |
| `intl` | Internationalization | CLI environment |

## Unsupported Extensions

The following PHP features and extensions are **not supported** in WordPress Playground:

### Not Available

| Extension/Feature | Reason |
|-------------------|--------|
| `pcre-jit` | JIT compilation is not available in WebAssembly |
| `opcache-jit` | JIT compilation is not available in WebAssembly |
| `fiber-asm` | Assembly implementation not available; C implementation is used instead |
| `posix` | POSIX functions are not available in WebAssembly environment |
| `phpdbg` | Interactive debugger not supported in WebAssembly |
| `sockets` | Low-level socket operations not available (use `curl` instead) |
| `pcntl` | Process control not available in WebAssembly |
| `shmop` | Shared memory operations not supported |
| `sysvmsg` | System V message queues not available |
| `sysvsem` | System V semaphores not available |
| `sysvshm` | System V shared memory not available |

### Limited Functionality

Some features have limited functionality in the browser environment:

- **Networking**: Direct socket connections are not possible. HTTP requests are translated to `fetch()` calls. See [Networking support](/developers/architecture/wasm-php-overview#networking-support-varies-between-platforms) for details.
- **File System**: The file system is virtual and in-memory. Changes are not persisted by default.
- **Process Execution**: Functions like `exec()`, `shell_exec()`, `system()`, and `passthru()` have limited support.

## Building PHP with Custom Extensions

PHP is built using a Docker-based pipeline. Extensions can be toggled using build arguments:

```bash
# Build PHP with specific extensions enabled/disabled
nx recompile-php php-wasm-web --PHP_VERSION=8.2 \
  --WITH_GD=yes \
  --WITH_INTL=yes \
  --WITH_CURL=yes
```

### Available Build Arguments

| Argument | Default (Web) | Default (CLI) | Description |
|----------|---------------|---------------|-------------|
| `WITH_CURL` | yes | yes | Enable cURL support |
| `WITH_EXIF` | yes | yes | Enable EXIF support |
| `WITH_FILEINFO` | yes | yes | Enable fileinfo support |
| `WITH_GD` | yes | yes | Enable GD graphics support |
| `WITH_ICONV` | yes | yes | Enable iconv support |
| `WITH_INTL` | yes | no | Enable internationalization |
| `WITH_LIBXML` | yes | yes | Enable libxml/DOM/SimpleXML |
| `WITH_LIBZIP` | yes | yes | Enable ZIP archive support |
| `WITH_MBREGEX` | yes | yes | Enable multibyte regex |
| `WITH_MBSTRING` | yes | yes | Enable multibyte string |
| `WITH_MYSQL` | no | yes | Enable MySQL support |
| `WITH_OPCACHE` | yes | yes | Enable OPcache |
| `WITH_OPENSSL` | yes | yes | Enable OpenSSL |
| `WITH_SQLITE` | yes | yes | Enable SQLite support |

For more details on building PHP, see [Compiling PHP](/developers/architecture/wasm-php-compiling).

## Checking Available Extensions

You can check which extensions are loaded in a running Playground instance using PHP:

```php
<?php
// List all loaded extensions
print_r(get_loaded_extensions());

// Check if a specific extension is loaded
if (extension_loaded('gd')) {
    echo "GD is available!";
}

// Get extension information
phpinfo(INFO_MODULES);
```

## WordPress Plugin Compatibility

Most WordPress plugins that rely on standard PHP extensions will work in Playground. However, plugins that require:

- Direct database connections (MySQL without the WordPress abstraction layer)
- Socket-based networking
- Process spawning
- File system persistence

May have limited functionality or require adaptation.
