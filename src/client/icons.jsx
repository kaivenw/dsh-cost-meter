/**
 * 两个本包自绘的图标。
 *
 * 为什么自绘：`@deepseek-ai/dsh-client-ui-primitives` 的图标里没有「钱」这一族
 * （只有 gauge / database / clock 这些），而状态栏那一行的视觉语言必须一致——
 * 14px 行内尺寸、`viewBox="0 0 16 16"`、`fill:none`、`stroke:currentColor`、
 * Regular 档 `strokeWidth:1`。所以照同一套约定画两个，而不是塞一个 ¥ 文字或
 * 借一个语义不对的图标（借 database 会和官方「token 用量」那个 pill 撞脸）。
 *
 * 图层位置也照官方：整体占 2–14 的 12×12 安全区，笔画落在整数格上，
 * 缩到 14px 不会糊成一团。
 */

/** 花费：圆形里一个 ¥。 */
export function IconYuanCoinOutlineRegular({ size = 16, className, strokeWidth = 1 }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      strokeWidth={strokeWidth}
    >
      <path d="M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z" stroke="currentColor" />
      <path d="M5.7 5.2L8 8L10.3 5.2" stroke="currentColor" />
      <path d="M8 8V11.5" stroke="currentColor" />
      <path d="M5.9 8.75H10.1" stroke="currentColor" />
      <path d="M5.9 10.15H10.1" stroke="currentColor" />
    </svg>
  )
}

/** 余额：一张卡（账户钱包）。 */
export function IconWalletCardOutlineRegular({ size = 16, className, strokeWidth = 1 }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      strokeWidth={strokeWidth}
    >
      <path
        d="M4 4.6H12C13.1046 4.6 14 5.49543 14 6.6V9.4C14 10.5046 13.1046 11.4 12 11.4H4C2.89543 11.4 2 10.5046 2 9.4V6.6C2 5.49543 2.89543 4.6 4 4.6Z"
        stroke="currentColor"
      />
      <path d="M2 7.2H14" stroke="currentColor" />
    </svg>
  )
}
