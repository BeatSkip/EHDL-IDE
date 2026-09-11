export type ActivityId = "explorer" | "library" | "create" | "settings";

function IconExplorer() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M5 3h9l5 5v13H5z" />
      <path d="M14 3v5h5" />
      <path d="M9 12h6M9 15h4" />
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M12 6c-1.6-1.4-3.8-2-7-2v14c3.2 0 5.4.6 7 2 1.6-1.4 3.8-2 7-2V4c-3.2 0-5.4.6-7 2z" />
      <path d="M12 6v14" />
    </svg>
  );
}

function IconCreate() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M5 3h8l5 5v6" />
      <path d="M13 3v5h5" />
      <path d="M12 14v7M8.5 17.5h7" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M4.2 7.4l2.6 1.5M17.2 15.1l2.6 1.5M4.2 16.6l2.6-1.5M17.2 8.9l2.6-1.5" />
    </svg>
  );
}

/** VS Code-style activity bar: Explorer + Library + Create at the top, Settings at the bottom. */
export function ActivityBar({
  active,
  onSelect,
}: {
  active: ActivityId;
  onSelect: (id: ActivityId) => void;
}) {
  const button = (id: ActivityId, label: string, icon: React.ReactNode) => (
    <button
      key={id}
      className={`ab-item ${active === id ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={() => onSelect(id)}
    >
      {icon}
    </button>
  );

  return (
    <nav className="activity-bar" aria-label="Activity bar">
      <div className="activity-bar-top">
        {button("explorer", "Project Explorer", <IconExplorer />)}
        {button("library", "Library Manager", <IconLibrary />)}
        {button("create", "Create part", <IconCreate />)}
      </div>
      <div className="activity-bar-bottom">
        {button("settings", "Settings", <IconSettings />)}
      </div>
    </nav>
  );
}
