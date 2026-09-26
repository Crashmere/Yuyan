const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// fromNow gives "刚刚", "5 分钟前" or "昨天 14:30" for recent times and the date otherwise.
export function fromNow(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const seconds = (now.getTime() - d.getTime()) / 1000
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getTime() >= today) return `今天 ${time}`
  if (d.getTime() >= today - 86400000) return `昨天 ${time}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
