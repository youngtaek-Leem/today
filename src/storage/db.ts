import Dexie, { type EntityTable } from 'dexie';
import type { Entry } from './types';

export class DailyRecordDB extends Dexie {
  entries!: EntityTable<Entry, 'id'>;

  constructor() {
    super('DailyRecordDB');
    this.version(1).stores({
      entries: 'id, date, type, createdAt',
    });
  }
}

export const db = new DailyRecordDB();