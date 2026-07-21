// Shared SVG icon set — 16px stroke icons, inherit currentColor.
// Keep every icon on the same 24×24 grid with strokeWidth 1.7 for visual consistency.

const base = (size) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
});

export const IconGrid = ({ size = 16 }) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
  </svg>
);

export const IconTag = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M20.6 13.4L11 3.8a2 2 0 0 0-1.4-.6H4.2a1 1 0 0 0-1 1v5.4c0 .5.2 1 .6 1.4l9.6 9.6a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8z"/>
    <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none"/>
  </svg>
);

export const IconUpload = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M21 15v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"/><path d="M7 9l5-5 5 5"/><path d="M12 4v12"/>
  </svg>
);

export const IconList = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth="2.4"/>
  </svg>
);

export const IconBookmark = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M19 21l-7-4.5L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
  </svg>
);

export const IconFolder = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z"/>
  </svg>
);

export const IconHistory = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3.5 2"/>
  </svg>
);

export const IconFileExport = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9.5 14.5L12 12l2.5 2.5"/>
  </svg>
);

export const IconPercent = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
  </svg>
);

export const IconLogout = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>
  </svg>
);

export const IconRefresh = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>
  </svg>
);

export const IconMaximize = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
  </svg>
);

export const IconMinimize = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>
  </svg>
);

export const IconDownload = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M21 15v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>
  </svg>
);

export const IconArrowRight = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
  </svg>
);

export const IconLayers = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M12 2L2 7.5 12 13l10-5.5L12 2z"/><path d="M2 12.5L12 18l10-5.5"/><path d="M2 17.5L12 23l10-5.5" opacity="0.5"/>
  </svg>
);

export const IconZap = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/>
  </svg>
);
