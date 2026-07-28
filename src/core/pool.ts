/**
 * Persistent worker pool for OpenZL CLI jobs.
 *
 * - N long-lived Node worker processes (each spawns native zli per job)
 * - Length-framed binary protocol over pipes
 * - Free-list dispatch
 * - Health check (ping) + respawn on worker death
 * - Graceful shutdown
 *
 * Set OPENZL_POOL_SIZE=0 to disable (engine falls back to one-shot pipes).
 */

import { ChildProcess, spawn } from 'child_process';
import { cpus } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { CompressionError, LimitError } from './errors.js';
import {
  FrameParser,
  OP_COMPRESS,
  OP_DECOMPRESS,
  OP_PING,
  OP_SHUTDOWN,
  STATUS_OK,
  encodeFrame
} from './protocol.js';

export type PoolOptions = {
  size?: number;
  zliPath: string;
  timeoutMs?: number;
};

type Pending = {
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

type WorkerSlot = {
  id: number;
  child: ChildProcess;
  parser: FrameParser;
  busy: boolean;
  pending: Pending | null;
  alive: boolean;
  generation: number;
};

type QueuedJob = {
  op: number;
  payload: Buffer;
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
};

const workerScript = (): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'worker.js');
};

const defaultSize = (): number => {
  const fromEnv = Number(process.env.OPENZL_POOL_SIZE);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return Math.floor(fromEnv);
  // Default 2: enough concurrency without forking a Node per core
  return Math.max(1, Math.min(2, cpus().length));
};

export class ZliPool {
  private readonly zliPath: string;
  private readonly size: number;
  private readonly timeoutMs: number;
  private readonly workers: WorkerSlot[] = [];
  private readonly waitQueue: QueuedJob[] = [];
  private shuttingDown = false;
  private nextId = 0;
  private respawnCounts = new Map<number, number>();

  constructor(options: PoolOptions) {
    this.zliPath = options.zliPath;
    this.size = Math.max(0, options.size ?? defaultSize());
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get workerCount(): number {
    return this.workers.filter((w) => w.alive).length;
  }

  async start(): Promise<void> {
    if (this.size === 0) return;
    // Boot sequentially — avoids Node cold-start stampedes on first request
    for (let i = 0; i < this.size; i++) {
      await this.spawnWorker();
    }
  }

  private spawnWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.shuttingDown) {
        resolve();
        return;
      }

