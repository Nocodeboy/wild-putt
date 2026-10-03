const s = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** Full-colour icons (food) that do not follow the text colour. */
const c = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const IC = {
  pause: s('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>'),
  gear: s('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>'),
  back: s('<path d="M15 5l-7 7 7 7"/>'),
  grid: s('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  cal: s('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><circle cx="12" cy="15" r="2" fill="currentColor"/>'),
  share: s('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v6h14v-6"/>'),
  retry: s('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>'),
  next: s('<path d="M9 5l7 7-7 7"/>'),
  play: s('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  home: s('<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>'),
  clock: s('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2.5h6"/>'),
  people: s('<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.3c.5-.2 1-.3 1.5-.3 2.5 0 4.5 2.4 4.5 5.4"/>'),
  smile: s('<circle cx="12" cy="12" r="9"/><path d="M8 14.5c1 1.5 2.3 2.2 4 2.2s3-.7 4-2.2"/><circle cx="9" cy="9.5" r="1" fill="currentColor"/><circle cx="15" cy="9.5" r="1" fill="currentColor"/>'),
  angry: s('<circle cx="12" cy="12" r="9"/><path d="M8 17c1-1.3 2.3-2 4-2s3 .7 4 2M7.5 8.5l3 1.5M16.5 8.5l-3 1.5"/>'),
  coin: s('<circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="5.5" stroke="#0b1a1f" stroke-width="1.6"/>'),
  tray: s('<path d="M3 17h18"/><path d="M5 17a7 7 0 0 1 14 0"/><path d="M12 8V6.5M10.5 6.5h3"/>'),
  bolt: s('<path d="M13 2 5 13.5h6L10 22l9-12.5h-6z" fill="currentColor" stroke="none"/>'),
  ball: c('<circle cx="12" cy="12" r="8" fill="#fff" stroke="#c8ccd0" stroke-width="1"/><circle cx="9.5" cy="9" r=".9" fill="#c8ccd0"/><circle cx="13" cy="8.5" r=".9" fill="#c8ccd0"/><circle cx="10.5" cy="12.5" r=".9" fill="#c8ccd0"/><circle cx="14.5" cy="12" r=".9" fill="#c8ccd0"/><circle cx="12.5" cy="15.5" r=".9" fill="#c8ccd0"/>'),
  hole: c('<ellipse cx="12" cy="19" rx="7" ry="2.4" fill="#141414"/><rect x="11" y="3" width="1.8" height="16" rx=".9" fill="#f4f4f0"/><path d="M12.8 3.5h7.5l-2.2 3 2.2 3h-7.5z" fill="#e8483a"/>'),
  cam: s('<path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.6"/>'),
  putter: s('<path d="M15 3 9.5 18"/><path d="M6.5 18.5h6.5a1.5 1.5 0 0 1 0 3H6.5z" fill="currentColor"/>'),
  flag: c('<rect x="5" y="3" width="2" height="18" rx="1" fill="#f1ead8"/><path d="M7 4h11l-3 4 3 4H7z" fill="#e8483a"/>'),
  pen: s('<path d="M3 20V9M21 20V9M3 11h18M3 16h18M8 9v11M16 9v11"/>'),
  oldbark: s('<path d="M4 10v4h3l4 3V7L7 10z" fill="currentColor"/><path d="M15 9c1 .8 1.5 1.8 1.5 3s-.5 2.2-1.5 3M18 6.5c1.8 1.4 2.8 3.3 2.8 5.5s-1 4.1-2.8 5.5"/>'),
  sneak: s('<path d="M4 16c2-1 3-3 6-3s4 2 6 2 3-1 4-2"/><path d="M6 20h12"/><circle cx="7" cy="9" r="1.6" fill="currentColor"/><circle cx="12" cy="7" r="1.6" fill="currentColor"/><circle cx="17" cy="9" r="1.6" fill="currentColor"/>'),
  sun: s('<path d="M3 17h18"/><path d="M6.5 17a5.5 5.5 0 0 1 11 0"/><path d="M12 6.5v2M5.5 9.5l1.4 1.4M18.5 9.5l-1.4 1.4"/>'),
  lock: s('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  trophy: s('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.6M17 6h2.5a2.5 2.5 0 0 1-2.6 3.6M12 14v3M8 21h8M9.5 17h5v4h-5z"/>'),
  route: s('<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>'),
  alert: c('<circle cx="12" cy="12" r="10" fill="#ff4b3a"/><rect x="10.6" y="5.5" width="2.8" height="8.5" rx="1.4" fill="#fff"/><circle cx="12" cy="17.6" r="1.7" fill="#fff"/>'),
};


/** One symbol per course (stamps on the tour, course cards). */
export const COURSE_IC: Record<string, string> = {
  garden: s('<path d="M12 21v-6"/><circle cx="12" cy="9" r="6"/><path d="M5 21h14"/>'),
  roofs: s('<path d="M3 12 12 4l9 8"/><path d="M5 10v10h14V10"/><path d="M16 7V3.5h2.5V9"/>'),
  ship: s('<circle cx="12" cy="5" r="2"/><path d="M12 7v13M7 11h10"/><path d="M4 14a8 6 0 0 0 16 0"/>'),
  fair: s('<circle cx="12" cy="10" r="7"/><path d="M12 3v14M5 10h14M7 5l10 10M17 5 7 15"/><path d="M8 21l4-4 4 4"/>'),
  glacier: s('<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>'),
  volcano: s('<path d="M3 20h18l-6-10h-6z"/><path d="M10 10c-1-2 0-3 1-4M14 10c1-2 0-3-1-4M12 6V3"/>'),
  beach: s('<path d="M12 21c0-5 1-9 3-12"/><path d="M15 9c-2-3-6-3-8-1 3 0 5 0 8 1zM15 9c2-3 6-3 7-1-3 0-5 0-7 1zM15 9c0-3 2-5 5-5-1 2-3 4-5 5z"/><path d="M3 21h18"/>'),
  temple: s('<path d="M3 20h18L12 4z"/><path d="M8.5 13.5h7M7 16.5h10"/>'),
  castle: s('<path d="M4 21V8h3v2h3V8h4v2h3V8h3v13z"/><path d="M10 21v-5a2 2 0 0 1 4 0v5"/>'),
  neon: s('<path d="M13 2 5 13.5h6L10 22l9-12.5h-6z"/>'),
  canyon: s('<path d="M12 21V5a2 2 0 0 1 4 0v8"/><path d="M12 14H9a2 2 0 0 1-2-2V9"/><path d="M16 11h1.5a1.5 1.5 0 0 0 1.5-1.5V8M4 21h16"/>'),
  moon: s('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/><circle cx="16" cy="6" r="1" fill="currentColor"/>'),
};
