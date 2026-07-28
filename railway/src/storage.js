import fs from 'node:fs';
import path from 'node:path';
import { nowIso, uid } from './utils.js';

export class JsonlStore {
  constructor(dataDir, namespace = '') {
    this.dataDir = dataDir;
    this.namespace = String(namespace || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    this.prefix = this.namespace ? `${this.namespace}-` : '';
    fs.mkdirSync(dataDir, { recursive: true });
    this.definitions = {
      scans: { file: `${this.prefix}scans.jsonl`, limit: 100_000 },
      signals: { file: `${this.prefix}signals.jsonl`, limit: 20_000 },
      baskets: { file: `${this.prefix}baskets.jsonl`, limit: 20_000 },
      legs: { file: `${this.prefix}legs.jsonl`, limit: 100_000 },
      orders: { file: `${this.prefix}orders.jsonl`, limit: 100_000 },
      banks: { file: `${this.prefix}banks.jsonl`, limit: 50_000 },
      events: { file: `${this.prefix}events.jsonl`, limit: 20_000 },
      contexts: { file: `${this.prefix}contexts.jsonl`, limit: 20_000 },
      mt5: { file: `${this.prefix}mt5-heartbeats.jsonl`, limit: 20_000 }
    };
    this.collections = {};
    for (const [name, definition] of Object.entries(this.definitions)) this.collections[name] = this.load(definition);
  }
  filePath(filename) { return path.join(this.dataDir, filename); }
  load(definition) {
    const file = this.filePath(definition.file);
    if (!fs.existsSync(file)) return [];
    try {
      return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-definition.limit).map(line => JSON.parse(line)).reverse();
    } catch (error) {
      console.error(`Could not load ${definition.file}:`, error.message);
      return [];
    }
  }
  append(name, input, prefix = name) {
    const definition = this.definitions[name];
    if (!definition) throw new Error(`Unknown collection ${name}`);
    const record = { id: input.id || uid(prefix), receivedAt: input.receivedAt || nowIso(), ...input };
    this.collections[name].unshift(record);
    if (this.collections[name].length > definition.limit) this.collections[name].length = definition.limit;
    fs.appendFileSync(this.filePath(definition.file), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }
  upsert(name, input, key = 'id') {
    const existingIndex = this.collections[name].findIndex(row => String(row[key]) === String(input[key]));
    if (existingIndex >= 0) this.collections[name].splice(existingIndex, 1);
    return this.append(name, input, name);
  }
  all(name) { return this.collections[name] || []; }
  list(name, limit = 100) { return this.all(name).slice(0, limit); }
  event(type, message, data = null) { return this.append('events', { at: nowIso(), type, message, data }, 'event'); }
}
