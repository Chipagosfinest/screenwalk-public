const IGNORED_DIRECTORY = /(?:^|\/)(?:node_modules|\.next|dist|build|\.git)(?:\/|$)/;
const UI_SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|css|html?|vue|svelte|astro)$/;

export function isUiSourceFile(filename) {
  const normalized = filename.replaceAll("\\", "/");
  return !IGNORED_DIRECTORY.test(normalized) && UI_SOURCE_EXTENSION.test(normalized);
}
