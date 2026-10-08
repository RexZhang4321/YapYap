import { fileURLToPath } from "node:url";

function normalize(value) {
  if (value === "windows" || value === "win32") return "windows";
  if (value === "macos" || value === "darwin") return "macos";
  return "unsupported";
}

// Tauri's target takes precedence over the machine running Vite. An explicit
// override is useful for browser fixtures and frontend builds without Tauri.
export function resolvePlatform({
  target = process.env.TAURI_ENV_PLATFORM,
  override = process.env.YAPYAP_BUILD_PLATFORM,
  host = process.platform,
} = {}) {
  if (override && !["windows", "macos", "unsupported"].includes(override))
    throw new Error(
      "YAPYAP_BUILD_PLATFORM must be windows, macos, or unsupported.",
    );
  if (target) {
    const selected = normalize(target);
    if (override && override !== selected)
      throw new Error("YAPYAP_BUILD_PLATFORM conflicts with the Tauri target.");
    return selected;
  }
  return override || normalize(host);
}

export function platformAlias(target = resolvePlatform()) {
  if (!["windows", "macos", "unsupported"].includes(target))
    throw new Error("Unknown frontend platform.");
  return {
    "#platform": fileURLToPath(
      new URL(`./src/platform/platform.${target}.ts`, import.meta.url),
    ),
  };
}
