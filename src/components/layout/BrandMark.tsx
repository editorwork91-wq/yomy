type BrandMarkProps = {
  size?: number
  className?: string
}

export default function BrandMark({ size = 32, className = '' }: BrandMarkProps) {
  return (
    <img
      src="/YOMY-LOGO.jpeg"
      alt="Yomy"
      width={size}
      height={size}
      draggable={false}
      className={className}
    />
  )
}
