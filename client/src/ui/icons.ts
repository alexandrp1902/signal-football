const svg=(body:string)=>`<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const icons={
 arrowUpRight:svg('<path d="M8 24 24 8M8 8h16v16"/>'),
 arrowRight:svg('<path d="M5 16h22M17 6l10 10-10 10"/>'),
 move:svg('<path d="M16 4v24M4 16h24M12 8l4-4 4 4M12 24l4 4 4-4M8 12l-4 4 4 4M24 12l4 4-4 4"/>'),
 kick:svg('<path d="m6 4 4 13 6 2 4 6H8l-4-5M8 25v3h13"/><circle cx="25" cy="10" r="5"/><path d="m24 8 3 2-2 3-3-2zM15 8l3-2M16 13h3"/>'),
 tackle:svg('<circle cx="9" cy="7" r="3"/><path d="m9 11 6 5 9 1 4 5H15L9 18l-5 6M4 28h22M3 16H1M5 12H2"/>'),
 copy:svg('<rect x="10" y="5" width="17" height="20" rx="3"/><path d="M22 25v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2h3"/>'),
 leave:svg('<path d="M18 6H7v20h11M16 16h13m-5-5 5 5-5 5"/>'),
 ball:svg('<circle cx="16" cy="16" r="12"/><path d="m16 10 6 4-2 7h-8l-2-7zM16 10V4M22 14l5-2M20 21l4 5M12 21l-4 5M10 14l-5-2"/>'),
};
