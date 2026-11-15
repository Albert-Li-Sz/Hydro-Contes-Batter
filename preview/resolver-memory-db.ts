import type { Context } from 'hydrooj';

/** Preview/test storage only. Production always uses Hydro's MongoDB service. */
export function previewDatabase() {
    const tables = new Map<string, Map<string, Record<string, any>>>();
    const field = (row: Record<string, any>, key: string): any => key.split('.').reduce((value, part) => value?.[part], row);
    const changeField = (row: Record<string, any>, key: string, value: unknown, remove = false) => {
        const parts = key.split('.');
        const last = parts.pop()!;
        const parent = parts.reduce((item, part) => (item[part] ||= {}), row);
        if (remove) delete parent[last];
        else parent[last] = structuredClone(value);
    };
    const updateRow = (row: Record<string, any>, update: Record<string, any>) => {
        for (const [key, value] of Object.entries(update.$set || {})) changeField(row, key, value);
        for (const [key, value] of Object.entries(update.$inc || {})) changeField(row, key, (field(row, key) ?? 0) + (value as number));
        for (const key of Object.keys(update.$unset || {})) changeField(row, key, undefined, true);
    };
    const matches = (row: Record<string, any>, filter: Record<string, any>) =>
        Object.entries(filter).every(([key, value]) => {
            if (value && typeof value === 'object' && '$exists' in value) return (field(row, key) !== undefined) === value.$exists;
            if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
            if (value && typeof value === 'object' && '$lt' in value) return row[key] < value.$lt;
            return row[key] === value;
        });
    const db = {
        collection(name: string) {
            if (!tables.has(name)) tables.set(name, new Map());
            const table = tables.get(name)!;
            return {
                async createIndex() { return 'preview'; },
                async insertOne(row: Record<string, any>) {
                    if (table.has(row._id)) throw new Error('Duplicate key');
                    table.set(row._id, structuredClone(row));
                    return { insertedId: row._id };
                },
                async findOne(filter: Record<string, any>) {
                    const row = [...table.values()].find((item) => matches(item, filter));
                    return row ? structuredClone(row) : null;
                },
                find(filter: Record<string, any>) {
                    const rows = [...table.values()].filter((item) => matches(item, filter)).map((row) => structuredClone(row));
                    return {
                        sort(order: Record<string, number>) {
                            const [key, direction] = Object.entries(order)[0];
                            rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * direction);
                            return this;
                        },
                        async toArray() { return rows; },
                    };
                },
                async updateOne(filter: Record<string, any>, update: Record<string, any>, options: { upsert?: boolean } = {}) {
                    const row = [...table.values()].find((item) => matches(item, filter));
                    if (!row && options.upsert) {
                        const inserted = structuredClone({ ...filter, ...update.$setOnInsert });
                        updateRow(inserted, update);
                        table.set(inserted._id, inserted);
                        return { matchedCount: 0, upsertedCount: 1 };
                    }
                    if (!row) return { matchedCount: 0 };
                    updateRow(row, update);
                    return { matchedCount: 1 };
                },
                async findOneAndUpdate(filter: Record<string, any>, update: Record<string, any>, options: { returnDocument?: string } = {}) {
                    const row = [...table.values()].find((item) => matches(item, filter));
                    if (!row) return null;
                    const before = structuredClone(row);
                    updateRow(row, update);
                    return options.returnDocument === 'after' ? structuredClone(row) : before;
                },
                async deleteOne(filter: Record<string, any>) {
                    const row = [...table.values()].find((item) => matches(item, filter));
                    if (row) table.delete(row._id);
                },
                async deleteMany(filter: Record<string, any>) {
                    for (const row of table.values()) if (matches(row, filter)) table.delete(row._id);
                },
            };
        },
    };
    return { db: db as unknown as Context['db'], tables };
}
