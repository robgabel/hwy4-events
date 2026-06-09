"use client";

import type { CSSProperties, ReactNode } from "react";

// A submit button that asks for confirmation before its form posts. Use for
// destructive, hard-to-reverse admin actions (delete event, delete experiment)
// so a single mis-click can't drop a row with no undo.
export function ConfirmSubmit({
  message,
  style,
  children,
}: {
  message: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      style={style}
      formNoValidate
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
