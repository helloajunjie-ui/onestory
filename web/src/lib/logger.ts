// 全局日志工具（console-only，不再上报 /api/log）

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function push(level: LogLevel, module: string, msg: string, ...args: unknown[]) {
  const ts = Date.now()
  const prefix = `[${new Date(ts).toISOString().slice(11, 23)}][${module}]`
  const fn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'info'
          ? console.info
          : console.debug
  fn(prefix, msg, ...args)
}

export const logger = {
  debug: (module: string, msg: string, ...args: unknown[]) => push('debug', module, msg, ...args),
  info: (module: string, msg: string, ...args: unknown[]) => push('info', module, msg, ...args),
  warn: (module: string, msg: string, ...args: unknown[]) => push('warn', module, msg, ...args),
  error: (module: string, msg: string, ...args: unknown[]) => push('error', module, msg, ...args),
}
