import { Image as ImageIcon, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { shrinkImage } from '@/lib/image';

/**
 * Choose a picture, see it, or take it away.
 *
 * The chosen file is handed back rather than uploaded here, because both places
 * that use this need the record to exist first — the upload endpoints are keyed
 * by id. `null` means "remove the one that is there"; `undefined` means the
 * picture was never touched.
 */
export function ImagePicker({
  id,
  label = 'Photo',
  currentUrl,
  onChange,
  hint = 'JPEG, PNG or WebP. Large photos are shrunk before they are sent.',
  size = 'md',
}: {
  id: string;
  label?: string;
  currentUrl: string | null;
  onChange: (picked: Blob | null) => void;
  hint?: string;
  size?: 'md' | 'lg';
}) {
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [shrinking, setShrinking] = useState(false);

  // Object URLs for a freshly chosen file have to be released by hand.
  useEffect(() => {
    if (!preview?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const box = size === 'lg' ? 'h-32 w-44' : 'h-24 w-24';

  return (
    <div className="flex items-start gap-3">
      <div className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted`}>
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-7 w-7 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setShrinking(true);
            const small = await shrinkImage(file);
            onChange(small);
            setPreview(URL.createObjectURL(small));
            setShrinking(false);
          }}
        />
        <p className="text-xs text-muted-foreground">{shrinking ? 'Preparing the picture…' : hint}</p>
        {preview && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ms-2 gap-1 text-muted-foreground"
            onClick={() => {
              onChange(null);
              setPreview(null);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Remove picture
          </Button>
        )}
      </div>
    </div>
  );
}
