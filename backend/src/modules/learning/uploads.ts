import multer from 'multer'
import type { RequestHandler } from 'express'
import yauzl from 'yauzl'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { crc32 } from 'node:zlib'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import ffprobe from '@ffprobe-installer/ffprobe'
import { HttpError } from '../../http.ts'

const run = promisify(execFile)
const mib = 1024 * 1024
export type Asset = { name: string; mime: string; data: Buffer }

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 24 * mib, files: 6, fields: 2, fieldSize: 1024, parts: 9 }
})
let activeUploads = 0
export const limitUploads: RequestHandler = (_req, res, next) => {
  if (activeUploads >= 2) throw new HttpError(503, 'UPLOAD_BUSY', 'Upload capacity is busy. Try again.')
  activeUploads++
  res.once('close', () => { activeUploads-- })
  next()
}
const unsafe = () => new HttpError(415, 'UNSAFE_FILE', 'Unsupported or unsafe upload')
const unavailable = () => new HttpError(503, 'SCANNER_UNAVAILABLE', 'Upload scanner unavailable')

async function temp<T>(work: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'vertexlearn-'))
  try { return await work(directory) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

export async function scan(buffer: Buffer) {
  if (buffer.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) throw unsafe()
  const scanner = process.env.UPLOAD_SCANNER
  if (!scanner) {
    if (process.env.SYNTHETIC_UPLOADS === 'true' && ['test', 'development'].includes(process.env.APP_ENV ?? '')) return
    throw unavailable()
  }
  await temp(async directory => {
    const path = join(directory, 'quarantine.bin')
    await writeFile(path, buffer)
    try { await run(scanner, [path], { timeout: 30000, windowsHide: true }) }
    catch (error) {
      if ((error as { code?: number }).code === 1) throw unsafe()
      throw unavailable()
    }
  })
}

const codeExtensions = /\.(?:txt|py|js|ts|jsx|tsx|java|c|cpp|h|cs|go|rs|sql|json|md|css|html|sh|rb|php|kt|swift|r|ipynb)$/i
const activePdf = new Set(['/A','/AA','/JS','/JavaScript','/OpenAction','/Launch','/EmbeddedFiles','/RichMedia','/XFA','/SubmitForm','/GoToR','/URI'])
async function pdf(buffer: Buffer) {
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw unsafe()
  const document = await PDFDocument.load(buffer, { throwOnInvalidObject: true }).catch(() => { throw unsafe() })
  function inspect(value: unknown, depth = 0) {
    if (depth > 64) throw unsafe()
    if (value instanceof PDFName && activePdf.has('/' + value.decodeText())) throw unsafe()
    if (value instanceof PDFDict) for (const [key, item] of value.entries()) {
      inspect(key, depth + 1); inspect(item, depth + 1)
    }
    if (value instanceof PDFArray) for (const item of value.asArray()) inspect(item, depth + 1)
  }
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    inspect(object instanceof PDFDict ? object : 'dict' in object ? object.dict : object)
  }
}

async function archive(buffer: Buffer, slides: boolean) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true }, (error, file) => error ? reject(error) : resolve(file)))
    .catch(() => { throw unsafe() })
  await new Promise<void>((resolve, reject) => {
    let total = 0
    let presentation = false
    let manifest = false
    const names = new Set<string>()
    const fail = () => { zip.close(); reject(unsafe()) }
    if (zip.entryCount > 150 || zip.entryCount === 0) return fail()
    zip.on('error', fail)
    zip.on('end', () => slides && (!presentation || !manifest) ? fail() : resolve())
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName
      const canonical = name.toLowerCase()
      const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
      if (names.has(canonical) || name.startsWith('/') || /[:\\\x00-\x1f]/.test(name) ||
          name.split('/').some(part => part === '.' || part === '..') ||
          (fileType && ![0o100000, 0o040000].includes(fileType)) || (entry.generalPurposeBitFlag & 1)) return fail()
      names.add(canonical)
      total += entry.uncompressedSize
      if (total > 24 * mib || entry.uncompressedSize > 8 * mib ||
          entry.uncompressedSize > 1024 + entry.compressedSize * 100) return fail()
      if (name.endsWith('/')) return zip.readEntry()
      presentation ||= name === 'ppt/presentation.xml'
      manifest ||= name === '[Content_Types].xml'
      if (slides ? !/\.(?:xml|rels|png|jpe?g|gif)$/i.test(name) || /(?:embeddings|activex|vba)/i.test(name)
        : !codeExtensions.test(name)) return fail()
      zip.openReadStream(entry, (error, stream) => {
        if (error) return fail()
        const parts: Buffer[] = []
        stream.on('error', fail)
        stream.on('data', (part: Buffer) => parts.push(part))
        stream.on('end', () => {
          try {
            const contents = Buffer.concat(parts)
            if (crc32(contents) !== entry.crc32) return fail()
            if (slides && /\.(?:rels|xml)$/i.test(name)) {
              const xml = new TextDecoder('utf-8', { fatal: true }).decode(contents)
              if (/<!\s*(?:DOCTYPE|ENTITY)|TargetMode\s*=\s*["']External|macroEnabled|oleObject|activeX/i.test(xml)) return fail()
            } else if (!slides) validateCode(contents)
            zip.readEntry()
          } catch { fail() }
        })
      })
    })
    zip.readEntry()
  })
}

