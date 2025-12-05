# @wp-playground/fs-ext

A prebuildified version of [fs-ext](https://github.com/baudehlo/node-fs-ext) for WordPress Playground.

This package provides native file locking (`flock`) and other filesystem extensions with prebuilt binaries, eliminating the need for node-gyp compilation on supported platforms.

## Features

- **Prebuilt binaries** for common platforms (no compilation required)
- **Automatic fallback** to node-gyp if no prebuild is available
- Full API compatibility with the original fs-ext package

## Supported Platforms

Prebuilt binaries are available for:

| Platform | Architecture | Node.js Versions |
|----------|--------------|------------------|
| Linux (glibc) | x64, arm64 | 18, 20, 22 |
| macOS | x64, arm64 | 18, 20, 22 |
| Windows | x64 | 18, 20, 22 |

For other platforms/architectures, the package will attempt to compile from source using node-gyp.

## Installation

```bash
npm install @wp-playground/fs-ext
```

## Usage

```javascript
const { flockSync, flock, constants } = require('@wp-playground/fs-ext');
const fs = require('fs');

// Open a file
const fd = fs.openSync('myfile.txt', 'r+');

// Synchronous exclusive lock
flockSync(fd, 'ex');  // or flockSync(fd, constants.LOCK_EX)

// Do work...

// Release lock
flockSync(fd, 'un');

// Async exclusive lock
flock(fd, 'ex', (err) => {
  if (err) throw err;
  // Do work...
  flock(fd, 'un', () => {});
});

fs.closeSync(fd);
```

## API

### `flock(fd, flags, callback)`

Asynchronous file locking.

- `fd` - File descriptor (from `fs.open` or `fs.openSync`)
- `flags` - Lock type: `'sh'` (shared), `'ex'` (exclusive), `'shnb'` (shared non-blocking), `'exnb'` (exclusive non-blocking), `'un'` (unlock)
- `callback` - `(err) => void`

### `flockSync(fd, flags)`

Synchronous file locking.

### `seek(fd, position, whence, callback)`

Asynchronous file seek.

- `whence` - `constants.SEEK_SET`, `constants.SEEK_CUR`, or `constants.SEEK_END`

### `seekSync(fd, position, whence)`

Synchronous file seek. Returns the new position.

### `fcntl(fd, cmd, arg, callback)` (Unix only)

File control operations.

### `fcntlSync(fd, cmd, arg)` (Unix only)

Synchronous file control.

### `statVFS(path, callback)` (Unix only)

Get filesystem statistics.

### `constants`

Object containing all constants (SEEK_SET, LOCK_EX, etc.)

## Building Prebuilds

To build prebuilds for your current platform:

```bash
cd packages/playground/fs-ext
npm install
npm run prebuild
```

The prebuilds will be placed in the `prebuilds/` directory.

## License

MIT - Original code by Matt Sergeant, prebuildified by WordPress Playground contributors.