      const id = this.nextId++;
      const child = spawn(process.execPath, [workerScript()], {
        env: {
          ...process.env,
          OPENZL_ZLI_PATH: this.zliPath
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      // Drain stderr so the pipe never blocks the worker
      child.stderr?.on('data', () => {});

      const slot: WorkerSlot = {
        id,
        child,
        parser: new FrameParser(),
        busy: false,
        pending: null,
        alive: true,
        generation: 0
      };

      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        this.workers.push(slot);
        resolve();
      };
      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        slot.alive = false;
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(err);
      };

      const readyTimer = setTimeout(() => {
        finishErr(new CompressionError(`worker ${id} failed to become ready`));
      }, 15_000);

      child.stdout?.on('data', (chunk: Buffer) => {
        const frames = slot.parser.push(chunk);
        for (const frame of frames) {
          // Boot handshake: first OK pong completes ready
          if (!settled && frame.op === STATUS_OK && frame.payload.toString() === 'pong') {
            clearTimeout(readyTimer);
            // Clear pending if we used dispatch path
            if (slot.pending) {
              clearTimeout(slot.pending.timer);
              slot.pending = null;
              slot.busy = false;
            }
            finishOk();
            continue;
          }
          this.onFrame(slot, frame.op, frame.payload);
        }
      });

      child.on('exit', () => {
        slot.alive = false;
        clearTimeout(readyTimer);
        if (slot.pending) {
          clearTimeout(slot.pending.timer);
          slot.pending.reject(new CompressionError(`worker ${id} exited mid-job`));
          slot.pending = null;
        }
        slot.busy = false;

        const idx = this.workers.indexOf(slot);
        if (idx >= 0) this.workers.splice(idx, 1);

        if (!settled) {
          finishErr(new CompressionError(`worker ${id} exited before ready`));
          return;
        }

        if (!this.shuttingDown) {
          const fails = (this.respawnCounts.get(id) ?? 0) + 1;
          this.respawnCounts.set(id, fails);
          // Back off and cap respawns to avoid storms
          if (fails <= 5) {
            const delay = Math.min(2000, 100 * fails);
            setTimeout(() => {
              this.spawnWorker()
                .then(() => this.pump())
                .catch(() => {});
            }, delay);
          }
        }
      });

      child.on('error', (err) => {
        finishErr(new CompressionError(`worker ${id} spawn error: ${err.message}`, err));
      });

      // Parent-driven handshake (buffered until worker listens)
      try {
        child.stdin?.write(encodeFrame(OP_PING));
      } catch (err) {
        finishErr(
          new CompressionError(
            `worker ${id} ping failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    });
  }

  private onFrame(slot: WorkerSlot, status: number, payload: Buffer): void {
    const pending = slot.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    slot.pending = null;
    slot.busy = false;

    if (status === STATUS_OK) {
      pending.resolve(payload);
    } else {
      pending.reject(
        new CompressionError(payload.toString('utf8') || 'worker returned error')
      );
    }

    this.pump();
  }

  private pump(): void {
    while (this.waitQueue.length > 0) {
      const free = this.workers.find((w) => w.alive && !w.busy);
      if (!free) break;
      const job = this.waitQueue.shift()!;
      this.dispatch(free, job.op, job.payload, job.resolve, job.reject);
    }
  }

  private dispatch(
    slot: WorkerSlot,
    op: number,
    payload: Buffer,
    resolve: (buf: Buffer) => void,
    reject: (err: Error) => void
  ): void {
    if (!slot.child.stdin || !slot.alive) {
      reject(new CompressionError('worker stdin unavailable'));
      return;
    }

    slot.busy = true;
    const timer = setTimeout(() => {
      if (slot.pending) {
        slot.pending = null;
        slot.busy = false;
        try {
          slot.child.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new LimitError('TIMEOUT', `zli job timed out after ${this.timeoutMs}ms`));
      }
    }, this.timeoutMs);

    slot.pending = { resolve, reject, timer };
    slot.child.stdin.write(encodeFrame(op, payload));
  }

  private enqueue(op: number, payload: Buffer): Promise<Buffer> {
    if (this.shuttingDown) {
      return Promise.reject(new CompressionError('OpenZL pool is shutting down'));
    }
    if (this.workerCount === 0) {
      return Promise.reject(new CompressionError('OpenZL pool has no live workers'));
    }

    return new Promise<Buffer>((resolve, reject) => {
      const free = this.workers.find((w) => w.alive && !w.busy);
      if (free) {
        this.dispatch(free, op, payload, resolve, reject);
      } else {
        this.waitQueue.push({ op, payload, resolve, reject });
      }
    });
  }

  compress(input: Buffer): Promise<Buffer> {
    return this.enqueue(OP_COMPRESS, input);
  }

  decompress(input: Buffer): Promise<Buffer> {
    return this.enqueue(OP_DECOMPRESS, input);
  }

  async healthCheck(): Promise<boolean> {
    if (this.workerCount === 0) return false;
    try {
      const pong = await this.enqueue(OP_PING, Buffer.alloc(0));
      return pong.toString() === 'pong';
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    while (this.waitQueue.length) {
      const job = this.waitQueue.shift()!;
      job.reject(new CompressionError('OpenZL pool is shutting down'));
    }

    const kills = this.workers.map(
      (slot) =>
        new Promise<void>((resolve) => {
          if (!slot.alive) {
            resolve();
            return;
          }
          const t = setTimeout(() => {
            try {
              slot.child.kill('SIGKILL');
            } catch {
              // ignore
            }
            resolve();
          }, 1500);
          slot.child.once('exit', () => {
            clearTimeout(t);
            resolve();
          });
          try {
            slot.child.stdin?.write(encodeFrame(OP_SHUTDOWN));
            slot.child.stdin?.end();
          } catch {
            try {
              slot.child.kill('SIGTERM');
            } catch {
              // ignore
            }
          }
        })
    );

    await Promise.all(kills);
    this.workers.length = 0;
  }
}

// ── process-wide singleton ──────────────────────────────────────────

let sharedPool: ZliPool | null = null;
let sharedPoolBoot: Promise<ZliPool | null> | null = null;

export type EnsurePoolOptions = {
  zliPath: string;
  size?: number;
  /** Per-job timeout (ms) for the shared pool. Only applied on first boot. */
  timeoutMs?: number;
};

export const ensurePool = async (opts: EnsurePoolOptions): Promise<ZliPool | null> => {
  if (sharedPool) return sharedPool;
  if (sharedPoolBoot) return sharedPoolBoot;

  sharedPoolBoot = (async () => {
    const size = opts.size ?? defaultSize();
    if (size === 0) return null;
    const pool = new ZliPool({
      zliPath: opts.zliPath,
      size,
      timeoutMs: opts.timeoutMs
    });
    await pool.start();
    if (pool.workerCount === 0) return null;
    sharedPool = pool;
    return pool;
  })();

  try {
    return await sharedPoolBoot;
  } catch (err) {
    sharedPoolBoot = null;
    sharedPool = null;
    throw err;
  }
};

export const shutdownPool = async (): Promise<void> => {
  const p = sharedPool;
  sharedPool = null;
  sharedPoolBoot = null;
  if (p) await p.shutdown();
};

export const resetPool = async (): Promise<void> => {
  await shutdownPool();
};
