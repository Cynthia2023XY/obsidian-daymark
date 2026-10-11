import { describe, expect, it, vi } from "vitest";
import { TimerService, validMinutes } from "../src/timer";

/** 真实截止时间是倒计时事实，不模拟逐秒递减 */
describe("独立番茄钟", () => {
  it("只接受 1—240 的整数分钟", () => {
    expect(validMinutes(45)).toBe(true);
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const value of [0, -1, 241, 1.5, NaN])
      expect(validMinutes(value)).toBe(false);
  });
  it("自定义 45 分钟，到时只提示一次且不自动切换模式", () => {
    // 记录当前时间，用于真实截止时间和修改标记
    let now = 0;
    // 记录完成提示次数，验证后台恢复不会重复通知
    const finished = vi.fn();
    // 建立独立计时状态机，不依赖事项数据
    const timer = new TimerService(() => now, finished);
    timer.select("focus", 45);
    timer.start();
    expect(timer.snapshot().seconds).toBe(2700);
    now = 45 * 60_000 + 5000;
    timer.tick();
    timer.tick();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(timer.snapshot()).toMatchObject({
      mode: "focus",
      status: "finished",
      seconds: 0,
    });
  });
  it("后台延迟或电脑睡眠后根据截止时间补偿", () => {
    // 记录当前时间，用于真实截止时间和修改标记
    let now = 0;
    // 建立独立计时状态机，不依赖事项数据
    const timer = new TimerService(() => now, vi.fn());
    timer.select("focus", 25);
    timer.start();
    now = 5 * 60_000;
    expect(timer.snapshot().seconds).toBe(1200);
    now = 30 * 60_000;
    timer.tick();
    expect(timer.snapshot().status).toBe("finished");
  });
  it("暂停冻结剩余时间，继续建立新的截止时间", () => {
    // 记录当前时间，用于真实截止时间和修改标记
    let now = 0;
    // 建立独立计时状态机，不依赖事项数据
    const timer = new TimerService(() => now, vi.fn());
    timer.select("focus", 10);
    timer.start();
    now = 60_000;
    timer.pause();
    now = 900_000;
    expect(timer.snapshot().seconds).toBe(540);
    timer.start();
    now += 60_000;
    timer.tick();
    expect(timer.snapshot().seconds).toBe(480);
  });
  it("暂停已结束轮次不会把 finished 改成 paused", () => {
    // 记录当前时间，用于真实截止时间和修改标记
    let now = 0;
    // 记录完成提示次数，验证后台恢复不会重复通知
    const finished = vi.fn();
    // 建立独立计时状态机，不依赖事项数据
    const timer = new TimerService(() => now, finished);
    timer.select("focus", 1);
    timer.start();
    now = 60_000;
    timer.pause();
    expect(timer.snapshot().status).toBe("finished");
    expect(finished).toHaveBeenCalledTimes(1);
  });
  it("模式切换与重置都放弃当前轮，不影响任何事项", () => {
    // 记录当前时间，用于真实截止时间和修改标记
    let now = 0;
    // 建立独立计时状态机，不依赖事项数据
    const timer = new TimerService(() => now, vi.fn());
    timer.start();
    now = 5000;
    timer.select("break", 7);
    expect(timer.snapshot()).toMatchObject({
      mode: "break",
      status: "idle",
      seconds: 420,
    });
    timer.start();
    now += 60_000;
    timer.reset();
    expect(timer.snapshot().seconds).toBe(420);
    expect(() => timer.select("focus", 0)).toThrow();
  });
});
