/**
 * Copy a string to the clipboard. Client-only.
 *
 * navigator.clipboard.writeText is the modern path, but it throws when the
 * page is not focused, Permissions-Policy blocks clipboard-write, or the
 * automation browser has no clipboard. Fall back to a hidden textarea +
 * execCommand so a host tap still works. Returns false only when both fail
 * (caller should reveal a selectable field).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
