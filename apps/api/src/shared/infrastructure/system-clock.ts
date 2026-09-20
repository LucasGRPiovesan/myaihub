import { ulid } from 'ulid';
import type { Clock, IdGenerator } from '../application/ports.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class UlidGenerator implements IdGenerator {
  generate(): string {
    return ulid();
  }
}
