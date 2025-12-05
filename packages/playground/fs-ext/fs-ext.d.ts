// Type definitions for @wp-playground/fs-ext
// Based on @types/fs-ext

export type FlockFlags = 'sh' | 'ex' | 'shnb' | 'exnb' | 'un';
export type FcntlFlags = 'getfd' | 'setfd' | 'setlk' | 'setlkw' | 'getlk';

export interface StatVFSResult {
  f_namemax: number;
  f_bsize: number;
  f_frsize: number;
  f_blocks: number;
  f_bavail: number;
  f_bfree: number;
  f_files: number;
  f_favail: number;
  f_ffree: number;
}

export interface Constants {
  SEEK_SET: number;
  SEEK_CUR: number;
  SEEK_END: number;
  LOCK_SH: number;
  LOCK_EX: number;
  LOCK_NB: number;
  LOCK_UN: number;
  F_GETFD?: number;
  F_SETFD?: number;
  FD_CLOEXEC?: number;
  F_RDLCK?: number;
  F_WRLCK?: number;
  F_UNLCK?: number;
  F_SETLK?: number;
  F_GETLK?: number;
  F_SETLKW?: number;
}

export const constants: Constants;

export function flock(
  fd: number,
  flags: FlockFlags | number,
  callback: (err: Error | null) => void
): void;

export function flockSync(fd: number, flags: FlockFlags | number): void;

export function fcntl(
  fd: number,
  cmd: FcntlFlags | number,
  arg: number,
  callback: (err: Error | null, result: number) => void
): void;
export function fcntl(
  fd: number,
  cmd: FcntlFlags | number,
  callback: (err: Error | null, result: number) => void
): void;

export function fcntlSync(fd: number, cmd: FcntlFlags | number, arg?: number): number;

export function seek(
  fd: number,
  position: number,
  whence: number,
  callback: (err: Error | null, position: number) => void
): void;

export function seekSync(fd: number, position: number, whence: number): number;

export function statVFS(
  path: string,
  callback: (err: Error | null, result: StatVFSResult) => void
): void;
