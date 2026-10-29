const clone = value => structuredClone(value);
const get = (doc, path) => path.split('.').reduce((value, key) => value?.[key], doc);
function set(doc, path, value) { const parts = path.split('.'); let obj = doc; for (const key of parts.slice(0, -1)) obj = obj[key] ??= {}; obj[parts.at(-1)] = clone(value); }
function matches(doc, query) {
  return Object.entries(query).every(([path, value]) => {
    if (path === '$or') return value.some(part => matches(doc, part));
    const actual = get(doc, path);
    if (value === null) return actual == null;
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, bound]) => {
      if (op === '$lte') return actual <= bound;
      if (op === '$gte') return actual >= bound;
      if (op === '$lt') return actual < bound;
      if (op === '$nin') return !bound.includes(actual);
      throw new Error(`Unsupported test query ${op}`);
    });
    return String(actual) === String(value);
  });
}
function database() {
  const collections = new Map();
  return { collection(name) {
    if (collections.has(name)) return collections.get(name);
    const coll = { rows: [], writes: 0, reads: 0, fail: false, indexes: [],
      async createIndex(keys, options = {}) { this.indexes.push({ keys, options }); },
      async findOne(query) { this.reads++; return clone(this.rows.find(row => matches(row, query)) || null); },
      async findOneAndUpdate(query, update) {
        this.writes++;
        let row = this.rows.find(row => matches(row, query));
        if (!row && this.rows.some(row => row._id === query._id)) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
        if (!row) { row = { _id: query._id }; this.rows.push(row); }
        for (const [key, value] of Object.entries(update.$set)) set(row, key, value);
        return clone(row);
      },
      async updateOne(query, update) {
        this.writes++;
        if (this.fail) throw new Error('Mongo checkpoint unavailable');
        let row = this.rows.find(row => matches(row, query));
        if (!row) { row = { ...query }; this.rows.push(row); }
        for (const [key, value] of Object.entries(update.$set)) set(row, key, value);
      },
      async bulkWrite(operations) {
        this.writes++;
        if (this.fail) throw new Error('Mongo unavailable');
        for (const { replaceOne } of operations) {
          const index = this.rows.findIndex(row => matches(row, replaceOne.filter));
          if (index < 0) this.rows.push(clone(replaceOne.replacement)); else this.rows[index] = clone(replaceOne.replacement);
        }
      },
      async deleteMany(query) { this.writes++; this.rows = this.rows.filter(row => !matches(row, query)); },
      async deleteOne(query) { this.rows = this.rows.filter(row => !matches(row, query)); },
    };
    collections.set(name, coll); return coll;
  } };
}
module.exports = { database };
