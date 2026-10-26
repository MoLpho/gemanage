import { describe, expect, it } from 'vitest';
import {
  applyLazyReset,
  clampCount,
  computePeriodKey,
  getRemainingMsToReset,
  type Game,
  type Task,
  sortIncompleteTasksByReset
} from './index.js';

const tokyo = 'Asia/Tokyo';

function createTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    gameId: 'game-1',
    name: 'daily',
    period: 'daily',
    target: 5,
    count: 0,
    periodKey: 'daily:1970-01-01',
    ...overrides
  };
}

describe('computePeriodKey', () => {
  it('daily: resetHourの前後で日付キーが切り替わる', () => {
    const task = createTask({ period: 'daily' });
    const beforeReset = new Date('2026-03-05T18:59:00.000Z');
    const afterReset = new Date('2026-03-05T19:01:00.000Z');

    expect(computePeriodKey(task, beforeReset, 4, tokyo)).toBe('daily:2026-03-05');
    expect(computePeriodKey(task, afterReset, 4, tokyo)).toBe('daily:2026-03-06');
  });

  it('weekly: 指定曜日の境界をまたいでも直近の指定曜日キーを返す', () => {
    const mondayTask = createTask({ period: 'weekly', weekday: 1 });
    const sunday = new Date('2026-02-08T10:30:00.000Z');
    const monday = new Date('2026-02-09T15:30:00.000Z');

    expect(computePeriodKey(mondayTask, sunday, 0, tokyo)).toBe('weekly:2026-02-02');
    expect(computePeriodKey(mondayTask, monday, 0, tokyo)).toBe('weekly:2026-02-09');
  });

  it('monthly: 月末日がない月は末日に丸める', () => {
    const monthEndTask = createTask({ period: 'monthly', monthDay: 31 });
    const february = new Date('2026-02-28T12:00:00.000Z');

    expect(computePeriodKey(monthEndTask, february, 0, tokyo)).toBe('monthly:2026-02-28');
  });

  it('monthly: 年跨ぎで前月キーを正しく返す', () => {
    const monthTask = createTask({ period: 'monthly', monthDay: 5 });
    const januaryBeforeDay5 = new Date('2027-01-03T12:00:00.000Z');

    expect(computePeriodKey(monthTask, januaryBeforeDay5, 0, tokyo)).toBe('monthly:2026-12-05');
  });
});

describe('count and reset', () => {
  it('countを0〜targetに丸める', () => {
    expect(clampCount(-10, 3)).toBe(0);
    expect(clampCount(10, 3)).toBe(3);
    expect(clampCount(2, 3)).toBe(2);
  });

  it('遅延リセットでperiodKey不一致時にcountを0にする', () => {
    const task = createTask({
      period: 'daily',
      count: 3,
      target: 5,
      periodKey: 'daily:2026-03-05'
    });

    const now = new Date('2026-03-06T03:00:00.000Z');
    const reset = applyLazyReset(task, now, 0, tokyo);

    expect(reset.periodKey).toBe('daily:2026-03-06');
    expect(reset.count).toBe(0);
  });
});

describe('sortIncompleteTasksByReset', () => {
  it('未完了タスクをリセット残り時間が短い順に並べる', () => {
    const now = new Date('2026-03-06T10:00:00.000Z');
    const games: Record<string, Game> = {
      g1: { id: 'g1', name: 'A', resetHour: 4, color: '#fff' },
      g2: { id: 'g2', name: 'B', resetHour: 0, color: '#000' }
    };

    const tasks: Task[] = [
      createTask({ id: 't1', gameId: 'g1', period: 'daily', target: 5, count: 1 }),
      createTask({ id: 't2', gameId: 'g2', period: 'daily', target: 5, count: 1 }),
      createTask({ id: 't3', gameId: 'g1', period: 'daily', target: 5, count: 5 })
    ];

    const result = sortIncompleteTasksByReset(tasks, games, now, tokyo);

    expect(result.map((task) => task.id)).toEqual(['t2', 't1']);
    expect(getRemainingMsToReset(result[0], now, games[result[0].gameId].resetHour, tokyo)).toBeLessThan(
      getRemainingMsToReset(result[1], now, games[result[1].gameId].resetHour, tokyo)
    );
  });
});
