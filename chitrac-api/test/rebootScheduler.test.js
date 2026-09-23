const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  REBOOT_DELAY_SECONDS,
  createLinuxRebootScheduler
} = require("../utils/rebootScheduler");

test("scheduled reboot can be cancelled through the kill command", async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.unref = () => {};
  let spawnCall;
  let killCall;
  const scheduledAt = new Date("2026-09-23T12:00:00.000Z");
  const scheduler = createLinuxRebootScheduler({
    now: () => scheduledAt,
    spawn: (...args) => {
      spawnCall = args;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
    execFile: (...args) => {
      killCall = args;
      queueMicrotask(() => args[2](null, "", ""));
    }
  });

  const status = await scheduler.schedule();
  assert.equal(status.scheduled, true);
  assert.equal(status.remainingSeconds, REBOOT_DELAY_SECONDS);
  assert.deepEqual(spawnCall, [
    "/bin/sh",
    ["-c", `sleep ${REBOOT_DELAY_SECONDS} && sudo /sbin/shutdown -r now`],
    { detached: true, stdio: "ignore" }
  ]);

  const cancellation = await scheduler.cancel();
  assert.equal(cancellation.cancelled, true);
  assert.deepEqual(killCall.slice(0, 2), [
    "/bin/kill",
    ["-TERM", "--", "-4321"]
  ]);
  assert.deepEqual(scheduler.getStatus(), { scheduled: false, remainingSeconds: 0 });
});

test("scheduler rejects a second reboot while one is pending", async () => {
  const child = new EventEmitter();
  child.pid = 9876;
  child.unref = () => {};
  const scheduler = createLinuxRebootScheduler({
    spawn: () => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
    execFile: () => {}
  });

  await scheduler.schedule();
  assert.throws(
    () => scheduler.schedule(),
    (error) => error.code === "REBOOT_ALREADY_SCHEDULED"
  );
});
