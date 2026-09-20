import { FileQuestion } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <FileQuestion className="h-10 w-10 text-muted-foreground" aria-hidden />
      {/* A heading, not a paragraph: every page needs one for screen readers. */}
      <h1 className="text-xl font-bold">{t('notFound.title')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('notFound.body')}</p>
      <Button asChild variant="outline">
        <Link to="/">{t('notFound.back')}</Link>
      </Button>
    </div>
  );
}