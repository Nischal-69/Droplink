import { Archive, File, FileText, Film, Image, Music } from 'lucide-react'

type Props = {
  fileName: string
  mimeType: string
  size?: number
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'avif'])
const VIDEO_EXT = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'])
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2'])
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'])

function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.')
  return parts.length > 1 ? (parts.pop() ?? '') : ''
}

/** SVG file-type icon (Lucide) based on MIME type with extension fallback. */
export default function FileTypeIcon({ fileName, mimeType, size = 18 }: Props) {
  const ext = getExtension(fileName)

  if (mimeType.startsWith('image/') || IMAGE_EXT.has(ext)) {
    return <Image size={size} className="text-primary" aria-hidden />
  }
  if (mimeType.startsWith('video/') || VIDEO_EXT.has(ext)) {
    return <Film size={size} className="text-primary" aria-hidden />
  }
  if (mimeType.startsWith('audio/') || AUDIO_EXT.has(ext)) {
    return <Music size={size} className="text-primary" aria-hidden />
  }
  if (ARCHIVE_EXT.has(ext)) {
    return <Archive size={size} className="text-primary" aria-hidden />
  }
  if (mimeType === 'application/pdf' || DOC_EXT.has(ext) || mimeType.startsWith('text/')) {
    return <FileText size={size} className="text-primary" aria-hidden />
  }
  return <File size={size} className="text-primary" aria-hidden />
}
