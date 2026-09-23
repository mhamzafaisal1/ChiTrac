const REBOOT_DELAY_SECONDS = 30;

function createLinuxRebootScheduler({ spawn, execFile, now = () => new Date() }) {
  let scheduledReboot = null;

  function clearScheduledReboot(pid) {
    if (!scheduledReboot || (pid && scheduledReboot.pid !== pid)) return;
    scheduledReboot = null;
  }

  function getStatus() {
    if (!scheduledReboot) {
      return { scheduled: false, remainingSeconds: 0 };
    }

    const remainingSeconds = Math.max(
      0,
      Math.ceil((scheduledReboot.executesAt.getTime() - now().getTime()) / 1000)
    );

    if (remainingSeconds === 0) {
      clearScheduledReboot(scheduledReboot.pid);
      return { scheduled: false, remainingSeconds: 0 };
    }

    return {
      scheduled: true,
      scheduledAt: scheduledReboot.scheduledAt,
      executesAt: scheduledReboot.executesAt,
      remainingSeconds
    };
  }

  function schedule() {
    if (getStatus().scheduled) {
      const error = new Error("A server reboot is already scheduled.");
      error.code = "REBOOT_ALREADY_SCHEDULED";
      throw error;
    }

    return new Promise((resolve, reject) => {
      let child;

      try {
        child = spawn(
          "/bin/sh",
          ["-c", `sleep ${REBOOT_DELAY_SECONDS} && sudo /sbin/shutdown -r now`],
          { detached: true, stdio: "ignore" }
        );
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      child.once("spawn", () => {
        const scheduledAt = now();
        scheduledReboot = {
          pid: child.pid,
          scheduledAt,
          executesAt: new Date(scheduledAt.getTime() + REBOOT_DELAY_SECONDS * 1000)
        };
        settled = true;
        child.unref();
        resolve(getStatus());
      });
      child.once("error", (error) => {
        clearScheduledReboot(child.pid);
        if (!settled) reject(error);
      });
      child.once("exit", () => clearScheduledReboot(child.pid));
    });
  }

  function cancel() {
    const status = getStatus();
    if (!status.scheduled || !scheduledReboot) {
      return Promise.resolve(null);
    }

    const rebootToCancel = scheduledReboot;
    return new Promise((resolve, reject) => {
      execFile(
        "/bin/kill",
        ["-TERM", "--", `-${rebootToCancel.pid}`],
        (error, stdout, stderr) => {
          if (error) {
            error.details = String(stderr || stdout || error.message).trim();
            reject(error);
            return;
          }

          clearScheduledReboot(rebootToCancel.pid);
          resolve({
            cancelled: true,
            scheduledAt: rebootToCancel.scheduledAt,
            executesAt: rebootToCancel.executesAt
          });
        }
      );
    });
  }

  return { cancel, getStatus, schedule };
}

module.exports = {
  REBOOT_DELAY_SECONDS,
  createLinuxRebootScheduler
};