function validateCode(buffer: Buffer) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    if (!text.trim() || text.includes('\0') || text.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) throw unsafe()
  } catch { throw unsafe() }
}

export async function validateFile(file: Express.Multer.File, kind: 'submission' | 'resource'): Promise<Asset> {
  const name = file.originalname.normalize('NFKC')
  const data = file.buffer
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,149}$/u.test(name) || !data.length || data.length > 8 * mib) throw unsafe()
  let mime
  if (/\.pdf$/i.test(name)) { await pdf(data); mime = 'application/pdf' }
  else if (kind === 'resource' && /\.pptx$/i.test(name)) {
    await archive(data, true); mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  } else if (kind === 'submission' && /\.zip$/i.test(name)) { await archive(data, false); mime = 'application/zip' }
  else if (kind === 'submission' && codeExtensions.test(name)) { validateCode(data); mime = 'text/plain' }
  else throw unsafe()
  await scan(data)
  return { name, mime, data }
}

export async function validateCaptions(file: Express.Multer.File): Promise<Asset> {
  if (!/\.vtt$/i.test(file.originalname) || file.size > mib) throw unsafe()
  let contents
  try { contents = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer) }
  catch { throw unsafe() }
  if (!/^WEBVTT(?:[^\S\r\n].*)?\r?\n/.test(contents) ||
      /[\x00<>]/.test(contents.replaceAll('-->', '')) || /^STYLE\s*$/m.test(contents)) throw unsafe()
  await scan(file.buffer)
  return { name: 'captions.vtt', mime: 'text/vtt', data: file.buffer }
}

const encoderUnavailable = () => new HttpError(503, 'ENCODER_UNAVAILABLE', 'Video encoder unavailable')
let activeEncodes = 0
export async function packageVideo(file: Express.Multer.File) {
  const local = ['development', 'test'].includes(process.env.APP_ENV ?? '')
  const encodePath = process.env.FFMPEG_PATH ?? (local ? ffmpeg.path : undefined)
  const probePath = process.env.FFPROBE_PATH ?? (local ? ffprobe.path : undefined)
  if (!encodePath || !probePath) throw encoderUnavailable()
  const extension = file.originalname.toLowerCase().match(/\.(mp4|mov|webm)$/)?.[1]
  const container = extension === 'webm'
    ? file.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : file.buffer.subarray(4, 8).equals(Buffer.from('ftyp'))
  if (!extension || !container) throw unsafe()
  if (activeEncodes >= 2) throw new HttpError(503, 'ENCODER_BUSY', 'Video encoder is busy. Try again.')
  activeEncodes++
  try {
    await scan(file.buffer)
    return await temp(async directory => {
      const path = join(directory, 'input.' + extension)
      const format = extension === 'webm' ? 'matroska' : 'mov'
      await writeFile(path, file.buffer)
      try {
        const { stdout } = await run(probePath, [
          '-v', 'error', '-protocol_whitelist', 'file', '-f', format,
          '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path
        ], { timeout: 12000, windowsHide: true })
        const metadata = JSON.parse(stdout)
        const duration = Number(metadata.format?.duration)
        const video = metadata.streams?.find((stream: { codec_type: string }) => stream.codec_type === 'video')
        if (!Number.isFinite(duration) || duration <= 0 || duration > 300 ||
            !video || video.width > 3840 || video.height > 2160) throw unsafe()
        await run(encodePath, [
          '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-f', format, '-threads', '2', '-i', path,
          '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=min(1280\\,iw):-2',
          '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-pix_fmt', 'yuv420p',
          '-maxrate', '1200k', '-bufsize', '2400k', '-force_key_frames', 'expr:gte(t,n_forced*4)',
          '-c:a', 'aac', '-b:a', '96k', '-t', String(duration), '-f', 'hls', '-hls_time', '4',
          '-hls_playlist_type', 'vod', '-hls_segment_filename', 'segment%04d.ts', 'index.m3u8'
        ], { cwd: directory, timeout: 120000, windowsHide: true })
        const names = (await readdir(directory)).filter(name => name === 'index.m3u8' || /^segment\d{4}\.ts$/.test(name))
        if (!names.includes('index.m3u8') || names.length < 2) throw unsafe()
        const assets = await Promise.all(names.map(async name => ({
          name, mime: name.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl',
          data: await readFile(join(directory, name))
        })))
        if (assets.reduce((size, asset) => size + asset.data.length, 0) > 64 * mib) throw unsafe()
        return { duration: Math.ceil(duration), assets }
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') throw encoderUnavailable()
        throw unsafe()
      }
    })
  } finally { activeEncodes-- }
}
