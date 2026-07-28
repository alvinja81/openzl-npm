/**
 * Express adapter entry (`import … from 'openzl-express/express'`).
 * Does not re-export the full core API — use `openzl-express/core` for that.
 */

export { openzlMiddleware } from './adapters/express.js';

export type {
  OpenZLMiddlewareOptions,
  ExpressMiddleware
} from './types.js';
