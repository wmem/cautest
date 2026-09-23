import path from 'node:path';
import {umlKernelEnvironment} from '@cautest/config';

// Pure descriptor factory. Paths in options belong to projectRoot, not the manifest folder.
export function createEnvironment({projectRoot, options}) {
  return umlKernelEnvironment({
    kernel: {
      sourceDir: path.resolve(projectRoot, options.kernelSource ?? process.env.KERNEL_SRC ?? 'vendor/linux'),
      configFragments: ['uml-host.config'],
      arch: 'um', jobs: options.jobs ?? 4, timeoutMs: 20 * 60_000,
    },
    busybox: {
      sourceDir: path.resolve(projectRoot, options.busyboxSource ?? process.env.BUSYBOX_SRC ?? 'vendor/busybox'),
      static: true, jobs: options.jobs ?? 4, timeoutMs: 10 * 60_000,
    },
    moduleDefaults: {timeoutMs: 5 * 60_000},
    rootfs: {timeoutMs: 60_000},
    machine: {memory: '256M', readyTimeoutMs: 30_000, startTimeoutMs: 40_000},
  });
}
