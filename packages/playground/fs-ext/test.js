#!/usr/bin/env node
// Simple test to verify the module loads correctly

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Testing @wp-playground/fs-ext...');
console.log('Platform:', os.platform());
console.log('Architecture:', os.arch());
console.log('Node version:', process.version);
console.log('');

try {
  const fsExt = require('./fs-ext.js');
  console.log('Module loaded successfully!');
  console.log('');

  // Test constants are available
  console.log('Constants available:');
  console.log('  SEEK_SET:', fsExt.constants.SEEK_SET);
  console.log('  SEEK_CUR:', fsExt.constants.SEEK_CUR);
  console.log('  SEEK_END:', fsExt.constants.SEEK_END);
  console.log('  LOCK_SH:', fsExt.constants.LOCK_SH);
  console.log('  LOCK_EX:', fsExt.constants.LOCK_EX);
  console.log('  LOCK_UN:', fsExt.constants.LOCK_UN);
  console.log('');

  // Test functions are available
  console.log('Functions available:');
  console.log('  flock:', typeof fsExt.flock === 'function' ? 'yes' : 'no');
  console.log('  flockSync:', typeof fsExt.flockSync === 'function' ? 'yes' : 'no');
  console.log('  seek:', typeof fsExt.seek === 'function' ? 'yes' : 'no');
  console.log('  seekSync:', typeof fsExt.seekSync === 'function' ? 'yes' : 'no');
  console.log('');

  // Test actual file locking
  const testFile = path.join(os.tmpdir(), 'fs-ext-test-' + process.pid + '.tmp');
  fs.writeFileSync(testFile, 'test');

  const fd = fs.openSync(testFile, 'r+');
  console.log('Testing file locking on:', testFile);

  // Test exclusive lock
  fsExt.flockSync(fd, 'ex');
  console.log('  Acquired exclusive lock');

  // Test unlock
  fsExt.flockSync(fd, 'un');
  console.log('  Released lock');

  // Test shared lock
  fsExt.flockSync(fd, 'sh');
  console.log('  Acquired shared lock');

  fsExt.flockSync(fd, 'un');
  console.log('  Released lock');

  fs.closeSync(fd);
  fs.unlinkSync(testFile);

  console.log('');
  console.log('All tests passed!');
  process.exit(0);
} catch (err) {
  console.error('Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
