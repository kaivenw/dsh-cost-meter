/** 测试替身：平台 seed 模块 `@deepseek-ai/dsh-client-ui-primitives` 在运行时由客户端注入，
 *  单测里用同名的最小实现顶上（只用到图标）。 */
import React from 'react'

const icon = (name) => function Icon({ size = 16, className }) {
  return React.createElement('svg', { className, width: size, height: size, 'data-icon': name, viewBox: '0 0 16 16' })
}

export const IconClockOutlineRegular = icon('clock')
export const IconDatabaseOutlineRegular = icon('database')
export const IconDataOutlineRegular = icon('data')
export const IconGaugeOutlineRegular = icon('gauge')
