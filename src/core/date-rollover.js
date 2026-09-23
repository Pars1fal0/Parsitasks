(function (global) {
  function resolveDateRollover(activeDate, previousToday, nextToday) {
    if (!nextToday || nextToday === previousToday) {
      return { activeDate, changed: false, today: previousToday };
    }

    return {
      activeDate: activeDate === previousToday ? nextToday : activeDate,
      changed: true,
      today: nextToday,
    };
  }

  const api = { resolveDateRollover };
  global.RhythmDateRollover = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
