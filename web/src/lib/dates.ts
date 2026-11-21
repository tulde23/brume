const at = (iso: string) => new Date(`${iso}T12:00:00`);

/** "Sat, Dec 6" */
export const shortDate = (iso: string) => at(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
/** "Saturday, December 6" (with the year when it isn't this year). */
export const longDate = (iso: string) => {
  const d = at(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
