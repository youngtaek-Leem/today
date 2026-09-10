import Dexie, { type EntityTable } from 'dexie';
import type { Entry, Story } from './types';

export class DailyRecordDB extends Dexie {
  entries!: EntityTable<Entry, 'id'>;
  stories!: EntityTable<Story, 'id'>;

  constructor() {
    super('DailyRecordDB');
    this.version(1).stores({
      entries: 'id, date, type, createdAt',
    });
    this.version(2).stores({
      entries: 'id, date, type, createdAt',
      stories: 'id, date, updatedAt',
    });
  }
}

export const db = new DailyRecordDB();