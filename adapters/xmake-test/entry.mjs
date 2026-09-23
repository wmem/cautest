#!/usr/bin/env node
import { existsSync } from 'node:fs';
const source = new URL('../../dist/adapters/xmake/entry.js', import.meta.url);
const portable = new URL('../../lib/adapters/xmake/entry.js', import.meta.url);
try { await import((existsSync(source) ? source : portable).href); }
catch (error) { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 3; }
