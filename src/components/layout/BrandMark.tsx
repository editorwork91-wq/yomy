type BrandMarkProps = {
  size?: number
  className?: string
}

// The in-app mark intentionally uses the dedicated transparent artwork.
// Keeping it at repository root preserves the requested original filename,
// while Vite bundles it as an application asset at build time.
const inAppLogo = new URL('../../../11585-removebg-preview.png', import.meta.url).href

export default function BrandMark({ size = 32, className = '' }: BrandMarkProps) {
  return (
    <img
      src={inAppLogo}
      alt="Yomy"
      width={size}
      height={size}
      draggable={false}
      className={`object-contain ${className}`}
    />
  )
}
