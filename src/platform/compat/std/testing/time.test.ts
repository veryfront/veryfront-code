import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "./time.ts";

describe("platform/compat/std/testing/time", () => {
  it("runs a timeout once the clock reaches its due time", () => {
    using time = new FakeTime();
    const fired: string[] = [];

    setTimeout(() => fired.push("late"), 100);
    setTimeout(() => fired.push("early"), 10);

    time.tick(9);
    assertEquals(fired, []);

    time.tick(1);
    assertEquals(fired, ["early"]);

    time.tick(90);
    assertEquals(fired, ["early", "late"]);
  });

  it("fires same-due timers in the order they were scheduled", () => {
    using time = new FakeTime();
    const fired: number[] = [];

    setTimeout(() => fired.push(1), 5);
    setTimeout(() => fired.push(2), 5);
    setTimeout(() => fired.push(3), 5);

    time.tick(5);

    assertEquals(fired, [1, 2, 3]);
  });

  it("runs timers a callback schedules inside the same tick", () => {
    using time = new FakeTime();
    const fired: string[] = [];

    setTimeout(() => {
      fired.push("outer");
      setTimeout(() => fired.push("inner"), 10);
    }, 10);

    time.tick(25);

    assertEquals(fired, ["outer", "inner"]);
  });

  it("repeats an interval for every period the tick spans", () => {
    using time = new FakeTime();
    let ticks = 0;

    const id = setInterval(() => {
      ticks += 1;
    }, 100);

    time.tick(350);
    assertEquals(ticks, 3);

    clearInterval(id);
    time.tick(1000);
    assertEquals(ticks, 3);
  });

  it("floors a zero-delay interval to a 1ms period", () => {
    using time = new FakeTime();
    let ticks = 0;

    const id = setInterval(() => {
      ticks += 1;
    }, 0);

    time.tick(1);
    assertEquals(ticks, 1, "a zero-delay interval is floored to a 1ms period");

    clearInterval(id);
  });

  it("caps a self-rescheduling timer instead of hanging the suite", () => {
    using time = new FakeTime();

    assertThrows(
      () => {
        setTimeout(function again() {
          setTimeout(again, 0);
        }, 0);
        time.tick(1);
      },
      Error,
      "fired more than",
      "a self-rescheduling timer must be capped instead of hanging the suite",
    );
  });

  it("does not run a timeout that was cleared before it came due", () => {
    using time = new FakeTime();
    let fired = false;

    const id = setTimeout(() => {
      fired = true;
    }, 10);
    clearTimeout(id);

    time.tick(1000);

    assertEquals(fired, false);
  });

  it("reports the faked clock through Date while keeping the real statics", () => {
    using time = new FakeTime(new Date("2026-01-01T00:00:00.000Z"));

    assertEquals(Date.now(), 1767225600000);
    assertEquals(new Date().toISOString(), "2026-01-01T00:00:00.000Z");
    assertEquals(new Date() instanceof Date, true);
    assertEquals(Date.UTC(2026, 0, 1), 1767225600000);

    time.tick(1500);

    assertEquals(Date.now(), 1767225601500);
    assertEquals(new Date("2026-06-01T00:00:00.000Z").getUTCMonth(), 5);
  });

  it("reports the faked clock when Date is called without new", () => {
    using _time = new FakeTime(0);

    assertEquals(Date(), new Date(0).toString());
  });

  it("exposes the fake clock to a timer callback while it runs", () => {
    using time = new FakeTime(0);
    const observed: number[] = [];

    setTimeout(() => observed.push(Date.now()), 30);
    setTimeout(() => observed.push(Date.now()), 70);

    time.tick(100);

    assertEquals(observed, [30, 70]);
  });

  it("lets already-pending jobs settle before advancing the clock", async () => {
    using time = new FakeTime();
    let settled = false;

    Promise.resolve().then(() => Promise.resolve()).then(() => {
      settled = true;
    });

    assertEquals(settled, false);
    await time.tickAsync(0);
    assertEquals(settled, true);
  });

  it("settles pending jobs against the clock as it stood before the tick", async () => {
    using time = new FakeTime(0);
    let observed: number | undefined;

    Promise.resolve().then(() => {
      observed = Date.now();
    });

    await time.tickAsync(100);

    assertEquals(observed, 0);
    assertEquals(Date.now(), 100);
  });

  it("restores the real clock and timers on dispose", () => {
    const realNow = Date.now;
    const realSetTimeout = globalThis.setTimeout;

    {
      using _time = new FakeTime(0);
      assertEquals(Date.now(), 0);
    }

    assertEquals(Date.now === realNow, true);
    assertEquals(globalThis.setTimeout === realSetTimeout, true);
  });

  it("refuses a second installation while one is active", () => {
    using _time = new FakeTime();

    assertThrows(() => new FakeTime(), Error);
  });

  it("refuses to move the clock backwards", () => {
    using time = new FakeTime(1000);

    assertThrows(() => time.tick(-1), RangeError);
  });
});

describe("platform/compat/std/testing/time non-finite advance", () => {
  it("rejects a non-finite advance", () => {
    // NaN slips past the backwards check (`NaN < now` is false) and then makes
    // #due treat every pending timer as due (`due > NaN` is false too), leaving
    // the clock NaN and every later assertion on it meaningless.
    using time = new FakeTime();
    let fired = false;
    setTimeout(() => (fired = true), 10_000);

    assertThrows(() => time.tick(NaN), RangeError);
    assertEquals(fired, false, "a rejected tick must not fire timers");
    assertEquals(Number.isFinite(time.now), true, "the clock must stay finite");
  });
});
