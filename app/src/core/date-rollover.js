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

export { resolveDateRollover };
export default api;
