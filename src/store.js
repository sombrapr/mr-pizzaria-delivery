'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createInitialData } = require('./seed');

class JsonStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.data = null;
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = createInitialData();
      await this.persist();
    }
  }

  snapshot() {
    return structuredClone(this.data);
  }

  async read(selector = (data) => data) {
    return selector(this.snapshot());
  }

  async write(mutator) {
    this.queue = this.queue.then(async () => {
      const draft = this.snapshot();
      const result = await mutator(draft);
      this.data = draft;
      await this.persist();
      return result;
    });
    return this.queue;
  }

  async persist() {
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(temporary, this.filePath);
  }
}

module.exports = { JsonStore };
