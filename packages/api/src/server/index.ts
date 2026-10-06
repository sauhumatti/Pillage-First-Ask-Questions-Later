// Entry point for running the game API outside the browser, used by apps/server.
// The browser runs the same code through ../worker/api-worker.ts.
export {
  cancelScheduling,
  initScheduler,
  scheduleNextEvent,
} from '../http/events/scheduler/scheduler';
export { createSchedulerDataSource } from '../http/events/scheduler/scheduler-data-source';
export { matchRoute } from '../http/route-matcher';
export { createTroopStarvationEvent } from '../utils/starvation';
export {
  setNotificationPort,
  setShouldPostNotifications,
} from '../worker/notification-port';
