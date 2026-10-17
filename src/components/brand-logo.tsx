/* eslint-disable @next/next/no-img-element */
// The same artwork as the installed app icon, so the web UI and the home-screen icon always match.
export default function BrandLogo({ size = 38 }: { size?: number }) {
  return <img className="brand-logo" src="/icons/icon-192.png" alt="نظرة" width={size} height={size} style={{ width: size, height: size }} />;
}
