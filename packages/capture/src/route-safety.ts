const CONSEQUENTIAL_SEGMENT = /^(?:logout|log-out|signout|sign-out|delete(?:[-_].*)?|remove(?:[-_].*)?|destroy(?:[-_].*)?|checkout(?:[-_].*)?|purchase(?:[-_].*)?|unsubscribe(?:[-_].*)?)$/i;
const NON_PAGE_ASSET = /\.(?:png|jpe?g|gif|svg|webp|pdf|zip|mp4|mp3)$/i;

export function unsafePath(path: string): boolean {
  if (NON_PAGE_ASSET.test(path)) return true;
  return path.split("/").filter(Boolean).some((segment) => CONSEQUENTIAL_SEGMENT.test(segment));
}
