// What each edition shows. The web has everything; the Android app's free
// edition leaves out the enthusiast details (track facts, gradients and
// height profile, spacing to other trains), which come with Pro (phase C5).

export function enthusiast(config) {
  return config.platform !== "android" || config.pro === true;
}
