import { Pipe, PipeTransform } from '@angular/core'

@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(iso: string): string {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)} min ago`
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
    return new Date(iso).toLocaleDateString()
  }
}
