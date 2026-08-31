export class DailyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private scheduledAt: Date | null = null;

  constructor(
    private readonly task: () => Promise<unknown>,
    private readonly hour = 6,
    private readonly minute = 0,
  ) {}

  nextCheck(): Date | null {
    return this.scheduledAt;
  }

  start(): void {
    this.stop();
    const now = new Date();
    const next = new Date(now);
    next.setHours(this.hour, this.minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    this.scheduledAt = next;
    this.timer = setTimeout(() => {
      void this.task().finally(() => this.start());
    }, Math.max(next.getTime() - now.getTime(), 1_000));
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
