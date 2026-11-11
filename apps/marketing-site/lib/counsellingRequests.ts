import { db } from './db';

export type CounsellingRequest = {
  id: number;
  name: string;
  contact: string;
  message: string;
  created_at: number;
};

export function createCounsellingRequest(input: {
  name: string;
  contact: string;
  message: string;
}): void {
  db.prepare(
    'INSERT INTO counselling_requests (name, contact, message, created_at) VALUES (?, ?, ?, ?)'
  ).run(input.name, input.contact, input.message, Date.now());
}

export function listCounsellingRequests(): CounsellingRequest[] {
  return db
    .prepare('SELECT * FROM counselling_requests ORDER BY created_at DESC')
    .all() as CounsellingRequest[];
}
