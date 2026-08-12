/**
 * Copilot Usage Projection — calculates if you'll run out before reset.
 *
 * Assumptions:
 *  - User configures their work days per week (default 5)
 *  - Usage is distributed across workdays only
 *  - Projection is based on average daily usage on workdays
 */

/**
 * @typedef {Object} UsageProjection
 * @property {number} dailyRate - Average credits used per workday
 * @property {number} projectedTotal - Projected total usage by reset date
 * @property {number} projectedPercentage - Projected usage as percentage of limit
 * @property {boolean} willExceed - Whether projected usage exceeds the limit
 * @property {number} daysUntilExhausted - Estimated workdays until credits run out (Infinity if won't)
 * @property {string} status - "good" | "warning" | "danger"
 * @property {string} message - Human-readable projection summary
 * @property {number} remainingCredits - Credits remaining
 * @property {number} workdaysRemaining - Workdays left until reset
 * @property {number} workdaysElapsed - Workdays elapsed since cycle start
 */

/**
 * Calculate usage projection based on current usage and work schedule.
 * @param {import('./fetcher.js').CopilotUsage} usage - Current usage data
 * @param {number} [workDaysPerWeek=5] - Number of workdays per week (1-7)
 * @returns {UsageProjection}
 */
export function calculateProjection(usage, workDaysPerWeek = 5) {
  const { used, limit, daysUntilReset } = usage;
  const remaining = limit - used;

  // Clamp workdays to valid range
  const workDays = Math.max(1, Math.min(7, workDaysPerWeek));

  // Calculate the total cycle length (days from start to reset)
  const cycleDays = estimateCycleDays(daysUntilReset);
  const daysElapsed = cycleDays - daysUntilReset;

  // Count workdays elapsed and remaining using the configured schedule
  const workdaysElapsed = countWorkdaysElapsed(daysElapsed, workDays);
  const workdaysRemaining = countWorkdaysInFuture(daysUntilReset, workDays);

  // Daily rate based on workdays elapsed
  const dailyRate = workdaysElapsed > 0 ? used / workdaysElapsed : 0;

  // Project total usage by end of cycle
  const projectedAdditional = dailyRate * workdaysRemaining;
  const projectedTotal = used + projectedAdditional;
  const projectedPercentage = Math.round((projectedTotal / limit) * 100);

  // Will we exceed?
  const willExceed = projectedTotal > limit;

  // Days until exhausted (in workdays)
  let daysUntilExhausted = Infinity;
  if (dailyRate > 0 && remaining > 0) {
    daysUntilExhausted = Math.floor(remaining / dailyRate);
  } else if (remaining <= 0) {
    daysUntilExhausted = 0;
  }

  // Status classification
  let status;
  if (projectedPercentage <= 80) {
    status = "good";
  } else if (projectedPercentage <= 95) {
    status = "warning";
  } else {
    status = "danger";
  }

  // Human-readable message
  const message = buildMessage(status, willExceed, projectedPercentage, daysUntilExhausted, workdaysRemaining, remaining);

  return {
    dailyRate: Math.round(dailyRate),
    projectedTotal: Math.round(projectedTotal),
    projectedPercentage,
    willExceed,
    daysUntilExhausted,
    status,
    message,
    remainingCredits: remaining,
    workdaysRemaining,
    workdaysElapsed,
  };
}

/**
 * Estimate total cycle days. GitHub Copilot typically resets monthly.
 */
function estimateCycleDays(daysUntilReset) {
  if (daysUntilReset <= 31) {
    return 31;
  }
  return daysUntilReset + 10;
}

/**
 * Approximate workdays elapsed using a ratio based on configured work days per week.
 * @param {number} totalDays - Calendar days elapsed
 * @param {number} workDaysPerWeek - Configured work days per week
 */
function countWorkdaysElapsed(totalDays, workDaysPerWeek) {
  if (totalDays <= 0) return 0;

  // If working 7 days, every day is a workday
  if (workDaysPerWeek >= 7) return totalDays;

  // Use ratio: workDaysPerWeek/7 of calendar days are workdays
  const fullWeeks = Math.floor(totalDays / 7);
  const remainingDays = totalDays % 7;
  const remainingWorkdays = Math.min(remainingDays, workDaysPerWeek);
  return fullWeeks * workDaysPerWeek + remainingWorkdays;
}

/**
 * Count workdays remaining from today until reset.
 * For 5-day weeks: counts Mon-Fri. For other configs: uses ratio.
 * @param {number} daysUntilReset - Calendar days until reset
 * @param {number} workDaysPerWeek - Configured work days per week
 */
function countWorkdaysInFuture(daysUntilReset, workDaysPerWeek) {
  if (workDaysPerWeek >= 7) return daysUntilReset;

  // For standard 5-day week, count actual Mon-Fri
  if (workDaysPerWeek === 5) {
    let count = 0;
    const today = new Date();
    for (let i = 1; i <= daysUntilReset; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  }

  // For non-standard schedules (4, 6, etc.), use the ratio approach
  const fullWeeks = Math.floor(daysUntilReset / 7);
  const remainingDays = daysUntilReset % 7;
  const remainingWorkdays = Math.min(remainingDays, workDaysPerWeek);
  return fullWeeks * workDaysPerWeek + remainingWorkdays;
}

function buildMessage(status, willExceed, projectedPercentage, daysUntilExhausted, workdaysRemaining, remaining) {
  if (remaining <= 0) {
    return "Credits exhausted! Wait for reset.";
  }

  if (status === "good") {
    return `On track — ~${projectedPercentage}% projected by reset`;
  }

  if (status === "warning") {
    if (willExceed) {
      return `Tight — may hit limit ~${daysUntilExhausted} workdays before reset`;
    }
    return `Watch it — ~${projectedPercentage}% projected by reset`;
  }

  // danger
  if (willExceed && daysUntilExhausted < workdaysRemaining) {
    return `⚠️ Will run out in ~${daysUntilExhausted} workdays at current pace`;
  }
  return `⚠️ Projected ${projectedPercentage}% usage — slow down`;
}
