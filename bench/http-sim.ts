/**
 * End-to-end HTTP transfer model (no real sockets).
 *
 * TTFB ≈ encode_p50 + RTT/2
 * total ≈ encode_p50 + RTT + transfer(compressed_bytes, bandwidth)
 *
 * Profiles: 3G / 50Mbps / LAN — good enough to show crossover vs ratio.
 */

import type { RowResult } from './harness.ts';

export type NetworkProfile = {
  id: string;
  name: string;
  /** Downstream bandwidth bits/sec */
  bandwidthBps: number;
  /** Round-trip time ms */
  rttMs: number;
};

export const NETWORKS: NetworkProfile[] = [
  { id: '3g', name: '3G (~1.6 Mbps, 150ms RTT)', bandwidthBps: 1.6e6, rttMs: 150 },
  { id: '50m', name: '50 Mbps (20ms RTT)', bandwidthBps: 50e6, rttMs: 20 },
  { id: 'lan', name: 'LAN 1 Gbps (1ms RTT)', bandwidthBps: 1e9, rttMs: 1 }
];

export type HttpSimRow = {
  corpusId: string;
  codecId: string;
  networkId: string;
  originalBytes: number;
  compressedBytes: number;
  encodeP50Ms: number;
  transferMs: number;
  ttfbMs: number;
  totalMs: number;
  /** totalMs for identity (uncompressed) on same network — for delta */
  identityTotalMs: number;
  savedMs: number;
};

const transferMs = (bytes: number, bandwidthBps: number): number => {
  if (bandwidthBps <= 0) return Infinity;
  return (bytes * 8 * 1000) / bandwidthBps;
};

export const simulateHttp = (rows: RowResult[]): HttpSimRow[] => {
  const out: HttpSimRow[] = [];

  for (const row of rows) {
    if (row.error || row.compressedBytes === 0) continue;
    for (const net of NETWORKS) {
      const enc = row.encode.p50;
      const xfer = transferMs(row.compressedBytes, net.bandwidthBps);
      const identityXfer = transferMs(row.originalBytes, net.bandwidthBps);
      // Identity: no encode cost on this model (server still serializes JSON, but we isolate compression)
      const identityTotal = net.rttMs + identityXfer;
      const ttfb = enc + net.rttMs / 2;
      const total = enc + net.rttMs + xfer;
      out.push({
        corpusId: row.corpusId,
        codecId: row.codecId,
        networkId: net.id,
        originalBytes: row.originalBytes,
        compressedBytes: row.compressedBytes,
        encodeP50Ms: enc,
        transferMs: xfer,
        ttfbMs: ttfb,
        totalMs: total,
        identityTotalMs: identityTotal,
        savedMs: identityTotal - total
      });
    }
  }
  return out;
};
