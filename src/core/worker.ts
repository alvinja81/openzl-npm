/**
 * Long-lived OpenZL worker child.
 *
 * Speaks the length-framed protocol on stdin/stdout. Each job invokes the
 * native zli binary via pipes (zli itself is one-shot); this process stays warm.
 *
 * Started by pool.ts via `spawn(process.execPath, [thisFile])`.
 */

import { runZliPipe, type PipeOp } from './pipe-runner.js';
import {
  FrameParser,
  OP_COMPRESS,
  OP_DECOMPRESS,
  OP_PING,
  OP_SHUTDOWN,
  STATUS_ERR,
  STATUS_OK,
  encodeFrame
} from './protocol.js';

const zliPath = process.env.OPENZL_ZLI_PATH;
if (!zliPath) {
  process.stderr.write('openzl-worker: OPENZL_ZLI_PATH is required\n');
  process.exit(1);
}

const parser = new FrameParser();

const writeFrame = (status: number, payload: Buffer = Buffer.alloc(0)): void => {
  process.stdout.write(encodeFrame(status, payload));
};

const handle = async (op: number, payload: Buffer): Promise<void> => {
  try {
    if (op === OP_PING) {
      writeFrame(STATUS_OK, Buffer.from('pong'));
      return;
    }
    if (op === OP_SHUTDOWN) {
      writeFrame(STATUS_OK);
      // Flush then exit
      process.stdout.write(Buffer.alloc(0), () => process.exit(0));
      setTimeout(() => process.exit(0), 50);
      return;
    }
    if (op !== OP_COMPRESS && op !== OP_DECOMPRESS) {
      writeFrame(STATUS_ERR, Buffer.from(`unknown op ${op}`));
      return;
    }

    const pipeOp: PipeOp = op === OP_COMPRESS ? 'compress' : 'decompress';
    const out = await runZliPipe(zliPath, pipeOp, payload);
    writeFrame(STATUS_OK, out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeFrame(STATUS_ERR, Buffer.from(msg));
  }
};

// Strictly serial job handling so responses stay ordered on stdout.
let chain: Promise<void> = Promise.resolve();

process.stdin.on('data', (chunk: Buffer) => {
  const frames = parser.push(chunk);
  for (const frame of frames) {
    chain = chain.then(() => handle(frame.op, frame.payload)).catch((err) => {
      writeFrame(STATUS_ERR, Buffer.from(err instanceof Error ? err.message : String(err)));
    });
  }
});

process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(1));

// Keep process alive; parent drives readiness via OP_PING.
process.stdin.resume();
