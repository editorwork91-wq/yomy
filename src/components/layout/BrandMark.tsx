type BrandMarkProps = {
  size?: number
  className?: string
}

export default function BrandMark({ size = 32, className = '' }: BrandMarkProps) {
  return (
    <img
      src="/yomy-logo.svg"
      alt="Yomy"
      width={size}
      height={size}
      draggable={false}
      className={className}
    />
  )
}
