import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ErrorCode } from '@phone-erp/shared-types';
import { APP_CONFIG } from '../tokens';
import type { AppConfig } from '../../config/configuration';
import { BusinessError } from '../errors/business.error';

/**
 * The picture formats a browser can display, and the first bytes that prove it.
 *
 * The declared content type and the filename both come from whoever is
 * uploading, so neither is evidence of anything. The magic number is: a file
 * claiming to be a JPEG that does not begin like one is not stored.
 */
const SIGNATURES: { ext: string; mime: string; matches: (b: Buffer) => boolean }[] = [
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'png',
    mime: 'image/png',
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    matches: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

/** Subfolders under UPLOAD_DIR. Adding one here is the only way to get a new one. */
export type ImageFolder = 'products' | 'warehouses' | 'brands';

@Injectable()
export class ImageStorageService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Writes one picture and returns the path to serve it from.
   *
   * The stored name is generated here. Using anything the client sent invites
   * a filename that escapes the directory or overwrites someone else's file.
   */
  async store(data: Buffer, folder: ImageFolder): Promise<string> {
    if (data.length === 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'That file is empty.');
    }
    if (data.length > this.config.uploads.maxBytes) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        `That picture is ${(data.length / 1e6).toFixed(1)} MB. The limit is ${(
          this.config.uploads.maxBytes / 1e6
        ).toFixed(1)} MB — take it again at a smaller size.`,
      );
    }

    const kind = SIGNATURES.find((s) => s.matches(data));
    if (!kind) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'That is not a picture the browser can show. Use a JPEG, PNG or WebP.',
      );
    }

    const name = `${randomUUID()}.${kind.ext}`;
    const dir = join(resolve(this.config.uploads.dir), folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), data);

    // Under /api so it reaches the application on a host that only routes
    // /api to Node (cPanel/Passenger) — anything else gets the web app's
    // index.html back, which an <img> shows as a broken "?".
    return `/api/uploads/${folder}/${name}`;
  }

  /**
   * Deletes a stored picture, ignoring one that is already gone.
   *
   * Only paths this service produced are touched — anything else is a value
   * that should not be in the column, and deleting by it would be acting on a
   * path chosen by whoever wrote the row.
   */
  async remove(imageUrl: string | null): Promise<void> {
    if (!imageUrl) return;

    const match = /^(?:\/api)?\/uploads\/(products|warehouses|brands)\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(imageUrl);
    if (!match) return;

    try {
      await unlink(join(resolve(this.config.uploads.dir), match[1], match[2]));
    } catch {
      /* already gone, which is the state we wanted */
    }
  }
}
