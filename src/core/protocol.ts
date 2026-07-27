/**
 * Length-framed binary protocol between the engine and worker children.
 *
 * Request / response frame:
 *   u8  op|status
 *   u32le length (payload bytes, little-endian)
 *   bytes payload
 *
 * Request ops:  COMPRESS=1, DECOMPRESS=2, PING=3, SHUTDOWN=4
 * Response:     OK=0 (payload = result bytes), ERR=1 (payload = utf8 message)
 */

export const OP_COMPRESS = 1;
export const OP_DECOMPRESS = 2;
export const OP_PING = 3;
export const OP_SHUTDOWN = 4;

export const STATUS_OK = 0;
export const STATUS_ERR = 1;

export const HEADER_SIZE = 5; // 1 + 4

export const encodeFrame = (opOrStatus: number, payload: Buffer = Buffer.alloc(0)): Buffer => {
  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header.writeUInt8(opOrStatus, 0);
  header.writeUInt32LE(payload.length, 1);
  return Buffer.concat([header, payload]);
};

/**
 * Incremental frame parser for a socket/pipe stream.
 */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);
  private needed: number | null = null; // total frame size once header known
  private op = 0;

  push(chunk: Buffer): Array<{ op: number; payload: Buffer }> {
    this.buf = this.buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buf, chunk]);
    const frames: Array<{ op: number; payload: Buffer }> = [];

    while (true) {
      if (this.needed === null) {
        if (this.buf.length < HEADER_SIZE) break;
        this.op = this.buf.readUInt8(0);
        const len = this.buf.readUInt32LE(1);
        this.needed = HEADER_SIZE + len;
      }

      if (this.buf.length < this.needed) break;

      const payload = this.buf.subarray(HEADER_SIZE, this.needed);
      frames.push({ op: this.op, payload: Buffer.from(payload) });
      this.buf = Buffer.from(this.buf.subarray(this.needed));
      this.needed = null;
    }

    return frames;
  }
}
